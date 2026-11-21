import type { Page } from './browser-shim.js';
import { execFile } from 'child_process';
import type { WSServer } from './websocket-server.js';
import { CaptchaDetector } from './captcha-detector.js';
import { WebhookNotifier, type WebhookPayload } from './webhook.js';
import { getCaptchaConfig } from './config.js';

/**
 * Options for the wait-for-human interaction flow.
 */
export interface WaitForHumanOptions {
  reason?: string;
  timeout?: number;
  autoDetect?: boolean;
  detectInterval?: number;
}

/**
 * Result of a wait-for-human interaction attempt.
 */
export interface WaitForHumanResult {
  solved: boolean;
  method: 'preview' | 'auto-detected' | 'timeout' | 'manual';
}

/**
 * Payload emitted by `WSServer` on inbound `{"type":"solved"}` messages.
 *
 * Shape (confirmed in websocket-server.ts):
 * `emit('human-solved', { sessionId: string | null, clientId: string })`
 * where `sessionId` is the solving client's bound session (`null` when the
 * client never bound to a session).
 */
export interface HumanSolvedEvent {
  sessionId: string | null;
  clientId: string;
}

/** Session name used when none is provided. */
export const DEFAULT_HUMAN_INTERACTION_SESSION = 'default';

/**
 * Per-WSServer registry of sessions with an in-flight `waitForHuman`.
 *
 * Prevents two concurrent waits from sharing a completion signal. Distinct
 * sessions (or distinct WSServers) are independent slots.
 */
const activeWaitsByServer = new WeakMap<WSServer, Map<string, 'starting' | 'waiting'>>();

function acquireWaitSlot(server: WSServer, sessionName: string): boolean {
  let sessions = activeWaitsByServer.get(server);
  if (!sessions) {
    sessions = new Map();
    activeWaitsByServer.set(server, sessions);
  }
  if (sessions.has(sessionName)) return false;
  sessions.set(sessionName, 'starting');
  return true;
}

function releaseWaitSlot(server: WSServer, sessionName: string): void {
  activeWaitsByServer.get(server)?.delete(sessionName);
}

/**
 * Whether a `waitForHuman` wait is currently in flight for a session on a
 * WSServer. Used by viewer workspace state so late-connecting/reconnecting
 * panels can show the "waiting for human" handoff state.
 */
export function isHumanWaitActive(server: WSServer, sessionName: string): boolean {
  return activeWaitsByServer.get(server)?.get(sessionName) === 'waiting';
}

/**
 * Manages human-in-the-loop interactions for CAPTCHA solving and manual intervention.
 *
 * Each instance is bound to one named session on the WebSocket server.
 * Streams the session's live page via screencast (headless — the viewer
 * mirrors the same page over WS, no native headed browser is launched),
 * sends webhook notifications, and waits for either auto-detection of
 * CAPTCHA resolution, a solve signal from a viewer bound to *this*
 * session, or timeout. The WebSocket server streams the active page and
 * this manager sends handoff notifications to the session's own viewers.
 */
export class HumanInteractionManager {
  private wsServer: WSServer;
  private page: Page;
  private sessionName: string;
  private webhook: WebhookNotifier;
  private autoOpen: boolean;

  constructor(wsServer: WSServer, page: Page, sessionName?: string) {
    this.wsServer = wsServer;
    this.page = page;
    this.sessionName =
      sessionName && sessionName.trim() ? sessionName.trim() : DEFAULT_HUMAN_INTERACTION_SESSION;

    const cfg = getCaptchaConfig();
    this.webhook = new WebhookNotifier(cfg.notifyUrl);
    this.autoOpen = cfg.autoOpen;

    this.wsServer.registerSession(this.sessionName, page);
  }

  /** The named session this manager interacts with. */
  get session(): string {
    return this.sessionName;
  }

  private buildPreviewUrl(): string {
    return `http://localhost:${this.wsServer.getPort()}/preview/${encodeURIComponent(this.sessionName)}`;
  }

  private async sendWebhook(
    event: WebhookPayload['event'],
    overrides: Partial<WebhookPayload> = {}
  ): Promise<void> {
    await this.webhook.notify({
      event,
      timestamp: new Date().toISOString(),
      url: this.page.url(),
      previewUrl: this.buildPreviewUrl(),
      ...overrides,
    });
  }

  private tryAutoOpen(previewUrl: string): void {
    if (!this.autoOpen) return;

    try {
      const opener =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'linux'
            ? 'xdg-open'
            : 'cmd';
      // P0-3 audit closure: argument-array invocation, no shell. On Windows
      // 'start' is a cmd builtin, so route through cmd /c with an empty title.
      const args =
        process.platform === 'win32'
          ? ['/c', 'start', '', previewUrl]
          : [previewUrl];
      execFile(opener, args, { timeout: 10_000 }, () => {
        // ignore auto-open failures (browser may not exist)
      });
    } catch {
      // ignore auto-open failures
    }
  }

  /**
   * Wait for a human to solve a CAPTCHA or complete an interaction.
   *
   * Sends session-scoped notifications and waits for CAPTCHA resolution
   * or a manual solve signal from a viewer bound to this session.
   *
   * Only one wait may be in flight per session per WSServer. The wait
   * slot, listener, and timers are cleaned
   * up on every exit path (auto-detected / preview / timeout / error).
   *
   * @param options - Configuration for timeout, auto-detection, and reason text.
   * @returns Result indicating whether the CAPTCHA was solved and by what method.
   * @throws If a wait is already in progress for this session.
   */
  async waitForHuman(options: WaitForHumanOptions = {}): Promise<WaitForHumanResult> {
    const {
      reason = 'Human interaction required',
      timeout = 120,
      autoDetect = true,
      detectInterval = 2000,
    } = options;

    if (!acquireWaitSlot(this.wsServer, this.sessionName)) {
      throw new Error(
        `waitForHuman already in progress for session "${this.sessionName}" — only one human-interaction wait per session is allowed`
      );
    }

    let slotReleased = false;
    const releaseSlot = (): void => {
      if (!slotReleased) {
        slotReleased = true;
        releaseWaitSlot(this.wsServer, this.sessionName);
      }
    };

    try {
      const captcha = await CaptchaDetector.detect(this.page);
      const captchaInfo = captcha.detected ? captcha : undefined;

      const previewUrl = this.buildPreviewUrl();
      const waitReason = captchaInfo ? `${captchaInfo.type ?? 'unknown'} CAPTCHA detected` : reason;

      console.log('');
      console.log('\u26A0\uFE0F  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
      console.log(`\u26A0\uFE0F  ${captchaInfo ? (captchaInfo.type ?? 'UNKNOWN').toUpperCase() + ' CAPTCHA' : 'INTERACTION'} REQUIRED (session: ${this.sessionName})`);
      console.log(`\u26A0\uFE0F  URL: ${this.page.url()}`);
      console.log(`\u26A0\uFE0F  `);
      console.log(`\u26A0\uFE0F  Solve via:`);
      console.log(`\u26A0\uFE0F    \uD83D\uDCFA Preview: ${previewUrl}`);
      console.log(`\u26A0\uFE0F    \uD83C\uDF10 Direct:  ${this.page.url()}`);
      console.log(`\u26A0\uFE0F    \u23ED\uFE0F  Skip`);
      console.log(`\u26A0\uFE0F    \u274C Abort`);
      console.log(`\u26A0\uFE0F  `);
      console.log(`\u26A0\uFE0F  \u23F3 Waiting... (${timeout}s timeout)`);
      console.log('\u26A0\uFE0F  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
      console.log('');

      return await new Promise<WaitForHumanResult>((resolve) => {
        let resolved = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (pollTimer) clearInterval(pollTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          this.wsServer.removeListener('human-solved', onHumanSolved);
          releaseSlot();
        };

        if (autoDetect && captchaInfo) {
          pollTimer = setInterval(async () => {
            if (resolved) return;
            try {
              const solved = await CaptchaDetector.isSolved(this.page, captchaInfo.selector);
              if (solved && !resolved) {
                resolved = true;
                cleanup();
                this.wsServer.broadcastToSession(this.sessionName, {
                  type: 'resolved',
                  sessionId: this.sessionName,
                });
                console.log('\u2705 CAPTCHA auto-detected as solved!');
                this.sendWebhook('captcha-resolved', { reason: 'auto-detected' });
                resolve({ solved: true, method: 'auto-detected' });
              }
            } catch {
              // ignore detection errors
            }
          }, detectInterval);
        }

        const onHumanSolved = (payload: HumanSolvedEvent) => {
          // Session-scoped completion: only a viewer bound to this session
          // may solve this wait. Signals from other sessions (or from
          // unbound clients, sessionId === null) are ignored.
          if (!payload || payload.sessionId !== this.sessionName) return;
          if (!resolved) {
            resolved = true;
            cleanup();
            this.wsServer.broadcastToSession(this.sessionName, {
              type: 'resolved',
              sessionId: this.sessionName,
            });
            console.log('\u2705 CAPTCHA solved via preview!');
            this.sendWebhook('captcha-resolved', { reason: 'preview' });
            resolve({ solved: true, method: 'preview' });
          }
        };
        this.wsServer.on('human-solved', onHumanSolved);

        if (timeout > 0) {
          timeoutTimer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              cleanup();
              this.wsServer.broadcastToSession(this.sessionName, {
                type: 'handoff-timeout',
                sessionId: this.sessionName,
              });
              console.log('\u23F0 Timeout - skipping');
              this.sendWebhook('captcha-resolved', { reason: 'timeout' });
              resolve({ solved: false, method: 'timeout' });
            }
          }, timeout * 1000);
        }

        activeWaitsByServer.get(this.wsServer)?.set(this.sessionName, 'waiting');
        this.wsServer.broadcastToSession(this.sessionName, {
          type: 'captcha-detected',
          sessionId: this.sessionName,
          url: this.page.url(),
          reason: waitReason,
          timeout,
        });
        void this.sendWebhook('captcha-detected', { reason: waitReason, timeout, targetUrl: this.page.url() });
        this.tryAutoOpen(previewUrl);
      });
    } catch (err) {
      releaseSlot();
      throw err;
    }
  }
}
