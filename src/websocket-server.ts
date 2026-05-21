import { EventEmitter } from 'events';
import type { Server } from 'http';
import type { Page } from 'playwright';
import { ScreencastCapturer, type ScreencastFrame } from './screencast.js';

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
  | { type: 'file_list_result'; path: string; files: Array<{ name: string; isDir: boolean; size: number; modified: string }>; error?: string }
  | { type: 'file_download_result'; fileName: string; mimeType: string; data: string; error?: string }
  | { type: 'error'; data: { code: string; message: string; availableSessions?: string[] } };

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
  | { type: 'file_download'; path: string };

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
}

interface WSClient {
  id: string;
  sessionId?: string;
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

  constructor(config: WSServerConfig = {}) {
    super();
    this.port = config.port ?? 9223;
    this.host = config.host || '0.0.0.0';
  }

  /**
   * Register a session page for screencast streaming.
   * Call this when a session is created. The capturer will only start
   * when a WS client binds to this session.
   */
  registerSession(sessionId: string, page: Page, options?: { interval?: number; quality?: number; type?: 'jpeg' | 'png' }): void {
    if (this.screencasts.has(sessionId)) return;
    this.screencasts.set(sessionId, {
      capturer: new ScreencastCapturer({
        interval: options?.interval ?? 500,
        quality: options?.quality ?? 80,
        type: options?.type ?? 'jpeg',
      }),
      page,
      clientCount: 0,
    });

     const injectFocusListeners = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__xb_focus_fn = () => {
      document.addEventListener('focusin', (e) => {
        const el = e.target as HTMLElement;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true') {
          const info: { selector: string; tag: string; value: string; placeholder: string } = {
            selector: '',
            tag: el.tagName,
            value: (el as HTMLInputElement).value || '',
            placeholder: (el as HTMLInputElement).placeholder || '',
          };
          if (el.id) info.selector = '#' + el.id;
          else if (el.getAttribute('name')) info.selector = '[name="' + el.getAttribute('name') + '"]';
          else info.selector = el.tagName.toLowerCase();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__xb_last_focused = info;
        }
      }, true);
      document.addEventListener('focusout', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__xb_last_focused = null;
      }, true);
     }; };
     page.evaluate(injectFocusListeners).catch(() => {});

      // Re-inject focus listeners after navigation (page.evaluate listeners are lost on navigation)
      page.on('load', () => {
        page.evaluate(injectFocusListeners).catch(() => {});
      });

    const focusPoll = setInterval(async () => {
      const sc = this.screencasts.get(sessionId);
      if (!sc || !this.getSessionClientCount(sessionId)) return;
       try {
         type FocusInfo = { focused: boolean; selector?: string; value?: string; tag?: string; placeholder?: string };
          const info: FocusInfo = await page.evaluate(() => {
            // Check __xb_last_focused first, then fallback to activeElement
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const f = (window as any).__xb_last_focused;
           if (f) return { focused: true, ...(f as Record<string, string>) };
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
             };
           }
           return { focused: false };
         });
         if (info.focused && info.selector) {
           this.broadcastToSession(sessionId, { type: 'input_focused', selector: info.selector, value: info.value || '', tag: info.tag || '', placeholder: info.placeholder });
         } else {
           this.broadcastToSession(sessionId, { type: 'input_blur', selector: '' });
         }
       } catch { /* ignore evaluate errors */ }
    }, 500);

    this.screencasts.get(sessionId)!.focusPoll = focusPoll;
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
        const header = Buffer.from(JSON.stringify({
          type: 'screenshot',
          data: {
            sessionId: frame.sessionId,
            id: frame.id,
            timestamp: frame.timestamp,
            url: frame.url,
            viewport: frame.viewport,
          },
        }), 'utf-8');
        const headerLen = Buffer.alloc(4);
        headerLen.writeUInt32BE(header.length, 0);
        const payload = Buffer.concat([headerLen, header, frame.data]);
        this.broadcastBinaryToSession(sessionId, payload);
      }).then(() => {
        this.emit('screencast-started', sessionId);
      }).catch(() => {
        // CDP Cast start failed — fallback polling is handled internally
        this.emit('screencast-started', sessionId);
      });
    }
    sc.clientCount++;
  }

  private stopScreencastIfNeeded(sessionId: string): void {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;

    sc.clientCount = Math.max(0, sc.clientCount - 1);
    if (sc.clientCount === 0 && sc.capturer.isActive()) {
      sc.capturer.stopCapture().then(() => {
        this.emit('screencast-stopped', sessionId);
      }).catch(() => {
        this.emit('screencast-stopped', sessionId);
      });
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

    switch (msg.type) {
      case 'click':
        if (page) {
          await page.mouse.click(msg.x, msg.y, { button: msg.button || 'left' });
        }
        break;

      case 'type':
        if (page) {
          await page.keyboard.type(msg.text, { delay: 50 });
        }
        break;

      case 'keypress':
        if (page) {
          await page.keyboard.press(msg.key);
        }
        break;

      case 'scroll':
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
        const p = this.getClientPage(clientId);
        if (!p) break;
        switch (msg.action) {
          case 'move': await p.mouse.move(msg.x, msg.y); break;
          case 'down': await p.mouse.down({ button: msg.button || 'left' }); break;
          case 'up': await p.mouse.up({ button: msg.button || 'left' }); break;
          case 'click': {
            await p.mouse.click(msg.x, msg.y, { button: msg.button || 'left' });
            // Focus the element under the click point and set __xb_last_focused
            // (mouse.click doesn't auto-focus or trigger focusin in CDP mode)
            try {
              await p.evaluate(({ x, y }) => {
                const el = document.elementFromPoint(x, y) as HTMLElement | null;
                if (el && typeof el.focus === 'function') {
                  el.focus();
                  // Manually set __xb_last_focused since focusin may not fire in CDP mode
                  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true') {
                    const info: { selector: string; tag: string; value: string; placeholder: string } = {
                      selector: '',
                      tag: el.tagName,
                      value: (el as HTMLInputElement).value || '',
                      placeholder: (el as HTMLInputElement).placeholder || '',
                    };
                    if (el.id) info.selector = '#' + el.id;
                    else if (el.getAttribute('name')) info.selector = '[name="' + el.getAttribute('name') + '"]';
                     else info.selector = el.tagName.toLowerCase();
                     // eslint-disable-next-line @typescript-eslint/no-explicit-any
                     (window as any).__xb_last_focused = info;
                  }
                }
              }, { x: msg.x, y: msg.y });
            } catch (err) {
              this.emit('error', new Error(`focus-after-click failed: ${err}`));
            }
            break;
          }
        }
        break;
      }

      case 'input_keyboard': {
        const p = this.getClientPage(clientId);
        if (!p) break;
        if (msg.action === 'down') await p.keyboard.down(msg.key);
        else await p.keyboard.up(msg.key);
        break;
      }

      case 'input_fill': {
        const p = this.getClientPage(clientId);
        if (!p) break;
        await p.fill(msg.selector, msg.text);
        break;
      }

      case 'input_insert_text': {
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
          const result = await p.evaluate(({ sel, fileName, base64Data, mimeType }: { sel: string; fileName: string; base64Data: string; mimeType: string }) => {
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

    this.sendToClient(clientId, {
      type: 'status',
      data: { status: 'connected', sessionId, message: `Bound to session: ${sessionId}` },
    });
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
