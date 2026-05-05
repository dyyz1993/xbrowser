import { EventEmitter } from 'events';

export interface WSServerConfig {
  port?: number;
  host?: string;
}

export type WSMessage =
  | { type: 'screenshot'; data: ScreencastMessage }
  | { type: 'command'; data: CommandMessage }
  | { type: 'status'; data: StatusMessage };

export interface ScreencastMessage {
  sessionId: string;
  id: string;
  timestamp: number;
  data: string;
  url: string;
  viewport: { width: number; height: number };
}

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

export class WSServer extends EventEmitter {
  private port: number;
  private host: string;
  private clients: Map<string, WSClient> = new Map();
  private sessionClients: Map<string, Set<string>> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any = null;
  private isRunning = false;

  constructor(config: WSServerConfig = {}) {
    super();
    this.port = config.port || 9223;
    this.host = config.host || '0.0.0.0';
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('WebSocket server is already running');
    }

    try {
      const wsModule = await import('ws');
      this.server = new wsModule.WebSocketServer({ host: this.host, port: this.port });

      this.server.on('connection', (ws: unknown) => {
        const clientId = crypto.randomUUID();
        const client: WSClient = {
          id: clientId,
          send: (data: string) => {
            try {
              (ws as { send: (data: string) => void }).send(data);
            } catch {
              // ignore send errors
            }
          },
          close: () => {
            try {
              (ws as { close: () => void }).close();
            } catch {
              // ignore close errors
            }
          },
        };

        this.clients.set(clientId, client);
        this.emit('client-connected', clientId);

        (ws as { on: (event: string, handler: () => void) => void }).on(
          'close',
          () => {
            this.handleClientDisconnect(clientId);
          }
        );

        (ws as { on: (event: string, handler: (data: Buffer | string) => void) => void }).on(
          'message',
          (data: Buffer | string) => {
            try {
              const message = JSON.parse(data.toString()) as { type: string; sessionId?: string };
              if (message.sessionId) {
                this.bindClientToSession(clientId, message.sessionId);
              }
            } catch {
              // ignore parse errors
            }
          }
        );

        client.send(
          JSON.stringify({
            type: 'status',
            data: { status: 'connected', message: 'Connected to preview server' },
          } satisfies WSMessage)
        );
      });

      this.server.on('error', (error: Error) => {
        this.emit('error', error);
      });

      this.isRunning = true;
      this.emit('started', { port: this.port, host: this.host });
    } catch (error) {
      throw new Error(`Failed to start WebSocket server: ${error instanceof Error ? error.message : String(error)}`);
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
}
