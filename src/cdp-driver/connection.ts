/**
 * CDP WebSocket Connection — JSON-RPC 2.0 Client
 *
 * Low-level bidirectional communication channel to Chromium's CDP endpoint.
 * Handles message id correlation, event dispatch, and session multiplexing.
 */

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { createRuleEngine, type RuleEngine } from '../cdp-interceptor/rules-engine.js';

// ── Types ──────────────────────────────────────────────────────

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  method: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface CDPRawMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  sessionId?: string;
}

// ── Connection Events ──────────────────────────────────────────

export interface CDPConnectionEvents {
  disconnect: void;
  message: { method: string; params: Record<string, unknown>; sessionId?: string };
}

/**
 * CDPConnection manages a single WebSocket to a Chromium CDP target.
 *
 * Each target (browser-level, page-level, or attached sub-session) gets
 * its own CDPConnection. For sub-sessions created via Target.attachToTarget,
 * the connection reuses the parent WebSocket but tags messages with sessionId.
 */
export class CDPConnection extends EventEmitter {
  private ws: WebSocket;
  private nextId = 1;

  /** CDP Guard：全部出站命令过规则引擎（env XBROWSER_CDP_GUARD=off 关闭）。
   *  173 条规则 / 9 模块：合成事件 block、指纹暴露警告、自动化信号拦截。 */
  private static __guard: RuleEngine | null | undefined;
  private get guard(): RuleEngine | null {
    if (CDPConnection.__guard === undefined) {
      if (process.env.XBROWSER_CDP_GUARD === 'off') {
        CDPConnection.__guard = null;
      } else {
        try {
          const g = createRuleEngine();
          g.start();
          CDPConnection.__guard = g;
        } catch { CDPConnection.__guard = null; }
      }
    }
    return CDPConnection.__guard;
  }
  private pending = new Map<number, PendingRequest>();
  private closed = false;
  private closeReason: string | null = null;

  /** Default session ID for flat session protocol (Target.attachToTarget) */
  private defaultSessionId: string | undefined;

  constructor(wsOrUrl: WebSocket | string, sessionId?: string) {
    super();
    // CDP connections legitimately need many event listeners (one per page/session
    // subscription). Remove the default 10-listener limit to prevent false warnings.
    this.setMaxListeners(0);
    this.defaultSessionId = sessionId;

    if (typeof wsOrUrl === 'string') {
      // For wss:// connections to raw IPs (e.g. self-signed certs), skip TLS
      // certificate verification so direct-IP connections work without DNS.
      const wsOptions = /^wss:\/\/\d+\.\d+\.\d+\.\d+/.test(wsOrUrl)
        ? { rejectUnauthorized: false }
        : undefined;
      this.ws = new WebSocket(wsOrUrl, wsOptions);
    } else {
      this.ws = wsOrUrl;
    }

    this.bindWebSocket();
    this.startKeepalive();
  }

  /** Send periodic WS pings to prevent idle-timeout disconnects (e.g. CF's 100s).
   *  Also detects dead connections: if a pong isn't received within 10s of a
   *  ping, the connection is considered dead and forcibly closed. */
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最近一次收到任何 WS 消息的时间——有数据流动即证明连接存活 */
  private lastIncomingAt = Date.now();
  private startKeepalive(): void {
    // Listen for pong to confirm the connection is alive
    this.ws.on('pong', () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
    });

    this.keepaliveTimer = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        // Set a pong timeout: if no pong the connection is considered dead.
        // 自适应判死（2026-08-29）：重页面（豆包 SPA）加载会触发事件洪流，
        // daemon 忙于处理消息时 pong 处理被推迟——但**洪流本身就证明连接活着**。
        // 只有「无 pong 且最近 30s 无任何入站数据」才判死（真半开 TCP）；
        // 死连接的命令由各自的命令超时兜底，keepalive 只负责回收半开连接。
        if (!this.pongTimer) {
          this.pongTimer = setTimeout(() => {
            const recentlyActive = Date.now() - this.lastIncomingAt < 30_000;
            if (recentlyActive) {
              // 连接明显活跃：清掉 pong 等待，下个 ping 周期再验
              this.pongTimer = null;
              return;
            }
            // No pong + idle — connection is dead (half-open TCP)
            if (!this.closed) {
              this.closed = true;
              this.closeReason = 'keepalive timeout (no pong and idle >30s)';
              try { this.ws.terminate(); } catch { /* ignore */ }
              for (const [, pending] of this.pending) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Connection dead: keepalive timeout'));
              }
              this.pending.clear();
              this.emit('disconnect');
            }
          }, 60000);
        }
        (this.ws as unknown as { ping?: () => void }).ping?.();
      } else if (this.closed) {
        if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = null;
      }
    }, 30000);
  }

  /** Wait for the connection to be fully open */
  async ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      throw new Error(`WebSocket already closed: ${this.closeReason ?? 'unknown'}`);
    }

    return new Promise((resolve, reject) => {
      const onOpen = (): void => {
        this.ws.off('error', onError);
        resolve();
      };
      const onError = (err: Error): void => {
        this.ws.off('open', onOpen);
        reject(err);
      };
      this.ws.once('open', onOpen);
      this.ws.once('error', onError);
    });
  }

  /** Is the underlying WebSocket alive? */
  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send a CDP command and await its response.
   *
   * @param method — CDP domain.method (e.g. "Page.navigate")
   * @param params — method parameters
   * @param sessionId — optional flat session ID for sub-targets
   * @param timeoutMs — response timeout (default: 30s；重 SPA 加载期间主线程忙，
   *   evaluate 可排队 >30s——Runtime.evaluate 单独放宽到 90s)
   * @returns the `result` field from the CDP response
   */
  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<T> {
    // Runtime.evaluate 在重页面（如豆包 SPA）加载期间会因主线程繁忙排队很久，
    // 30s 会在页面「实际能加载成功」的场景下误报超时
    const effectiveTimeout = timeoutMs ?? (method === 'Runtime.evaluate' ? 90_000 : 30_000);

    // CDP Guard：全命令面过滤（第二十五季）。危险指令在发往浏览器前被
    // block（含 errorCode + 替代方案提示）；XBROWSER_CDP_GUARD=off 跳过。
    if (this.guard) {
      const decision = this.guard.evaluate({
        method,
        params: params ?? {},
        sessionId: sessionId ?? this.defaultSessionId ?? '',
        direction: 'client→browser',
      });
      if (decision && decision.action === 'block') {
        throw new Error(`[CDP-Guard] ${decision.reason}${decision.suggestion ? ' | 替代: ' + decision.suggestion : ''} [${decision.ruleId}]`);
      }
    }

    if (this.closed) {
      throw new Error(`CDP connection closed: ${this.closeReason ?? 'unknown'}`);
    }
    if (!this.isOpen) {
      throw new Error(`CDP connection not open (state: ${this.ws.readyState})`);
    }

    const id = this.nextId++;
    const sid = sessionId ?? this.defaultSessionId;

    const message: CDPRawMessage = { id, method };
    if (params !== undefined) message.params = params;
    if (sid !== undefined) message.sessionId = sid;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method} (${effectiveTimeout}ms)`));
      }, effectiveTimeout);

      this.pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timeout);
          this.pending.delete(id);
          resolve(v as T);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(err);
        },
        method,
        timeout,
      });

      const data = JSON.stringify(message);
      try {
        this.ws.send(data);
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error(`CDP send failed: ${method} — ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  /**
   * Subscribe to a CDP event.
   *
   * @param event — full event name (e.g. "Page.frameNavigated")
   * @param handler — called with the event params
   * @param sessionId — optional session filter
   */
  on(event: string, handler: (params: unknown, sessionId?: string) => void): this {
    return super.on(event, handler) as this;
  }

  once(event: string, handler: (params: unknown, sessionId?: string) => void): this {
    return super.once(event, handler) as this;
  }

  /** Remove an event listener */
  off(event: string, handler: Function): this {
    super.off(event, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Subscribe to a CDP event for a specific session.
   * Returns an unsubscribe function.
   */
  subscribe(event: string, sessionId: string | undefined, handler: (params: unknown) => void): () => void {
    const wrapper = (params: unknown, sid?: string): void => {
      if (sid === sessionId || (!sessionId && !sid)) handler(params);
    };
    this.on(event, wrapper);
    return () => this.off(event, wrapper);
  }

  /** Close the WebSocket */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = 'closed by caller';

    // Stop keepalive timer
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }

    // Reject all pending
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Connection closed: ${pending.method}`));
      this.pending.delete(id);
    }

    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, 'normal closure');
    }
  }

  /** Set the default session ID for flat protocol */
  setDefaultSessionId(sid: string | undefined): void {
    this.defaultSessionId = sid;
  }

  // ── Private ─────────────────────────────────────────────────

  private bindWebSocket(): void {
    this.ws.on('message', (raw: Buffer) => {
      this.lastIncomingAt = Date.now();
      let msg: CDPRawMessage;
      try {
        msg = JSON.parse(raw.toString()) as CDPRawMessage;
      } catch {
        return;
      }

      // Response to a request
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;

        if (msg.error) {
          pending.reject(new CDPProtocolError(msg.error.code, msg.error.message, pending.method));
        } else {
          pending.resolve(msg.result ?? {});
        }
        return;
      }

      // CDP event
      if (msg.method) {
        this.emit(msg.method, msg.params ?? {}, msg.sessionId);
        this.emit('*', msg.method, msg.params ?? {}, msg.sessionId);
      }
    });

    this.ws.on('close', (code, reason) => {
      if (this.closed) return;
      this.closed = true;
      this.closeReason = `WebSocket closed: ${code} ${reason?.toString() ?? ''}`.trim();

      // Stop keepalive timer on close
      if (this.keepaliveTimer) {
        clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = null;
      }

      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Connection closed: ${pending.method}`));
        this.pending.delete(id);
      }

      this.emit('disconnect');
    });

    this.ws.on('error', (err: Error) => {
      if (this.closed) return;
      // Don't close on every error — let close event handle lifecycle
      // But emit for monitoring
      this.emit('ws-error', err);
    });
  }
}

/**
 * CDP Protocol Error — thrown when the browser returns a JSON-RPC error response.
 */
export class CDPProtocolError extends Error {
  code: number;
  method: string;
  data?: unknown;

  constructor(code: number, message: string, method: string, data?: unknown) {
    super(`CDP error [${code}] in ${method}: ${message}`);
    this.name = 'CDPProtocolError';
    this.code = code;
    this.method = method;
    this.data = data;
  }
}
