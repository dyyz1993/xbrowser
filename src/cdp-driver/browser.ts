/**
 * XBBrowser — Browser-level CDP connection management
 *
 * Manages a connection to the browser-level CDP endpoint and tracks
 * browser contexts (incognito-like isolation) and pages.
 *
 * CDP mapping:
 *   Target.createBrowserContext → newContext()
 *   Target.disposeBrowserContext → context.close()
 *   Target.getTargets           → contexts() / pages discovery
 *   Target.setAutoAttach        → auto-attach for new pages
 */

import { EventEmitter } from 'node:events';
import { CDPConnection } from './connection.js';
import { XBContextImpl } from './context.js';
import type { XBBrowser, XBContext, XBContextOptions } from './types.js';
import type { ChildProcess } from 'node:child_process';

interface BrowserContextInfo {
  contextId: string;
  context: XBContextImpl;
}

export class XBBrowserImpl implements XBBrowser {
  private conn: CDPConnection;
  private _emitter = new EventEmitter();
  private _contexts = new Map<string, BrowserContextInfo>();
  private _disconnected = false;
  private childProcess: ChildProcess | null = null;
  private tmpDir: string | undefined;
  private _exitHandler: (() => void) | null = null;

  constructor(conn: CDPConnection, childProcess?: ChildProcess, tmpDir?: string) {
    this.conn = conn;
    this.childProcess = childProcess ?? null;
    this.tmpDir = tmpDir;

    conn.on('disconnect', () => {
      this._disconnected = true;
      this._emitter.emit('disconnected');
    });

    // C1: Register exit handler to prevent orphaned Chrome processes
    if (this.childProcess) {
      this._exitHandler = () => {
        try {
          if (this.childProcess?.exitCode === null) {
            this.childProcess.kill('SIGKILL');
          }
        } catch { /* best-effort kill on exit */ }
        if (this.tmpDir) {
          try {
            const { rmSync } = require('node:fs');
            rmSync(this.tmpDir, { recursive: true, force: true });
          } catch { /* best-effort cleanup */ }
        }
      };
      process.on('exit', this._exitHandler);
    }
  }

  get disconnected(): boolean {
    return this._disconnected;
  }

  /** The underlying CDP connection (for advanced use) */
  get connection(): CDPConnection {
    return this.conn;
  }

  async close(): Promise<void> {
    if (this._disconnected) return;
    this._disconnected = true;

    // Close all contexts
    for (const [, info] of this._contexts) {
      await info.context.close().catch(() => {});
    }
    this._contexts.clear();

    // Remove exit handler before intentional kill
    if (this._exitHandler) {
      process.removeListener('exit', this._exitHandler);
      this._exitHandler = null;
    }

    // If we own the process, kill it and clean up temp dir
    if (this.childProcess) {
      const { killChrome } = await import('./launcher.js');
      await killChrome(this.childProcess, this.tmpDir);
    }

    // Close WebSocket
    await this.conn.close();

    this._emitter.emit('disconnected');
  }

  async newContext(opts: XBContextOptions = {}): Promise<XBContext> {
    if (this._disconnected) {
      throw new Error('Browser is disconnected');
    }

    // Create a browser context (incognito-like isolation)
    // Fall back to default context if not supported (e.g. CDP tunnels)
    let contextId = 'default';
    try {
      const result = await this.conn.send<{ browserContextId: string }>(
        'Target.createBrowserContext',
        { disposeOnDetach: true },
        undefined,
        10_000, // 10s timeout instead of default 30s
      );
      contextId = result.browserContextId;
    } catch {
      // Use default context (no isolation)
    }

    const context = new XBContextImpl(this.conn, contextId, this, opts);

    // Set up auto-attach for new targets in this context
    context.on('page', (page) => {
      this._emitter.emit('page', page);
    });

    this._contexts.set(contextId, {
      contextId,
      context,
    });

    return context;
  }

  contexts(): XBContext[] {
    return Array.from(this._contexts.values()).map((info) => info.context);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this._emitter.on(event, handler);
  }

  off(event: string, handler: Function): void {
    this._emitter.off(event, handler as (...args: unknown[]) => void);
  }

  /** Called by context.close() to remove from registry */
  _removeContext(contextId: string): void {
    this._contexts.delete(contextId);
  }

  // ── CDP helpers exposed for context/page ────────────────────

  /** Attach to a target and get a session ID for flat protocol */
  async _attachToTarget(targetId: string): Promise<string> {
    const result = await this.conn.send<{ sessionId: string }>(
      'Target.attachToTarget',
      { targetId, flatten: true },
    );
    return result.sessionId;
  }

  /** Detach from a target session */
  async _detachFromTarget(sessionId: string): Promise<void> {
    await this.conn.send('Target.detachFromTarget', { sessionId });
  }

  /** Create a new page target within a browser context */
  async _createTarget(contextId: string, url = 'about:blank'): Promise<{ targetId: string }> {
    const params: Record<string, unknown> = { url };
    if (contextId && contextId !== 'default') {
      params.browserContextId = contextId;
    }
    return this.conn.send<{ targetId: string }>('Target.createTarget', params);
  }

  /** Close a target */
  async _closeTarget(targetId: string): Promise<void> {
    await this.conn.send('Target.closeTarget', { targetId });
  }

  /** Enable auto-attach for new targets */
  async _enableAutoAttach(): Promise<void> {
    await this.conn.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  }
}
