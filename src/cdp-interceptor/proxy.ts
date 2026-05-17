/**
 * CDP Interceptor Proxy
 *
 * A thin WebSocket proxy that sits between any automation tool (Playwright,
 * Puppeteer, etc.) and Chromium's CDP endpoint. Every JSON-RPC message is
 * intercepted, analyzed against a rule engine, and either passed through,
 * blocked (with error response), or transformed before reaching the browser.
 *
 * Usage:
 * ```
 * const proxy = new CDPInterceptorProxy({ cdpEndpoint: 'ws://localhost:9222/...' });
 * await proxy.start(); // starts listening on a random port
 * // Now connect your automation tool to: ws://localhost:{proxy.port}
 * ```
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type {
  CDPMessage,
  CDPRequest,
  CDPError,
  CDPInterceptorConfig,
  CDPInterceptorStats,
  CDPLogEntry,
  DecisionAction,
} from './types.js';
import { createRuleEngine } from './rules-engine.js';
import type { RuleEngine } from './rules-engine.js';
import { createLogger } from './logger.js';
import type { CDPLogger } from './logger.js';
import { formatBlockMessage } from './advisor.js';

/** Generate a compound session id from CDP target id + message sessionId */
function makeCompoundId(cdpSessionId: string | undefined, rawSessionId: string | undefined): string {
  return `${cdpSessionId ?? 'nil'}::${rawSessionId ?? 'nil'}`;
}

export class CDPInterceptorProxy {
  private wss: WebSocketServer | null = null;
  private engine: RuleEngine;
  private config: CDPInterceptorConfig;
  private logger: CDPLogger;
  private started = false;

  stats: CDPInterceptorStats = {
    totalMessages: 0,
    blockedMessages: 0,
    transformedMessages: 0,
    passedMessages: 0,
    byRule: {},
  };

  constructor(config: CDPInterceptorConfig) {
    this.config = config;
    this.engine = createRuleEngine(config.rules);
    this.logger = createLogger({
      enableLogging: config.enableLogging ?? true,
      logDir: config.logDir,
    });
  }

  /** The port the proxy is listening on (only valid after start()) */
  get port(): number {
    const addr = this.wss?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return 0;
  }

  /** Start the proxy server */
  async start(): Promise<number> {
    if (this.started) return this.port;

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.config.listenPort ?? 0 }, () => {
        const port = this.port;
        this.engine.start(); // initialize per-session state tracking
        this.started = true;
        this.logger.info('CDP interceptor proxy started', { port, endpoint: this.config.cdpEndpoint });
        resolve(port);
      });

      this.wss.on('error', reject);

      this.wss.on('connection', (clientWs: WebSocket, _req: IncomingMessage) => {
        this.handleConnection(clientWs);
      });
    });
  }

  /** Stop the proxy server */
  async stop(): Promise<void> {
    this.engine.stop();
    this.logger.flush();
    this.started = false;

    return new Promise((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
      this.wss = null;
    });
  }

  /** Get accumulated statistics */
  getStats(): CDPInterceptorStats {
    return { ...this.stats };
  }

  /** Get recent log entries (for inspection) */
  getRecentLogs(count = 50): CDPLogEntry[] {
    return this.logger.getRecent(count);
  }

  // ── Connection handling ──────────────────────────────────────

  private handleConnection(clientWs: WebSocket): void {
    let browserWs: WebSocket | null = null;
    let isAlive = true;
    // Buffer client messages sent before browser-side connection opens
    const pendingMessages: Buffer[] = [];

    // Connect to the real Chromium CDP endpoint
    browserWs = new WebSocket(this.config.cdpEndpoint);

    // Single client message handler: buffers until browser WS is open, then forwards
    clientWs.on('message', (raw: Buffer) => {
      if (browserWs && browserWs.readyState === WebSocket.OPEN) {
        this.handleClientMessage(clientWs, browserWs, raw);
      } else {
        pendingMessages.push(raw);
      }
    });

    browserWs.on('open', () => {
      // Forward buffered messages
      for (const buf of pendingMessages) {
        this.handleClientMessage(clientWs, browserWs!, buf);
      }
      pendingMessages.length = 0;
    });

    browserWs.on('error', (err) => {
      this.logger.info('Browser WebSocket error', { error: String(err) });
    });

    browserWs.on('close', (code, reason) => {
      if (isAlive && clientWs.readyState === WebSocket.OPEN) {
        this.logger.info('Browser WS closed, closing client', { code, reason: String(reason) });
        clientWs.close();
      }
    });

    browserWs.on('message', (raw: Buffer) => {
      // Relay from browser → client, also apply rules on responses
      this.handleBrowserMessage(clientWs, browserWs!, raw);
    });

    // Cleanup when either side closes
    const cleanup = () => {
      isAlive = false;
      if (browserWs && browserWs.readyState === WebSocket.OPEN) {
        browserWs.close();
      }
    };

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);
    browserWs.on('close', () => {
      if (isAlive && clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    });
    browserWs.on('error', cleanup);
  }

  // ── Message processing ───────────────────────────────────────

  private handleClientMessage(clientWs: WebSocket, browserWs: WebSocket, raw: Buffer): void {
    const msg = this.parseMessage(raw);
    if (!msg) return;

    this.stats.totalMessages++;

    // Only intercept requests (not responses from client-side)
    if (!('method' in msg)) {
      // It's a response/error from client — forward to browser
      browserWs.send(raw.toString());
      return;
    }

    const request = msg as CDPRequest;

    // Build rule context
    const ctx = {
      method: request.method,
      params: request.params ?? {},
      sessionId: makeCompoundId((browserWs as unknown as { _cdpSession?: string })._cdpSession, request.sessionId),
      direction: 'client→browser' as const,
    };

    // Evaluate rules
    const decision = this.engine.evaluate(ctx);

    // Log
    this.logger.log(ctx.method, 'client→browser', ctx.sessionId, { method: ctx.method, params: ctx.params }, decision);

    if (decision) {
      this.recordDecision(decision);
    }

    if (decision?.action === 'block') {
      // Generate LLM-readable error with reason + suggestion + code example
      const blockMsg = formatBlockMessage(decision, ctx.method);

      // Send CDP error back to client, don't forward to browser
      const errorResponse: CDPError = {
        id: request.id,
        error: {
          code: decision.errorCode ?? -32000,
          message: blockMsg,
        },
        sessionId: request.sessionId,
      };
      this.stats.blockedMessages++;
      console.error(`\n${blockMsg}\n`);
      clientWs.send(JSON.stringify(errorResponse));
      return;
    }

    if (decision?.action === 'transform' && decision.transformedParams) {
      const transformed: CDPRequest = { ...request, params: decision.transformedParams };
      this.stats.transformedMessages++;
      browserWs.send(JSON.stringify(transformed));
      return;
    }

    // Pass through
    this.stats.passedMessages++;
    browserWs.send(raw.toString());
  }

  private handleBrowserMessage(clientWs: WebSocket, _browserWs: WebSocket, raw: Buffer): void {
    const msg = this.parseMessage(raw);
    if (!msg) {
      clientWs.send(raw.toString());
      return;
    }

    // Check for browser→client events that may expose automation
    if ('method' in msg) {
      const event = msg as CDPRequest;
      const ctx = {
        method: event.method,
        params: event.params ?? {},
        sessionId: event.sessionId ?? 'browser',
        direction: 'browser→client' as const,
      };
      const decision = this.engine.evaluate(ctx);
      if (decision?.action === 'block') {
        // Drop browser event — never reach client
        return;
      }
    }

    clientWs.send(raw.toString());
  }

  // ── Utilities ────────────────────────────────────────────────

  private parseMessage(raw: Buffer): CDPMessage | null {
    try {
      return JSON.parse(raw.toString()) as CDPMessage;
    } catch {
      return null; // non-JSON message, pass through as-is in the caller
    }
  }

  private recordDecision(decision: { ruleId: string; action: DecisionAction }): void {
    if (!this.stats.byRule[decision.ruleId]) {
      this.stats.byRule[decision.ruleId] = { matched: 0, blocked: 0, transformed: 0 };
    }
    this.stats.byRule[decision.ruleId].matched++;
    if (decision.action === 'block') {
      this.stats.byRule[decision.ruleId].blocked++;
    } else if (decision.action === 'transform') {
      this.stats.byRule[decision.ruleId].transformed++;
    }
  }
}
