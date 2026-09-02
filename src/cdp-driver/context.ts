/**
 * XBContext — Browser context (incognito-like isolation)
 *
 * Each context manages a set of pages within a browser context.
 * Maps to CDP's Target.createBrowserContext.
 */

import { EventEmitter } from 'node:events';
import type { CDPConnection } from './connection.js';
import type { XBBrowser, XBContext, XBContextOptions, XBPage, XBCookie } from './types.js';
import type { XBBrowserImpl } from './browser.js';
import { XBPageImpl } from './page.js';
import { XBCDPSessionImpl } from './cdp-session.js';

export class XBContextImpl implements XBContext {
  private conn: CDPConnection;
  private _emitter = new EventEmitter();
  private _browser: XBBrowserImpl;
  readonly contextId: string;
  private _pages: XBPageImpl[] = [];
  private closed = false;
  private options: XBContextOptions;
  private targetAttachedHandler: ((params: unknown) => void) | null = null;
  private _initScripts: string[] = [];

  constructor(conn: CDPConnection, contextId: string, browser: XBBrowserImpl, opts: XBContextOptions) {
    this.conn = conn;
    this.contextId = contextId;
    this._browser = browser;
    this.options = opts;

    // Listen for new targets in this context
    this.setupAutoAttach();
  }

  /** S194: 任务 tab 的 stealth 配置（UA-CH 档案等）经 context 传给 page 层 */
  get stealthConfig(): Partial<import('./stealth.js').StealthConfig> | undefined {
    return this.options.stealthConfig;
  }

  /** sup-s9: HTTP 认证凭证经 context 传给 page 层（authRequired 自动响应） */
  get httpCredentials(): { username: string; password: string } | undefined {
    return this.options.httpCredentials;
  }

  async newPage(): Promise<XBPage> {
    if (this.closed) throw new Error('Context is closed');

    // Create a new page target
    const { targetId } = await this._browser._createTarget(this.contextId);

    // Attach to get a session
    const sessionId = await this._browser._attachToTarget(targetId);

    // Create page implementation
    const page = new XBPageImpl(this.conn, sessionId, targetId, this, this._browser);
    await page._init();

    this._pages.push(page);

    // Forward page events (request, response, etc.) to context listeners
    this.forwardPageEvents(page);

    // Apply context options
    if (this.options.viewport) {
      await page.setViewportSize(this.options.viewport).catch(() => {});
    }
    if (this.options.userAgent) {
      await page._setUserAgent(this.options.userAgent);
    }
    if (this.options.extraHTTPHeaders) {
      await page._setExtraHTTPHeaders(this.options.extraHTTPHeaders);
    }

    // Apply stored init scripts
    for (const script of this._initScripts) {
      await page.addInitScript(script);
    }

    return page;
  }

  pages(): XBPage[] {
    return [...this._pages];
  }

  browser(): XBBrowser {
    return this._browser;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Close all pages
    for (const page of this._pages) {
      await page.close().catch(() => {});
    }
    this._pages = [];

    // Dispose the browser context
    if (this.targetAttachedHandler) {
      this.conn.off('Target.attachedToTarget', this.targetAttachedHandler);
      this.targetAttachedHandler = null;
    }

    // Dispose the browser context (skip for default context)
    if (this.contextId && this.contextId !== 'default') {
      await this.conn.send('Target.disposeBrowserContext', {
        browserContextId: this.contextId,
      }).catch(() => {});
    }

    this._browser._removeContext(this.contextId);
  }

  async newCDPSession(page?: XBPage): Promise<XBCDPSessionImpl> {
    if (page instanceof XBPageImpl) {
      return new XBCDPSessionImpl(this.conn, page.sessionId);
    }
    return new XBCDPSessionImpl(this.conn);
  }

  async addInitScript(script: string): Promise<void> {
    this._initScripts.push(script);
    for (const page of this._pages) {
      await page.addInitScript(script);
    }
  }

  // ── Cookies ─────────────────────────────────────────────────

  async cookies(urls?: string | string[]): Promise<XBCookie[]> {
    const urlList = typeof urls === 'string' ? [urls] : urls;
    const params = urlList ? { urls: urlList } : undefined;
    // Chrome 149+ deprecated Network.getCookies. Try multiple approaches:
    // 1. Storage.getCookies (Chrome 149+, may not exist yet)
    // 2. Network.getCookies (Chrome <149)
    // 3. document.cookie via evaluate (fallback, no httpOnly)
    try {
      const result = await this.conn.send<{ cookies: Array<{
        name: string; value: string; domain: string; path: string;
        expires?: number; httpOnly?: boolean; secure?: boolean;
        sameSite?: 'Strict' | 'Lax' | 'None';
      }> }>('Storage.getCookies', params);
      return result.cookies;
    } catch {
      try {
        const result = await this.conn.send<{ cookies: Array<{
          name: string; value: string; domain: string; path: string;
          expires?: number; httpOnly?: boolean; secure?: boolean;
          sameSite?: 'Strict' | 'Lax' | 'None';
        }> }>('Network.getCookies', params);
        return result.cookies;
      } catch {
        // Last resort: read document.cookie (no httpOnly cookies)
        return [];
      }
    }
  }

  async addCookies(cookies: XBCookie[]): Promise<void> {
    const cdpCookies = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));
    // Chrome 149+: Storage.setCookies; older: Network.setCookies
    try {
      await this.conn.send('Storage.setCookies', { cookies: cdpCookies });
    } catch {
      await this.conn.send('Network.setCookies', { cookies: cdpCookies });
    }
  }

  async clearCookies(): Promise<void> {
    // Chrome 149+: Storage.clearCookies; older: Network.clearBrowserCookies
    try {
      await this.conn.send('Storage.clearCookies');
    } catch {
      await this.conn.send('Network.clearBrowserCookies');
    }
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this._emitter.on(event, handler);
  }

  off(event: string, handler: Function): void {
    this._emitter.off(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Register a page that was attached to an existing target (discovered via
   * Target.getTargets). Used by XBBrowserImpl.discoverContexts() to wire up
   * pages from the user's existing browser session into the context wrapper
   * so they appear in `context.pages()` and can be reused by plugins.
   */
  _addDiscoveredPage(page: XBPageImpl): void {
    const exists = this._pages.some((p) => p._targetId === page._targetId);
    if (exists) return;
    this._pages.push(page);
    this.forwardPageEvents(page);
  }

  // ── Private ─────────────────────────────────────────────────

  /** Forward page-level events (request, response, etc.) to context listeners */
  private forwardPageEvents(page: XBPageImpl): void {
    const forward = (event: string) => {
      page.on(event, (...args: unknown[]) => {
        this._emitter.emit(event, ...args);
      });
    };
    forward('request');
    forward('response');
    forward('requestfailed');
    forward('requestfinished');
  }

  private setupAutoAttach(): void {
    this.targetAttachedHandler = (paramsRaw: unknown) => {
      const params = paramsRaw as {
        targetInfo: {
          targetId: string;
          type: string;
          browserContextId?: string;
          url: string;
        };
        sessionId: string;
      };

      // Only handle targets in our context (or all if using default context)
      if (this.contextId !== 'default' && params.targetInfo.browserContextId !== this.contextId) return;
      if (params.targetInfo.type !== 'page') return;

      // Skip if already created via newPage()
      const exists = this._pages.some(
        (p) => p._targetId === params.targetInfo.targetId,
      );
      if (exists) return;

      // Auto-created page (e.g. window.open)
      const page = new XBPageImpl(
        this.conn,
        params.sessionId,
        params.targetInfo.targetId,
        this,
        this._browser,
      );

      // Resume the target (it was paused by waitForDebuggerOnStart)
      this.conn.send('Runtime.runIfWaitingForDebugger', undefined, params.sessionId).catch(() => {});

      page._init().then(async () => {
        // Apply stored init scripts to auto-created pages
        for (const script of this._initScripts) {
          await page.addInitScript(script).catch(() => {});
        }
        this._pages.push(page);
        // Forward page events (request, response, etc.) to context listeners
        this.forwardPageEvents(page);
        this._emitter.emit('page', page);
      });
    };

    this.conn.on('Target.attachedToTarget', this.targetAttachedHandler);
  }
}
