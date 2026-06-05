/**
 * CDP WebSocket Connection — JSON-RPC 2.0 Client
 *
 * Low-level bidirectional communication channel to Chromium's CDP endpoint.
 * Handles message id correlation, event dispatch, and session multiplexing.
 */

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

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
  private pending = new Map<number, PendingRequest>();
  private closed = false;
  private closeReason: string | null = null;

  /** Default session ID for flat session protocol (Target.attachToTarget) */
  private defaultSessionId: string | undefined;

  constructor(wsOrUrl: WebSocket | string, sessionId?: string) {
    super();
    this.defaultSessionId = sessionId;

    if (typeof wsOrUrl === 'string') {
      this.ws = new WebSocket(wsOrUrl);
    } else {
      this.ws = wsOrUrl;
    }

    this.bindWebSocket();
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
   * @param timeoutMs — response timeout (default: 30s)
   * @returns the `result` field from the CDP response
   */
  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = 30_000,
  ): Promise<T> {
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
        reject(new Error(`CDP timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

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
