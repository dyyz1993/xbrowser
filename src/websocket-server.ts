import { EventEmitter } from 'events';
import type { Server } from 'http';
import type { Page } from './browser-shim.js';
import { ScreencastCapturer, type ScreencastFrame } from './screencast.js';
import { StreamStateManager, FrameRateController, FrameProcessor, STATE_CONFIGS } from './stream/index.js';
import type { StreamState, CropConfig } from './stream/index.js';

/**
 * Configuration for the WebSocket server.
 */
export interface WSServerConfig {
  port?: number;
  host?: string;
}

/**
 * Outbound WebSocket message types sent to connected clients.
 */
export type WSMessage =
  | { type: 'screenshot'; data: ScreencastMessage }
  | { type: 'command'; data: CommandMessage }
  | { type: 'status'; data: StatusMessage }
  | { type: 'captcha-detected'; sessionId: string; url: string; reason: string; timeout: number }
  | { type: 'resolved'; sessionId: string }
  | { type: 'navigation'; url: string; title: string }
  | { type: 'input_focused'; selector: string; value: string; tag: string; placeholder?: string }
  | { type: 'input_blur'; selector: string }
  | { type: 'file_upload_result'; success: boolean; fileName: string; error?: string }
  | { type: 'file_input_clicked'; selector: string }
  | { type: 'file_list_result'; path: string; files: Array<{ name: string; isDir: boolean; size: number; modified: string }>; error?: string }
  | { type: 'file_download_result'; fileName: string; mimeType: string; data: string; error?: string }
  | { type: 'views_update'; views: ViewInfo[] }
  | { type: 'error'; data: { code: string; message: string; availableSessions?: string[] } };

export interface ViewInfo {
  id: string;
  label: string;
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * Inbound WebSocket message types received from clients.
 */
export type WSInboundMessage =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' }
  | { type: 'type'; text: string }
  | { type: 'keypress'; key: string }
  | { type: 'scroll'; deltaX: number; deltaY: number }
  | { type: 'solved' }
  | { type: 'bind'; sessionId: string }
  | { type: 'input_mouse'; action: 'move' | 'down' | 'up' | 'click'; x: number; y: number; button?: 'left' | 'middle' | 'right' }
  | { type: 'input_keyboard'; action: 'down' | 'up'; key: string; modifiers?: number }
  | { type: 'input_fill'; text: string; selector: string }
  | { type: 'input_insert_text'; text: string }
  | { type: 'file_upload'; fileName: string; mimeType: string; data: string; selector?: string }
  | { type: 'file_list'; path: string }
  | { type: 'file_download'; path: string }
  | { type: 'focus_element'; selector: string }
  | { type: 'focus_clear' }
  | { type: 'input_blur' }
  | { type: 'select_view'; rect: { x: number; y: number; width: number; height: number } | null };

  /**
   * A screencast frame message with binary image data.
   */
  export interface ScreencastMessage {
    sessionId: string;
    id: string;
    timestamp: number;
    data: Buffer;
    url: string;
    viewport: { width: number; height: number };
  }

/**
 * A command execution event message streamed during command lifecycle.
 */
export interface CommandMessage {
  sessionId: string;
  command: string;
  args: unknown[];
  phase: 'before' | 'after';
  result?: unknown;
  error?: string;
  timestamp: number;
  duration?: number;
}

/**
 * A server status change notification.
 */
export interface StatusMessage {
  status: 'connected' | 'disconnected' | 'error';
  sessionId?: string;
  message?: string;
  viewport?: { width: number; height: number };
}

interface WSClient {
  id: string;
  sessionId?: string;
  requestedSessionId?: string;
  ws: WSLike;
}

interface WSLike {
  send: (data: unknown, cb?: (err?: Error) => void) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  readyState: number;
}

/**
 * Per-session screencast state for lazy start/stop.
 */
interface SessionScreencast {
  capturer: ScreencastCapturer;
  page: Page;
  clientCount: number;
  focusPoll?: ReturnType<typeof setInterval>;
  lastFocusKey?: string;
  elementScan?: ReturnType<typeof setInterval>;
  staticSnapshotTimer?: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket server for streaming browser screenshots and handling remote input.
 *
 * Two modes:
 * 1. **Standalone**: `start()` creates its own WS server on a port.
 * 2. **Attached**: `attachToServer(httpServer)` shares an existing HTTP server
 *    via the WS upgrade mechanism (same port as HTTP, e.g., daemon port 9224).
 *
 * **Lazy screencast**: Screencast capture only starts when the first WS client
 * binds to a session, and stops when the last client for that session disconnects.
 */
export class WSServer extends EventEmitter {
  private port: number;
  private host: string;
  private clients: Map<string, WSClient> = new Map();
  private sessionClients: Map<string, Set<string>> = new Map();
  private screencasts: Map<string, SessionScreencast> = new Map();
  private wsServer: InstanceType<typeof import('ws').WebSocketServer> | null = null;
  private isRunning = false;
  private stateManager: StreamStateManager = new StreamStateManager();
  private frameRateController: FrameRateController = new FrameRateController();
  private frameProcessor: FrameProcessor = new FrameProcessor();
  private lastFrameData: string | null = null;
  private lastFrameViewport: { width: number; height: number } | null = null;
  private sessionCrops: Map<string, { selector: string; box: { x: number; y: number; width: number; height: number } }> = new Map();

  /** No CDP frame for this long → page is static → take one high-quality screenshot */
  private readonly STATIC_SNAPSHOT_DELAY_MS = 3000;

  constructor(config: WSServerConfig = {}) {
    super();
    this.port = config.port ?? 9223;
    this.host = config.host || '0.0.0.0';

    this.stateManager.setStateChangeCallback((newState: StreamState, _previousState: StreamState) => {
      if (this.lastFrameData && this.lastFrameViewport) {
        const config = STATE_CONFIGS[newState];
        for (const [sid, sc] of this.screencasts) {
          if (sc.clientCount <= 0) continue;
          const crop = this.sessionCrops.get(sid);
          const cropConfig: CropConfig | undefined = crop ? crop.box : undefined;
          const effectiveViewport = crop
            ? { width: crop.box.width, height: crop.box.height }
            : this.lastFrameViewport!;
          this.frameProcessor.process(
            this.lastFrameData,
            config,
            effectiveViewport.width,
            effectiveViewport.height,
            cropConfig,
          ).then((processedBuffer) => {
            const header = Buffer.from(JSON.stringify({
              type: 'screenshot',
              data: {
                sessionId: sid,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                url: '',
                viewport: effectiveViewport,
                streamState: newState,
                fps: this.frameRateController.getCurrentFps(),
              },
            }), 'utf-8');
            const headerLen = Buffer.alloc(4);
            headerLen.writeUInt32BE(header.length, 0);
            const payload = Buffer.concat([headerLen, header, processedBuffer]);
            this.broadcastBinaryToSession(sid, payload);
          }).catch(() => {});
        }
      }
    });
  }

  private async processAndBroadcast(
    frameData: string,
    frameViewport: { width: number; height: number },
    sessionId: string,
    frameSessionId: string,
    frameId: string,
    frameTimestamp: number,
    frameUrl: string,
  ): Promise<void> {
    const config = this.stateManager.getConfig();
    const crop = this.sessionCrops.get(sessionId);
    const cropConfig: CropConfig | undefined = crop ? crop.box : undefined;
    const effectiveViewport = crop
      ? { width: crop.box.width, height: crop.box.height }
      : frameViewport;
    const processedBuffer = await this.frameProcessor.process(
      frameData,
      config,
      effectiveViewport.width,
      effectiveViewport.height,
      cropConfig,
    );
    const header = Buffer.from(JSON.stringify({
      type: 'screenshot',
      data: {
        sessionId: frameSessionId,
        id: frameId,
        timestamp: frameTimestamp,
        url: frameUrl,
        viewport: effectiveViewport,
        streamState: this.stateManager.getState(),
        fps: this.frameRateController.getCurrentFps(),
      },
    }), 'utf-8');
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32BE(header.length, 0);
    const payload = Buffer.concat([headerLen, header, processedBuffer]);
    this.broadcastBinaryToSession(sessionId, payload);
  }

  /**
   * Dead man's switch: reset the static snapshot timer.
   * Called on every CDP frame. If no frame arrives within STATIC_SNAPSHOT_DELAY_MS,
   * the timer fires and takes a single high-quality screenshot.
   */
  private resetStaticSnapshotTimer(sessionId: string): void {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;
    if (sc.staticSnapshotTimer) clearTimeout(sc.staticSnapshotTimer);
    sc.staticSnapshotTimer = setTimeout(() => {
      sc.staticSnapshotTimer = undefined;
      this.takeStaticSnapshot(sessionId).catch(() => {});
    }, this.STATIC_SNAPSHOT_DELAY_MS);
  }

  /**
   * Take a single high-quality screenshot when the page appears static.
   * Uses page.screenshot() at quality 100 — cleaner than re-encoded CDP frames.
   */
  private async takeStaticSnapshot(sessionId: string): Promise<void> {
    const sc = this.screencasts.get(sessionId);
    if (!sc || sc.clientCount <= 0) return;

    let viewport = sc.page.viewportSize();
    if (!viewport) {
      try {
        viewport = await sc.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      } catch { viewport = { width: 1920, height: 1080 }; }
    }

    const screenshot = await sc.page.screenshot({ type: 'jpeg', quality: 100 });
    this.lastFrameData = screenshot.toString('base64');
    this.lastFrameViewport = viewport;

    await this.processAndBroadcast(
      this.lastFrameData,
      viewport!,
      sessionId,
      sessionId,
      crypto.randomUUID(),
      Date.now(),
      sc.page.url(),
    );
  }

  /**
   * Register a session page for screencast streaming.
   * Call this when a session is created. The capturer will only start
   * when a WS client binds to this session.
   */
  registerSession(sessionId: string, page: Page, options?: { interval?: number; quality?: number; type?: 'jpeg' | 'png'; width?: number; height?: number }): void {
    if (this.screencasts.has(sessionId)) return;
    this.screencasts.set(sessionId, {
      capturer: new ScreencastCapturer({
        interval: options?.interval ?? 100,
        quality: options?.quality ?? 80,
        type: options?.type ?? 'jpeg',
        width: options?.width ?? 1920,
        height: options?.height ?? 1080,
      }),
      page,
      clientCount: 0,
    });

      const injectFocusListeners = () => {
        document.addEventListener('focusin', (e) => {
          const el = e.target as HTMLElement;
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            w.__xb_focus_seq = (w.__xb_focus_seq || 0) + 1;
            const info: { selector: string; tag: string; value: string; placeholder: string; isFileInput?: boolean; seq: number } = {
              selector: '',
              tag: el.tagName,
              value: (el as HTMLInputElement).value || '',
              placeholder: (el as HTMLInputElement).placeholder || '',
              seq: w.__xb_focus_seq as number,
            };
            if (el.id) info.selector = '#' + el.id;
            else if (el.getAttribute('name')) info.selector = '[name="' + el.getAttribute('name') + '"]';
            else info.selector = el.tagName.toLowerCase();
            if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') {
              info.isFileInput = true;
            }
            w.__xb_last_focused = info;
          }
        }, true);
       document.addEventListener('focusout', () => {
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         (window as any).__xb_last_focused = null;
       }, true);
     };
     page.evaluate(injectFocusListeners).catch(() => {});

      // Re-inject focus listeners after navigation (page.evaluate listeners are lost on navigation)
      page.on('load', () => {
        page.evaluate(injectFocusListeners).catch(() => {});
      });

     const focusPoll = setInterval(async () => {
      const sc = this.screencasts.get(sessionId);
      if (!sc || !this.getSessionClientCount(sessionId)) return;
       try {
            type FocusInfo = { focused: boolean; selector?: string; value?: string; tag?: string; placeholder?: string; isFileInput?: boolean; seq?: number };
            const info: FocusInfo = await page.evaluate(() => {
              // Check __xb_last_focused first, then fallback to activeElement
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const f = (window as any).__xb_last_focused;
              if (f) return { focused: true, ...f };
             // Fallback: check document.activeElement directly
             const active = document.activeElement as HTMLElement | null;
             if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.contentEditable === 'true')) {
               const sel = active.id ? '#' + active.id : (active.getAttribute('name') ? '[name="' + active.getAttribute('name') + '"]' : active.tagName.toLowerCase());
               return {
                 focused: true,
                 selector: sel,
                 tag: active.tagName,
                 value: (active as HTMLInputElement).value || '',
                 placeholder: (active as HTMLInputElement).placeholder || '',
                 isFileInput: active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'file',
               };
             }
             return { focused: false };
           });
            const focusKey = info.focused ? `${info.selector || 'unknown'}#${info.seq ?? 0}` : '';
           if (focusKey === sc.lastFocusKey) return;
           sc.lastFocusKey = focusKey;
           if (info.focused && info.selector) {
             if (info.isFileInput) {
               this.broadcastToSession(sessionId, { type: 'file_input_clicked', selector: info.selector });
             } else {
               this.broadcastToSession(sessionId, { type: 'input_focused', selector: info.selector, value: info.value || '', tag: info.tag || '', placeholder: info.placeholder });
             }
           } else {
             this.broadcastToSession(sessionId, { type: 'input_blur', selector: '' });
           }
         } catch { /* ignore evaluate errors */ }
      }, 500);

     this.screencasts.get(sessionId)!.focusPoll = focusPoll;

    // Periodic element scan for modal/form/dialog detection (every 3s)
    const elementScan = setInterval(async () => {
      const sc2 = this.screencasts.get(sessionId);
      if (!sc2 || !this.getSessionClientCount(sessionId)) return;
      try {
        type ElInfo = { tag: string; id: string; cls: string; rect: { x: number; y: number; width: number; height: number } };
        const elements: ElInfo[] = await page.evaluate(() => {
          const sel = '[role="dialog"],dialog,[class*="modal"],[class*="popup"],[class*="overlay"],[class*="drawer"],form';
          const els = document.querySelectorAll(sel);
          const results: ElInfo[] = [];
          const vpW = window.innerWidth, vpH = window.innerHeight;
          for (const el of els) {
            const r = el.getBoundingClientRect();
            if (r.width < 50 || r.height < 30) continue;
            // Skip if covers >90% of viewport (it's the main content)
            if (r.width * r.height > vpW * vpH * 0.9) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
            const htmlEl = el as HTMLElement;
            results.push({
              tag: el.tagName,
              id: el.id || '',
              cls: (typeof htmlEl.className === 'string' ? htmlEl.className : '').slice(0, 40),
              rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
            });
          }
          return results;
        });
        const views: ViewInfo[] = elements.map((e, i) => ({
          id: 'el-' + i + '-' + (e.id || e.tag),
          label: e.id || e.cls || e.tag,
          rect: e.rect,
        }));
        this.broadcastToSession(sessionId, { type: 'views_update', views });
      } catch { /* ignore */ }
    }, 3000);
    this.screencasts.get(sessionId)!.elementScan = elementScan;

    for (const [clientId, client] of this.clients) {
      if (client.requestedSessionId === sessionId && !client.sessionId) {
        this.bindClientToSession(clientId, sessionId);
      }
    }
  }

  /**
   * Unregister a session. Stops screencast if running.
   */
  unregisterSession(sessionId: string): void {
    const sc = this.screencasts.get(sessionId);
    if (sc) {
      if (sc.capturer.isActive()) {
        sc.capturer.stopCapture().catch(() => {});
      }
      if (sc.focusPoll) {
        clearInterval(sc.focusPoll);
      }
      if (sc.elementScan) {
        clearInterval(sc.elementScan);
      }
      if (sc.staticSnapshotTimer) {
        clearTimeout(sc.staticSnapshotTimer);
      }
      this.screencasts.delete(sessionId);
    }
  }

  /**
   * Start standalone WS server on its own port.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('WebSocket server is already running');
    }

    const wsModule = await import('ws');
    this.wsServer = new wsModule.WebSocketServer({ host: this.host, port: this.port });

    this.setupConnectionHandler(this.wsServer);

    const addr = this.wsServer.address();
    if (addr && typeof addr === 'object') {
      this.port = addr.port;
    }

    this.wsServer.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.isRunning = true;
    this.emit('started', { port: this.port, host: this.host });
  }

  /**
   * Attach to an existing HTTP server via WS upgrade.
   * Shares the same port as the HTTP server (e.g., daemon port 9224).
   * The WS path defaults to `/preview`.
   */
  async attachToServer(httpServer: Server, path: string = '/preview'): Promise<void> {
    if (this.isRunning) {
      throw new Error('WebSocket server is already running');
    }

    const wsModule = await import('ws');
    this.wsServer = new wsModule.WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      if (request.url === path || request.url?.startsWith(path + '/')) {
        this.wsServer!.handleUpgrade(request, socket, head, (ws) => {
          // Extract sessionId from URL: /preview/{sessionId} or /preview/{sessionId}/
          const urlPath = (request.url || '').replace(/\?.*$/, '').replace(/\/+$/, '');
          const sessionId = urlPath === path ? undefined : urlPath.slice(path.length + 1);
          this.wsServer!.emit('connection', ws, request, sessionId);
        });
      }
    });

    this.setupConnectionHandler(this.wsServer);

    const addr = httpServer.address();
    if (addr && typeof addr === 'object') {
      this.port = addr.port;
    }

    this.isRunning = true;
    this.emit('started', { port: this.port, path });
  }

  /**
   * Set up the connection handler for incoming WS connections.
   * When attached to an HTTP server, the third argument carries the sessionId
   * extracted from the URL path (e.g., /preview/default).
   */
  private setupConnectionHandler(wsServer: InstanceType<typeof import('ws').WebSocketServer>): void {
    wsServer.on('connection', (ws: unknown, _req?: unknown, sessionIdFromUrl?: string) => {
      const wsLike = ws as WSLike;
      const clientId = crypto.randomUUID();
      const client: WSClient = {
        id: clientId,
        ws: wsLike,
      };

      this.clients.set(clientId, client);
      this.emit('client-connected', clientId);

      // Auto-bind to session from URL if present
      if (sessionIdFromUrl) {
        client.requestedSessionId = sessionIdFromUrl;
        if (this.screencasts.has(sessionIdFromUrl)) {
          client.sessionId = sessionIdFromUrl;
          let clients = this.sessionClients.get(sessionIdFromUrl);
          if (!clients) {
            clients = new Set();
            this.sessionClients.set(sessionIdFromUrl, clients);
          }
          clients.add(clientId);
          this.startScreencastIfNeeded(sessionIdFromUrl);
        } else {
          const known = Array.from(this.screencasts.keys());
          this.sendToClient(clientId, {
            type: 'error',
            data: {
              code: 'SESSION_NOT_FOUND',
              message: `Session "${sessionIdFromUrl}" not found. Available: ${known.length ? known.join(', ') : '(none)'}`,
              availableSessions: known,
            },
          });
        }
      }

      wsLike.on('close', () => {
        this.handleClientDisconnect(clientId);
      });

      wsLike.on('message', (...raw: unknown[]) => {
        const data = raw[0] as Buffer | string;
        try {
          const msg = JSON.parse(
            typeof data === 'string' ? data : data.toString()
          ) as WSInboundMessage;

          if (msg.type === 'bind') {
            this.bindClientToSession(clientId, msg.sessionId);
            return;
          }

          this.handleInboundMessage(clientId, msg).catch(() => {});
        } catch {
          // ignore parse errors
        }
      });

      this.sendToClient(clientId, {
        type: 'status',
        data: {
          status: 'connected',
          sessionId: client.sessionId || undefined,
          message: client.sessionId
            ? `Connected and bound to session: ${client.sessionId}`
            : 'Connected. Send {"type":"bind","sessionId":"..."} to start preview.',
        },
      });

      // Send viewport info asynchronously (may need page.evaluate for CDP mode)
      const initSc = client.sessionId ? this.screencasts.get(client.sessionId) : undefined;
      if (initSc?.page) {
        (async () => {
          try {
            const vp = this.lastFrameViewport
              || initSc.page.viewportSize()
              || await initSc.page.evaluate<{ width: number; height: number }>(() => ({ width: window.innerWidth, height: window.innerHeight }));
            this.sendToClient(clientId, {
              type: 'status',
              data: { status: 'connected', sessionId: client.sessionId || undefined, viewport: vp ?? undefined },
            });
          } catch { /* ignore */ }
        })();
      }
    });
  }

  /**
   * Lazy screencast: start when first client binds, stop when last unbinds.
   */
  private startScreencastIfNeeded(sessionId: string): void {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;

    if (sc.clientCount === 0 && !sc.capturer.isActive()) {
      sc.capturer.startCapture(sc.page, sessionId, (frame: ScreencastFrame) => {
        this.resetStaticSnapshotTimer(sessionId);
        (async () => {
          this.lastFrameData = frame.data.toString('base64');
          this.lastFrameViewport = frame.viewport;

          this.stateManager.onFrameReceived();
          const config = this.stateManager.getConfig();

          if (!this.frameRateController.shouldSendFrame(config.maxFps)) {
            return;
          }

          await this.processAndBroadcast(
            this.lastFrameData,
            frame.viewport,
            sessionId,
            frame.sessionId,
            frame.id,
            frame.timestamp,
            frame.url,
          );
        })().catch(() => {});
      }).then(() => {
        this.emit('screencast-started', sessionId);
      }).catch(() => {
        this.emit('screencast-started', sessionId);
      });
    }
    sc.clientCount++;

    // Replay last frame for newly connected client if available
    if (this.lastFrameData && this.lastFrameViewport && sc.capturer.isActive()) {
      this.processAndBroadcast(
        this.lastFrameData,
        this.lastFrameViewport,
        sessionId,
        sessionId,
        crypto.randomUUID(),
        Date.now(),
        '',
      ).catch(() => {});
    }
  }

  private stopScreencastIfNeeded(sessionId: string): void {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;

    sc.clientCount = Math.max(0, sc.clientCount - 1);
    if (sc.clientCount === 0 && sc.capturer.isActive()) {
      sc.capturer.stopCapture().then(() => {
        this.frameRateController.reset();
        this.lastFrameData = null;
        this.lastFrameViewport = null;
        this.emit('screencast-stopped', sessionId);
      }).catch(() => {
        this.emit('screencast-stopped', sessionId);
      });
    }
  }

  async pauseScreencast(sessionId: string): Promise<void> {
    const sc = this.screencasts.get(sessionId);
    if (sc?.capturer.isActive()) {
      await sc.capturer.stopCapture();
    }
  }

  async resumeScreencast(sessionId: string): Promise<void> {
    const sc = this.screencasts.get(sessionId);
    if (sc && !sc.capturer.isActive() && sc.clientCount > 0) {
      await sc.capturer.startCapture(sc.page, sessionId, (frame: ScreencastFrame) => {
        this.resetStaticSnapshotTimer(sessionId);
        (async () => {
          this.lastFrameData = frame.data.toString('base64');
          this.lastFrameViewport = frame.viewport;

          this.stateManager.onFrameReceived();
          const config = this.stateManager.getConfig();

          if (!this.frameRateController.shouldSendFrame(config.maxFps)) {
            return;
          }

          await this.processAndBroadcast(
            this.lastFrameData,
            frame.viewport,
            sessionId,
            frame.sessionId,
            frame.id,
            frame.timestamp,
            frame.url,
          );
        })().catch(() => {});
      }).catch(() => {});
    }
  }

  private sendToClient(clientId: string, message: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    try {
      client.ws.send(JSON.stringify(message));
    } catch {
      // ignore send errors
    }
  }

  private getClientPage(clientId: string): Page | null {
    const client = this.clients.get(clientId);
    if (!client?.sessionId) return null;
    return this.screencasts.get(client.sessionId)?.page ?? null;
  }

  private async handleInboundMessage(clientId: string, msg: WSInboundMessage): Promise<void> {
    const client = this.clients.get(clientId);
    const page = client?.sessionId
      ? this.screencasts.get(client.sessionId)?.page ?? null
      : null;
    // Adjust coordinates for active crop (sub-view offset)
    const crop = client?.sessionId ? this.sessionCrops.get(client.sessionId) : undefined;
    const ox = crop ? crop.box.x : 0;
    const oy = crop ? crop.box.y : 0;

    switch (msg.type) {
      case 'click':
        this.stateManager.onUserInteraction();
        if (page) {
          await page.mouse.click(msg.x + ox, msg.y + oy, { button: msg.button || 'left' });
        }
        break;

      case 'type':
        this.stateManager.onUserInteraction();
        if (page) {
          await page.keyboard.type(msg.text, { delay: 50 });
        }
        break;

      case 'keypress':
        this.stateManager.onUserInteraction();
        if (page) {
          await page.keyboard.press(msg.key);
        }
        break;

      case 'scroll':
        this.stateManager.onUserInteraction();
        if (page) {
          await page.mouse.wheel(msg.deltaX, msg.deltaY);
        }
        break;

      case 'solved':
        this.emit('human-solved', {
          sessionId: client?.sessionId ?? null,
          clientId,
        });
        break;

      case 'input_mouse': {
        this.stateManager.onUserInteraction();
        const p = this.getClientPage(clientId);
        if (!p) break;
        switch (msg.action) {
          case 'move': await p.mouse.move(msg.x + ox, msg.y + oy); break;
          case 'down': await p.mouse.down({ button: msg.button || 'left' }); break;
          case 'up': await p.mouse.up({ button: msg.button || 'left' }); break;
          case 'click': {
            await p.mouse.click(msg.x + ox, msg.y + oy, { button: msg.button || 'left' });
            break;
          }
        }
        break;
      }

      case 'input_keyboard': {
        this.stateManager.onUserInteraction();
        const p = this.getClientPage(clientId);
        if (!p) break;
        if (msg.action === 'down') await p.keyboard.down(msg.key);
        else await p.keyboard.up(msg.key);
        break;
      }

      case 'input_fill': {
        this.stateManager.onUserInteraction();
        const p = this.getClientPage(clientId);
        if (!p) break;
        await p.fill(msg.selector, msg.text);
        break;
      }

      case 'input_insert_text': {
        this.stateManager.onUserInteraction();
        const p = this.getClientPage(clientId);
        if (!p) break;
        await p.keyboard.insertText(msg.text);
        break;
      }

      case 'file_upload': {
        const p = this.getClientPage(clientId);
        if (!p) break;
        try {
          const selector = msg.selector || 'input[type="file"]';
          const result = await p.evaluate<{ ok: boolean; error?: string }>(({ sel, fileName, base64Data, mimeType }: { sel: string; fileName: string; base64Data: string; mimeType: string }) => {
            const input = document.querySelector(sel) as HTMLInputElement;
            if (!input) return { ok: false, error: 'File input not found: ' + sel };
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            const file = new File([bytes], fileName, { type: mimeType });
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          }, { sel: selector, fileName: msg.fileName, base64Data: msg.data, mimeType: msg.mimeType });
          if (result.ok) {
            this.sendToClient(clientId, { type: 'file_upload_result', success: true, fileName: msg.fileName });
          } else {
            this.sendToClient(clientId, { type: 'file_upload_result', success: false, fileName: msg.fileName, error: result.error });
          }
        } catch (err) {
          this.sendToClient(clientId, { type: 'file_upload_result', success: false, fileName: msg.fileName, error: String(err) });
        }
        break;
      }

      case 'file_list': {
        try {
          const { readdirSync, statSync } = await import('fs');
          const { join, resolve } = await import('path');
          const targetPath = resolve(msg.path);
          const entries = readdirSync(targetPath);
          const files = entries.map(name => {
            try {
              const stat = statSync(join(targetPath, name));
              return { name, isDir: stat.isDirectory(), size: stat.size, modified: stat.mtime.toISOString() };
            } catch {
              return { name, isDir: false, size: 0, modified: '' };
            }
          });
          this.sendToClient(clientId, { type: 'file_list_result', path: targetPath, files });
        } catch (err) {
          this.sendToClient(clientId, { type: 'file_list_result', path: msg.path, files: [], error: String(err) });
        }
        break;
      }

      case 'file_download': {
        try {
          const { readFileSync } = await import('fs');
          const { resolve, basename } = await import('path');
          const targetPath = resolve(msg.path);
          const data = readFileSync(targetPath);
          const base64 = data.toString('base64');
          const ext = targetPath.split('.').pop()?.toLowerCase() || '';
          const mimeMap: Record<string, string> = {
            txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript',
            json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip',
            md: 'text/markdown', xml: 'text/xml', csv: 'text/csv',
          };
          const mimeType = mimeMap[ext] || 'application/octet-stream';
          this.sendToClient(clientId, { type: 'file_download_result', fileName: basename(targetPath), mimeType, data: base64 });
        } catch (err) {
          this.sendToClient(clientId, { type: 'file_download_result', fileName: '', mimeType: '', data: '', error: String(err) });
        }
        break;
      }

      case 'focus_element': {
        this.stateManager.onUserInteraction();
        const p = this.getClientPage(clientId);
        if (!p) break;
        const sid = client?.sessionId || '';
        try {
          const element = await p.$(msg.selector);
          if (element) {
            const box = await element.boundingBox();
            if (box) {
              this.sessionCrops.set(sid, { selector: msg.selector, box: { x: box.x, y: box.y, width: box.width, height: box.height } });
              this.broadcastToSession(sid, {
                type: 'status',
                data: { status: 'connected', viewport: { width: box.width, height: box.height } },
              });
              if (this.lastFrameData && this.lastFrameViewport) {
                await this.processAndBroadcast(
                  this.lastFrameData,
                  this.lastFrameViewport,
                  sid,
                  sid,
                  crypto.randomUUID(),
                  Date.now(),
                  '',
                );
              }
            }
          }
        } catch { /* ignore */ }
        break;
      }

      case 'focus_clear': {
        const sid = client?.sessionId || '';
        this.sessionCrops.delete(sid);
        if (this.lastFrameViewport) {
          this.broadcastToSession(sid, {
            type: 'status',
            data: { status: 'connected', viewport: this.lastFrameViewport },
          });
        }
        if (this.lastFrameData && this.lastFrameViewport) {
          await this.processAndBroadcast(
            this.lastFrameData,
            this.lastFrameViewport,
            sid,
            sid,
            crypto.randomUUID(),
            Date.now(),
            '',
          );
        }
        break;
      }

      case 'select_view': {
        const sid = client?.sessionId || '';
        if (!msg.rect) {
          this.sessionCrops.delete(sid);
          if (this.lastFrameViewport) {
            this.broadcastToSession(sid, {
              type: 'status',
              data: { status: 'connected', viewport: this.lastFrameViewport },
            });
          }
        } else {
          this.sessionCrops.set(sid, { selector: 'view', box: msg.rect });
          this.broadcastToSession(sid, {
            type: 'status',
            data: { status: 'connected', viewport: { width: msg.rect.width, height: msg.rect.height } },
          });
        }
        if (this.lastFrameData && this.lastFrameViewport) {
          await this.processAndBroadcast(
            this.lastFrameData,
            this.lastFrameViewport,
            sid,
            sid,
            crypto.randomUUID(),
            Date.now(),
            '',
          );
        }
        break;
      }

      case 'input_blur': {
        const sid = client?.sessionId || '';
        const sc = this.screencasts.get(sid);
        if (sc?.page) {
          sc.lastFocusKey = '';
          try {
            await sc.page.evaluate(() => {
              (document.activeElement as HTMLElement)?.blur();
              (window as unknown as Record<string, unknown>).__xb_last_focused = null;
            });
          } catch { /* ignore */ }
        }
        break;
      }
    }
  }

  async stop(): Promise<void> {
    // Stop all screencasts
    const stopPromises: Promise<void>[] = [];
    for (const [sessionId, sc] of this.screencasts) {
      if (sc.capturer.isActive()) {
        stopPromises.push(sc.capturer.stopCapture().catch(() => {}));
        this.emit('screencast-stopped', sessionId);
      }
    }
    await Promise.all(stopPromises);

    // Close all clients
    for (const client of this.clients.values()) {
      try { client.ws.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.sessionClients.clear();

    if (!this.wsServer) {
      this.isRunning = false;
      return;
    }

    return new Promise((resolve, reject) => {
      this.wsServer!.close((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          this.wsServer = null;
          this.isRunning = false;
          this.emit('stopped');
          resolve();
        }
      });
    });
  }

  bindClientToSession(clientId: string, sessionId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Unbind from previous session if any
    if (client.sessionId) {
      const prevClients = this.sessionClients.get(client.sessionId);
      if (prevClients) {
        prevClients.delete(clientId);
        if (prevClients.size === 0) {
          this.sessionClients.delete(client.sessionId);
        }
      }
      this.stopScreencastIfNeeded(client.sessionId);
    }

    // Bind to new session
    client.sessionId = sessionId;
    let clients = this.sessionClients.get(sessionId);
    if (!clients) {
      clients = new Set();
      this.sessionClients.set(sessionId, clients);
    }
    clients.add(clientId);

    // Lazy start screencast
    this.startScreencastIfNeeded(sessionId);

    const sc = this.screencasts.get(sessionId);
    this.sendToClient(clientId, {
      type: 'status',
      data: { status: 'connected', sessionId, message: `Bound to session: ${sessionId}` },
    });
    if (sc?.page) {
      (async () => {
        try {
          const vp = this.lastFrameViewport
            || sc.page.viewportSize()
            || await sc.page.evaluate<{ width: number; height: number }>(() => ({ width: window.innerWidth, height: window.innerHeight }));
          this.sendToClient(clientId, {
            type: 'status',
            data: { status: 'connected', sessionId, viewport: vp ?? undefined },
          });
        } catch { /* ignore */ }
      })();
    }
  }

  broadcastToSession(sessionId: string, message: WSMessage): void {
    const clients = this.sessionClients.get(sessionId);
    if (!clients) return;

    for (const clientId of clients) {
      this.sendToClient(clientId, message);
    }
  }

  broadcast(message: WSMessage): void {
    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, message);
    }
  }

  broadcastBinaryToSession(sessionId: string, payload: Buffer): void {
    const clients = this.sessionClients.get(sessionId);
    if (!clients) return;
    for (const clientId of clients) {
      const client = this.clients.get(clientId);
      if (!client) continue;
      try {
        client.ws.send(payload);
      } catch {
        // ignore send errors
      }
    }
  }

  private handleClientDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.sessionId) {
      const clients = this.sessionClients.get(client.sessionId);
      if (clients) {
        clients.delete(clientId);
        if (clients.size === 0) {
          this.sessionClients.delete(client.sessionId);
        }
      }
      // Lazy stop screencast
      this.stopScreencastIfNeeded(client.sessionId);
    }

    this.clients.delete(clientId);
    this.emit('client-disconnected', clientId);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getSessionClientCount(sessionId: string): number {
    const clients = this.sessionClients.get(sessionId);
    return clients ? clients.size : 0;
  }

  getRunning(): boolean {
    return this.isRunning;
  }

  getPort(): number {
    return this.port;
  }
}
