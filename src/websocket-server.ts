import { EventEmitter } from 'events';
import type { Page } from 'playwright';
import type { WebSocketServer } from 'ws';

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
  | { type: 'resolved'; sessionId: string };

/**
 * Inbound WebSocket message types received from connected clients.
 */
export type WSInboundMessage =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' }
  | { type: 'type'; text: string }
  | { type: 'keypress'; key: string }
  | { type: 'scroll'; deltaX: number; deltaY: number }
  | { type: 'solved' }
  | { type: 'bind'; sessionId: string };

/**
 * A screencast frame message with base64-encoded screenshot data.
 */
export interface ScreencastMessage {
  sessionId: string;
  id: string;
  timestamp: number;
  data: string;
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
  send: (data: string) => void;
  close: () => void;
}

interface WSLike {
  send: (data: string) => void;
  close: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

/**
 * WebSocket server for streaming browser screenshots and handling remote input.
 *
 * Supports session-based client binding, screencast streaming, and inbound
 * mouse/keyboard events for remote browser control.
 */
export class WSServer extends EventEmitter {
  private port: number;
  private host: string;
  private clients: Map<string, WSClient> = new Map();
  private sessionClients: Map<string, Set<string>> = new Map();
  private server: WebSocketServer | null = null;
  private isRunning = false;
  private page: Page | null = null;

  constructor(config: WSServerConfig = {}) {
    super();
    this.port = config.port ?? 9223;
    this.host = config.host || '0.0.0.0';
  }

  setPage(page: Page): void {
    this.page = page;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('WebSocket server is already running');
    }

    try {
      const wsModule = await import('ws');
      this.server = new wsModule.WebSocketServer({ host: this.host, port: this.port });

      this.server.on('connection', (ws: unknown) => {
        const wsLike = ws as WSLike;
        const clientId = crypto.randomUUID();
        const client: WSClient = {
          id: clientId,
          send: (data: string) => {
            try {
              wsLike.send(data);
            } catch {
              // ignore send errors
            }
          },
          close: () => {
            try {
              wsLike.close();
            } catch {
              // ignore close errors
            }
          },
        };

        this.clients.set(clientId, client);
        this.emit('client-connected', clientId);

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

            this.handleInboundMessage(clientId, msg);
          } catch {
            // ignore parse errors
          }
        });

        client.send(
          JSON.stringify({
            type: 'status',
            data: { status: 'connected', message: 'Connected to preview server' },
          } satisfies WSMessage)
        );
      });

      const addr = this.server.address();
      if (addr && typeof addr === 'object') {
        this.port = addr.port;
      }

      this.server.on('error', (error: Error) => {
        this.emit('error', error);
      });

      this.isRunning = true;
      this.emit('started', { port: this.port, host: this.host });
    } catch (error) {
      throw new Error(`Failed to start WebSocket server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleInboundMessage(clientId: string, msg: WSInboundMessage): Promise<void> {
    const client = this.clients.get(clientId);

    switch (msg.type) {
      case 'click':
        if (this.page) {
          await this.page.mouse.click(msg.x, msg.y, {
            button: msg.button || 'left',
          });
        }
        break;

      case 'type':
        if (this.page) {
          await this.page.keyboard.type(msg.text, { delay: 50 });
        }
        break;

      case 'keypress':
        if (this.page) {
          await this.page.keyboard.press(msg.key);
        }
        break;

      case 'scroll':
        if (this.page) {
          await this.page.mouse.wheel(msg.deltaX, msg.deltaY);
        }
        break;

      case 'solved':
        this.emit('human-solved', {
          sessionId: client?.sessionId ?? null,
          clientId,
        });
        break;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();
    this.sessionClients.clear();

    return new Promise((resolve, reject) => {
      this.server!.close((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
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

    client.sessionId = sessionId;

    let clients = this.sessionClients.get(sessionId);
    if (!clients) {
      clients = new Set();
      this.sessionClients.set(sessionId, clients);
    }
    clients.add(clientId);

    client.send(
      JSON.stringify({
        type: 'status',
        data: { status: 'connected', sessionId, message: `Bound to session: ${sessionId}` },
      } satisfies WSMessage)
    );
  }

  broadcastToSession(sessionId: string, message: WSMessage): void {
    const clients = this.sessionClients.get(sessionId);
    if (!clients) return;

    const data = JSON.stringify(message);
    for (const clientId of clients) {
      const client = this.clients.get(clientId);
      if (client) {
        client.send(data);
      }
    }
  }

  broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      client.send(data);
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

  getPage(): Page | null {
    return this.page;
  }
}
