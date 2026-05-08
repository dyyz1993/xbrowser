import type { Page } from 'playwright';
import { execSync } from 'child_process';
import { WSServer } from './websocket-server.js';
import { ScreencastCapturer } from './screencast.js';
import { CaptchaDetector } from './captcha-detector.js';
import { WebhookNotifier, type WebhookPayload } from './webhook.js';
import { getCaptchaConfig } from './config.js';
import { shellEscape } from './utils/shell-escape.js';

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
 * Manages human-in-the-loop interactions for CAPTCHA solving and manual intervention.
 *
 * Streams the page via screencast, sends webhook notifications, and waits
 * for either auto-detection of CAPTCHA resolution, manual solving via
 * the preview UI, or timeout.
 */
export class HumanInteractionManager {
  private wsServer: WSServer;
  private page: Page;
  private capturer: ScreencastCapturer;
  private webhook: WebhookNotifier;
  private autoOpen: boolean;

  constructor(wsServer: WSServer, page: Page) {
    this.wsServer = wsServer;
    this.page = page;
    this.capturer = new ScreencastCapturer();

    const cfg = getCaptchaConfig();
    this.webhook = new WebhookNotifier(cfg.notifyUrl);
    this.autoOpen = cfg.autoOpen;

    this.wsServer.setPage(page);
  }

  private async sendWebhook(
    event: WebhookPayload['event'],
    overrides: Partial<WebhookPayload> = {}
  ): Promise<void> {
    await this.webhook.notify({
      event,
      timestamp: new Date().toISOString(),
      url: this.page.url(),
      previewUrl: `http://localhost:${this.wsServer.getPort()}`,
      ...overrides,
    });
  }

  private tryAutoOpen(previewUrl: string): void {
    if (!this.autoOpen) return;

    try {
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'linux'
            ? 'xdg-open'
            : 'start';
      execSync(`${cmd} ${shellEscape(previewUrl)}`, { stdio: 'ignore' });
    } catch {
      // ignore auto-open failures
    }
  }

  /**
   * Wait for a human to solve a CAPTCHA or complete an interaction.
   *
   * Starts screencast streaming, sends webhook and broadcast notifications,
   * then polls for CAPTCHA resolution or waits for a manual solve signal.
   *
   * @param options - Configuration for timeout, auto-detection, and reason text.
   * @returns Result indicating whether the CAPTCHA was solved and by what method.
   */
  async waitForHuman(options: WaitForHumanOptions = {}): Promise<WaitForHumanResult> {
    const {
      reason = 'Human interaction required',
      timeout = 120,
      autoDetect = true,
      detectInterval = 2000,
    } = options;

    const captcha = await CaptchaDetector.detect(this.page);
    const captchaInfo = captcha.detected ? captcha : undefined;

    await this.capturer.startCapture(this.page, 'default', (frame) => {
      this.wsServer.broadcast({
        type: 'screenshot',
        data: {
          sessionId: frame.sessionId,
          id: frame.id,
          timestamp: frame.timestamp,
          data: frame.data,
          url: frame.url,
          viewport: frame.viewport,
        },
      });
    });

    const previewUrl = `http://localhost:${this.wsServer.getPort()}`;

    await this.sendWebhook('captcha-detected', {
      reason: captchaInfo ? `${captchaInfo.type ?? 'unknown'} CAPTCHA detected` : reason,
      timeout,
      targetUrl: this.page.url(),
    });

    this.wsServer.broadcast({
      type: 'captcha-detected',
      sessionId: 'default',
      url: this.page.url(),
      reason: captchaInfo ? `${captchaInfo.type ?? 'unknown'} CAPTCHA detected` : reason,
      timeout,
    } as Extract<import('./websocket-server.js').WSMessage, { type: 'captcha-detected' }>);

    this.tryAutoOpen(previewUrl);

    console.log('');
    console.log('\u26A0\uFE0F  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(`\u26A0\uFE0F  ${captchaInfo ? (captchaInfo.type ?? 'UNKNOWN').toUpperCase() + ' CAPTCHA' : 'INTERACTION'} REQUIRED`);
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

    return new Promise<WaitForHumanResult>((resolve) => {
      let resolved = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        this.wsServer.removeListener('human-solved', onHumanSolved);
        this.capturer.stopCapture();
      };

      if (autoDetect && captchaInfo) {
        pollTimer = setInterval(async () => {
          if (resolved) return;
          try {
            const solved = await CaptchaDetector.isSolved(this.page, captchaInfo.selector);
            if (solved) {
              resolved = true;
              cleanup();
              this.wsServer.broadcast({ type: 'resolved', sessionId: 'default' });
              console.log('\u2705 CAPTCHA auto-detected as solved!');
              this.sendWebhook('captcha-resolved', { reason: 'auto-detected' });
              resolve({ solved: true, method: 'auto-detected' });
            }
          } catch {
            // ignore detection errors
          }
        }, detectInterval);
      }

      const onHumanSolved = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          this.wsServer.broadcast({ type: 'resolved', sessionId: 'default' });
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
            console.log('\u23F0 Timeout - skipping');
            this.sendWebhook('captcha-resolved', { reason: 'timeout' });
            resolve({ solved: false, method: 'timeout' });
          }
        }, timeout * 1000);
      }
    });
  }
}
