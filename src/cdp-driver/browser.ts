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
import { XBPageImpl } from './page.js';
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
  /**
   * Original CDP endpoint (HTTP or ws URL) used to construct this browser.
   * Used by discoverContexts() as a fallback to HTTP /json/list when
   * Target.getTargets doesn't return page-type targets (e.g. cdp-tunnel proxy).
   */
  private cdpEndpoint: string | undefined;

  constructor(
    conn: CDPConnection,
    childProcess?: ChildProcess,
    tmpDir?: string,
    cdpEndpoint?: string,
  ) {
    this.conn = conn;
    this.childProcess = childProcess ?? null;
    this.tmpDir = tmpDir;
    // 保留 cdpEndpoint 字段供未来 CDP 协议调用使用（HTTP /json/list 兜底已删除，见 §7.5）
    this.cdpEndpoint = cdpEndpoint;
    void this.cdpEndpoint;

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

  /**
   * 只断开 WebSocket 连接，不关闭任何 page/context（用于复用已有 tab 的场景）。
   * 与 close() 的区别：close() 会关掉所有 page 和 context（可能删用户 tab），
   * disconnect() 只是挂断电话。
   */
  async disconnect(): Promise<void> {
    if (this._disconnected) return;
    this._disconnected = true;

    if (this._exitHandler) {
      process.removeListener('exit', this._exitHandler);
      this._exitHandler = null;
    }

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

    // Enable auto-attach so new tabs (window.open, target="_blank") are detected
    // via Target.attachedToTarget events. Must be called AFTER context setup so
    // the event listener in XBContextImpl.setupAutoAttach() is ready.
    // Only for self-launched browsers (not CDP tunnels which may not support it).
    if (this.childProcess) {
      this._enableAutoAttach().catch(() => {});
    }

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

  /**
   * Create a new page target within a browser context */
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
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  }

  /**
   * Discover existing browser contexts and pages via Target.getTargets.
   *
   * For CDP tunnel connections (cdp-tunnel, attach scenarios), the
   * Target.attachedToTarget auto-attach flow is unreliable. Without this
   * call, `b.contexts()` would return [] and callers would fall back to
   * `b.newContext()` — which creates an isolated context with NO cookies
   * shared with the user's existing browser session (causing login failures).
   *
   * This method:
   *  1. Queries Target.getTargets to enumerate all page targets
   *  2. Groups them by browserContextId
   *  3. Attaches to each existing page via Target.attachToTarget
   *  4. Wraps the discovered pages in a XBContextImpl and registers it in
   *     this._contexts so `contexts()` returns the user's actual contexts
   *  5. Enables Target.setAutoAttach for future pages
   *
   * No-op for self-launched browsers (they already populated contexts via
   * newContext() + childProcess-gated auto-attach).
   */
  async discoverContexts(): Promise<void> {
    if (this._disconnected) return;

    // 1) Enumerate all targets via CDP Target.getTargets
    let targetInfos: Array<{
      targetId: string;
      type: string;
      browserContextId?: string;
      url: string;
      title?: string;
    }> = [];
    try {
      const result = await this.conn.send<{ targetInfos: typeof targetInfos }>(
        'Target.getTargets'
      );
      targetInfos = result.targetInfos ?? [];
    } catch {
      // Target.getTargets may not be supported (very old CDP). Bail.
      return;
    }

    // cdp-tunnel 隔离规范 §7.5：不再走 HTTP /json/list 兜底
    // - HTTP /json/list 已被 cdp-tunnel 隔离（create 模式返回空）
    // - 即使能拿到，也违反"xbrowser 只能看本 clientId tabs"的契约
    // - 改用纯 WS Target.getTargets（已按 clientId 过滤）

    // 2) Group page targets by browserContextId
    const pagesByContext = new Map<string, typeof targetInfos>();
    for (const t of targetInfos) {
      if (t.type !== 'page') continue;
      // Skip chrome:// and devtools:// — they're internal pages
      if (!t.url || t.url.startsWith('chrome://') || t.url.startsWith('devtools://')) {
        continue;
      }
      const ctxId = t.browserContextId || 'default';
      if (!pagesByContext.has(ctxId)) pagesByContext.set(ctxId, []);
      pagesByContext.get(ctxId)!.push(t);
    }

    // 3) For each context, create wrapper and attach to existing pages
    for (const [ctxId, pages] of pagesByContext) {
      if (this._contexts.has(ctxId)) continue;

      const context = new XBContextImpl(this.conn, ctxId, this, {});

      for (const p of pages) {
        try {
          const sessionId = await this._attachToTarget(p.targetId);
          const page = new XBPageImpl(this.conn, sessionId, p.targetId, context, this);
          await page._init();
          context._addDiscoveredPage(page);
        } catch {
          // Attach can fail (e.g. target already attached to another client).
          // Skip it; we still register the context for future newPage() calls.
        }
      }

      this._contexts.set(ctxId, { contextId: ctxId, context });
    }

    // 4) Enable auto-attach for any future pages (e.g. window.open, target=_blank)
    //    This is best-effort — CDP tunnels may reject it.
    try {
      await this.conn.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
    } catch {
      // Tunnel rejected auto-attach — that's OK, existing pages are already attached.
    }
  }
}
