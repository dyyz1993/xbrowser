/**
 * XBCDPSession — Raw CDP session wrapper
 *
 * Provides direct access to CDP commands for advanced use cases
 * (screencast, network debugging, etc.).
 */

import type { XBCDPSession } from './types.js';
import type { CDPConnection } from './connection.js';

export class XBCDPSessionImpl implements XBCDPSession {
  private conn: CDPConnection;
  private sessionId: string | undefined;

  constructor(conn: CDPConnection, sessionId?: string) {
    this.conn = conn;
    this.sessionId = sessionId;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.conn.send<T>(method, params, this.sessionId);
  }

  on(event: string, handler: (params: unknown) => void): void {
    // CDP events are emitted on the connection with sessionId filter
    this.conn.on(event, (params: unknown, sid?: string) => {
      if (sid === this.sessionId || (!this.sessionId && !sid)) {
        handler(params);
      }
    });
  }

  off(event: string, handler: (params: unknown) => void): void {
    this.conn.off(event, handler);
  }

  async detach(): Promise<void> {
    if (!this.sessionId) return;
    // Detach is handled at the browser level
    // The browser impl handles this via _detachFromTarget
  }
}
