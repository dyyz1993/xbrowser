import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { resolveTokens, validateAuth, isAuthRequired, isLoopbackHost } from './auth.js';
import { handleRequest } from './router.js';
import type { HTTPServerConfig } from './types.js';

/**
 * HTTP server exposing the xbrowser REST API for remote command execution.
 *
 * Provides endpoints for health checks, session management, single command
 * execution, and command chain execution. Supports Bearer token
 * authentication via config or environment variable.
 *
 * Secure defaults: binds loopback (127.0.0.1) only, and grants CORS only
 * to loopback browser origins. Binding a non-loopback host requires a
 * token — `start()` refuses otherwise.
 */
export class HTTPServer {
  private port: number;
  private host: string;
  private server: Server | null = null;
  private validTokens: string[];
  private corsOrigins: string[] | undefined;

  constructor(config?: HTTPServerConfig) {
    this.port = config?.port ?? 9224;
    this.host = config?.host ?? '127.0.0.1';
    this.validTokens = resolveTokens(config?.tokens);
    this.corsOrigins = config?.corsOrigins;
  }

  /**
   * Start the HTTP server and begin listening for requests.
   *
   * @returns The actual port and host the server bound to.
   * @throws If the server is already running, if binding a non-loopback
   *   host without an auth token, or if the port cannot be bound.
   */
  async start(): Promise<{ port: number; host: string }> {
    if (this.server) {
      throw new Error('HTTP server is already running');
    }

    if (!isLoopbackHost(this.host) && !isAuthRequired(this.validTokens)) {
      throw new Error(
        `Refusing to start on non-loopback host "${this.host}" without an auth token — ` +
        `the API exposes session creation and command execution. ` +
        `Bind loopback only (the default, or --host 127.0.0.1), or provide a token via ` +
        `--token or XBROWSER_SERVER_TOKEN.`
      );
    }

    const authRequired = isAuthRequired(this.validTokens);
    const tokens = this.validTokens;
    const corsOrigins = this.corsOrigins;

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const authFn = authRequired
        ? (authHeader: string | undefined) => validateAuth(authHeader, tokens)
        : undefined;

      handleRequest(req, res, authFn, corsOrigins).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message, statusCode: 500 }));
      });
    });

    return new Promise((resolve, reject) => {
      const server = this.server!;
      server.on('error', (err: Error) => {
        this.server = null;
        reject(err);
      });

      // Long-running RPCs (real-site replays) legitimately exceed Node's
      // default 300s requestTimeout — the socket was killed mid-replay
      // (real-world juejin replay died at exactly 5:01).
      server.headersTimeout = 20 * 60_000;
      server.requestTimeout = 20 * 60_000;
      server.keepAliveTimeout = 20 * 60_000;

      server.listen(this.port, this.host, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        console.log(`HTTP server listening on http://${this.host}:${this.port}`);
        resolve({ port: this.port, host: this.host });
      });
    });
  }

  /**
   * Stop the HTTP server gracefully.
   *
   * Closes all active connections and stops accepting new ones.
   */
  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve, reject) => {
      this.server!.close((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the address the server is bound to.
   *
   * @returns The port and host, or `null` if the server is not running.
   */
  getAddress(): { port: number; host: string } | null {
    if (!this.server) return null;
    return { port: this.port, host: this.host };
  }
}
