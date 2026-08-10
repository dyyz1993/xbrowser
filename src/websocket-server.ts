import { EventEmitter } from 'events';
import type { Server } from 'http';
import type { Page } from './browser-shim.js';
import { StreamCoordinator } from './ws/stream-coordinator.js';
import { SessionManager, type WSClient, type WSLike } from './ws/session-manager.js';
import { MessageDispatcher } from './ws/message-handler.js';
import type { MessageContext } from './ws/message-handler.js';

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
  | { type: 'health_pong'; ts: number }
  | { type: 'snapshot_result'; data: { data: string; format: string } | null; error?: string }
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
  | { type: 'reconnect' }
  | { type: 'health_ping'; ts: number }
  | { type: 'snapshot_request'; format?: string; quality?: number }
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

// ---------------------------------------------------------------------------
// WSServer — thin orchestration layer
// ---------------------------------------------------------------------------

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
 *
 * Responsibilities are delegated to:
 * - **SessionManager**: client/session lifecycle, capturer start/stop, element monitors
 * - **StreamCoordinator**: frame processing, stream state, crop management
 * - **MessageDispatcher**: inbound message routing to typed handlers
 */
export class WSServer extends EventEmitter {
  private port: number;
  private host: string;
  private wsServer: InstanceType<typeof import('ws').WebSocketServer> | null = null;
  private isRunning = false;

  // Composed modules
  private readonly streamCoordinator: StreamCoordinator;
  private readonly sessionManager: SessionManager;
  private readonly messageDispatcher: MessageDispatcher;

  constructor(config: WSServerConfig = {}) {
    super();
    this.port = config.port ?? 9223;
    this.host = config.host || '0.0.0.0';

    // The WSServer itself is the broadcast sink for binary frames
    this.streamCoordinator = new StreamCoordinator(this);
    this.sessionManager = new SessionManager();
    this.sessionManager.setStreamCoordinator(this.streamCoordinator);
    this.messageDispatcher = new MessageDispatcher(this.streamCoordinator, this.sessionManager);

    this.setupSessionManagerEvents();
  }

  // -----------------------------------------------------------------------
  // SessionManager event wiring
  // -----------------------------------------------------------------------

  private setupSessionManagerEvents(): void {
    this.sessionManager.on('client-bound', (clientId: string, sessionId: string) => {
      this.startScreencastIfNeeded(sessionId);
      this.sendBoundStatus(clientId, sessionId);
    });

    this.sessionManager.on('client-unbound', (_clientId: string, sessionId: string) => {
      this.stopScreencastIfNeeded(sessionId);
    });

    this.sessionManager.on('broadcast', (sessionId: string, message: WSMessage) => {
      this.broadcastToSession(sessionId, message);
    });

    this.sessionManager.on('auto-bind', (clientId: string, sessionId: string) => {
      this.bindClientToSession(clientId, sessionId);
    });

    this.sessionManager.on('screencast-stopped', (sessionId: string) => {
      this.emit('screencast-stopped', sessionId);
    });
  }

  // -----------------------------------------------------------------------
  // Public session API (delegates to SessionManager)
  // -----------------------------------------------------------------------

  registerSession(sessionId: string, page: Page, options?: { interval?: number; quality?: number; type?: 'jpeg' | 'png'; width?: number; height?: number }): void {
    this.sessionManager.registerSession(sessionId, page, options);
  }

  /** Restart screencast for a session — used by viewer reconnect button. */
  async reconnectSession(sessionId: string): Promise<void> {
    try {
      await this.sessionManager.stopCapturer(sessionId);
      await new Promise(r => setTimeout(r, 500));
      await this.sessionManager.startCapturer(sessionId);
    } catch { /* best effort */ }
  }

  unregisterSession(sessionId: string): void {
    this.sessionManager.unregisterSession(sessionId);
  }

  async pauseScreencast(sessionId: string): Promise<void> {
    await this.sessionManager.pauseCapturer(sessionId);
  }

  async resumeScreencast(sessionId: string): Promise<void> {
    await this.sessionManager.resumeCapturer(sessionId);
  }

  // -----------------------------------------------------------------------
  // Lazy screencast start/stop
  // -----------------------------------------------------------------------

  private startScreencastIfNeeded(sessionId: string): void {
    const count = this.sessionManager.getSessionClientCount2(sessionId);
    if (count === 0 && !this.sessionManager.isCapturerActive(sessionId)) {
      this.sessionManager.startCapturer(sessionId).then(() => {
        this.emit('screencast-started', sessionId);
      }).catch(() => {
        this.emit('screencast-started', sessionId);
      });
    }
    this.sessionManager.incrementClientCount(sessionId);

    // Replay last frame for newly connected client — even if screencast is
    // still starting up, the cached frame from the previous connection gives
    // the viewer something to render immediately.
    if (this.streamCoordinator.getLastFrameViewport()) {
      this.streamCoordinator.replayLastFrame(sessionId).catch(() => {});
    }
  }

  private stopScreencastIfNeeded(sessionId: string): void {
    const count = this.sessionManager.decrementClientCount(sessionId);
    if (count === 0 && this.sessionManager.isCapturerActive(sessionId)) {
      this.sessionManager.stopCapturer(sessionId).then(() => {
        this.streamCoordinator.resetFrameRate();
        // Keep lastFrame cached so a quick viewer reconnect (e.g. page refresh)
        // can replay it immediately instead of showing a blank screen.
        // The frame is cleared on full session teardown, not on client disconnect.
        this.emit('screencast-stopped', sessionId);
      }).catch(() => {
        this.emit('screencast-stopped', sessionId);
      });
    }
  }

  // -----------------------------------------------------------------------
  // Client binding
  // -----------------------------------------------------------------------

  bindClientToSession(clientId: string, sessionId: string): void {
    this.sessionManager.bindClientToSession(clientId, sessionId);
  }

  private sendBoundStatus(clientId: string, sessionId: string): void {
    const sc = this.sessionManager.getSession(sessionId);
    this.sendToClient(clientId, {
      type: 'status',
      data: { status: 'connected', sessionId, message: `Bound to session: ${sessionId}` },
    });
    if (sc?.page) {
      (async () => {
        try {
          const vp = this.streamCoordinator.getLastFrameViewport()
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

  // -----------------------------------------------------------------------
  // Server start / stop
  // -----------------------------------------------------------------------

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

  async attachToServer(httpServer: Server, path: string = '/preview'): Promise<void> {
    if (this.isRunning) {
      throw new Error('WebSocket server is already running');
    }

    const wsModule = await import('ws');
    this.wsServer = new wsModule.WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      if (request.url === path || request.url?.startsWith(path + '/')) {
        this.wsServer!.handleUpgrade(request, socket, head, (ws) => {
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

  async stop(): Promise<void> {
    await this.sessionManager.stopAllScreencasts();
    this.sessionManager.closeAllClients();

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

  // -----------------------------------------------------------------------
  // Connection handler
  // -----------------------------------------------------------------------

  private setupConnectionHandler(wsServer: InstanceType<typeof import('ws').WebSocketServer>): void {
    wsServer.on('connection', (ws: unknown, _req?: unknown, sessionIdFromUrl?: string) => {
      const wsLike = ws as WSLike;
      const clientId = crypto.randomUUID();
      const client: WSClient = { id: clientId, ws: wsLike };

      this.sessionManager.addClient(client);

      // Auto-bind to session from URL if present
      if (sessionIdFromUrl) {
        client.requestedSessionId = sessionIdFromUrl;
        if (this.sessionManager.hasSession(sessionIdFromUrl)) {
          this.sessionManager.quickBind(clientId, sessionIdFromUrl);
          this.startScreencastIfNeeded(sessionIdFromUrl);
        } else {
          const known = this.sessionManager.getSessionIds();
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

      // Send viewport info asynchronously
      const initSessionId = client.sessionId;
      const initPage = initSessionId ? this.sessionManager.getPageForSession(initSessionId) : undefined;
      if (initPage) {
        (async () => {
          try {
            const vp = this.streamCoordinator.getLastFrameViewport()
              || initPage.viewportSize()
              || await initPage.evaluate<{ width: number; height: number }>(() => ({ width: window.innerWidth, height: window.innerHeight }));
            this.sendToClient(clientId, {
              type: 'status',
              data: { status: 'connected', sessionId: initSessionId || undefined, viewport: vp ?? undefined },
            });
          } catch { /* ignore */ }
        })();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Inbound message handling
  // -----------------------------------------------------------------------

  private async handleInboundMessage(clientId: string, msg: WSInboundMessage): Promise<void> {
    const sessionId = this.sessionManager.getClientSessionId(clientId);
    const page = sessionId ? this.sessionManager.getPageForSession(sessionId) ?? null : null;

    // Adjust coordinates for active crop (sub-view offset)
    const crop = sessionId ? this.streamCoordinator.getCrop(sessionId) : undefined;
    const ox = crop ? crop.box.x : 0;
    const oy = crop ? crop.box.y : 0;

    // 'solved' is special — emits on WSServer itself
    if (msg.type === 'solved') {
      this.emit('human-solved', { sessionId: sessionId ?? null, clientId });
      return;
    }

    // 'reconnect' — viewer requests CDP session reconnection
    if (msg.type === 'reconnect') {
      this.emit('reconnect-request', { sessionId: sessionId ?? null, clientId });
      return;
    }

    // 'health_ping' — viewer health check, reply with pong
    if (msg.type === 'health_ping') {
      this.sendToClient(clientId, { type: 'health_pong', ts: msg.ts });
      return;
    }

    // 'snapshot_request' — viewer requests a high-quality screenshot
    if (msg.type === 'snapshot_request') {
      const page = sessionId ? this.sessionManager.getPageForSession(sessionId) : undefined;
      if (!page) {
        this.sendToClient(clientId, { type: 'snapshot_result', data: null, error: 'no page' });
        return;
      }
      const fmt = (msg.format === 'webp') ? 'webp' : 'png';
      page.screenshot({ type: fmt, quality: fmt === 'webp' ? (msg.quality ?? 90) : undefined })
        .then((buf: Buffer) => {
          this.sendToClient(clientId, {
            type: 'snapshot_result',
            data: { data: buf.toString('base64'), format: fmt },
          });
        })
        .catch(() => {
          this.sendToClient(clientId, { type: 'snapshot_result', data: null, error: 'screenshot failed' });
        });
      return;
    }

    const ctx: MessageContext = {
      clientId,
      sessionId,
      page,
      message: msg,
      cropOffset: { ox, oy },
      sendToClient: (id, message) => this.sendToClient(id, message),
      broadcastToSession: (sid, message) => this.broadcastToSession(sid, message),
    };

    await this.messageDispatcher.dispatch(ctx);
  }

  // -----------------------------------------------------------------------
  // Client disconnect
  // -----------------------------------------------------------------------

  private handleClientDisconnect(clientId: string): void {
    const sessionId = this.sessionManager.getClientSessionId(clientId);
    if (sessionId) {
      this.stopScreencastIfNeeded(sessionId);
    }
    this.sessionManager.unbindClient(clientId);
    this.sessionManager.removeClient(clientId);
    this.emit('client-disconnected', clientId);
  }

  // -----------------------------------------------------------------------
  // Message sending
  // -----------------------------------------------------------------------

  private sendToClient(clientId: string, message: WSMessage): void {
    const client = this.sessionManager.getClient(clientId);
    if (!client) return;
    try {
      client.ws.send(JSON.stringify(message));
    } catch {
      // ignore send errors
    }
  }

  broadcastToSession(sessionId: string, message: WSMessage): void {
    const clients = this.sessionManager.getSessionClients(sessionId);
    if (!clients) return;
    for (const clientId of clients) {
      this.sendToClient(clientId, message);
    }
  }

  broadcast(message: WSMessage): void {
    for (const clientId of this.sessionManager.getAllClientIds()) {
      this.sendToClient(clientId, message);
    }
  }

  broadcastBinaryToSession(sessionId: string, payload: Buffer): void {
    const clients = this.sessionManager.getSessionClients(sessionId);
    if (!clients) return;
    for (const clientId of clients) {
      const client = this.sessionManager.getClient(clientId);
      if (!client) continue;
      try {
        client.ws.send(payload);
      } catch {
        // ignore send errors
      }
    }
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  getClientCount(): number {
    return this.sessionManager.getClientCount();
  }

  getSessionClientCount(sessionId: string): number {
    return this.sessionManager.getSessionClientCount(sessionId);
  }

  getRunning(): boolean {
    return this.isRunning;
  }

  getPort(): number {
    return this.port;
  }
}
