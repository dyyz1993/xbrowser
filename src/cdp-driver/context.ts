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
  /**
   * 单一规范注册表（dup 回归修复）：targetId → wrapper。
   *
   * 同一 target 的 wrapper 有三条并发创建路径——newPage() 显式创建、
   * setAutoAttach 对新建 target 的自动附着事件、Target.attachToTarget 的
   * attachedToTarget 回显事件（CDP 规范：显式 attach 也会发该事件）。旧实现
   * 用数组在 `await page._init()` 之后去重，事件在 _init 期间到达时全部穿透
   * ——headless E2E 实测同一 target 出 3 个 wrapper，且随事件顺序抖动。
   *
   * 现在所有路径先**同步预约**（`_reserveTarget` + 同步 set 进
   * `_pendingRegistrations`），再异步初始化；后到者直接 join 同一个注册
   * Promise 拿同一个 wrapper，事件顺序无关。注册 Promise 覆盖到 init
   * scripts 应用完成——join 者拿到的必然是完整初始化的 wrapper。
   */
  private _pages = new Map<string, XBPageImpl>();
  /** in-flight 注册（targetId → 注册 Promise），完成后移除并落入 _pages */
  private _pendingRegistrations = new Map<string, Promise<XBPageImpl>>();
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

  /** sup-s12: 自签/无效证书放行——经 context 传给 page 层（原为死字段） */
  get ignoreHTTPSErrors(): boolean | undefined {
    return this.options.ignoreHTTPSErrors;
  }

  async newPage(): Promise<XBPage> {
    if (this.closed) throw new Error('Context is closed');

    // Create a new page target
    const { targetId } = await this._browser._createTarget(this.contextId);

    // auto-attach 可能在 _createTarget 往返期间已预约注册（事件先于响应到达
    // 是合法顺序）；显式 attach 的回显事件也可能先于其响应到达。两处 await
    // 后都重新查预约。
    let pending = this._reserveTarget(targetId);
    let explicitSessionId: string | undefined;

    if (!pending) {
      // Attach to get a session
      const sessionId = await this._browser._attachToTarget(targetId);
      pending = this._reserveTarget(targetId);
      if (!pending) {
        const registration = this._registerTarget(targetId, sessionId);
        this._pendingRegistrations.set(targetId, registration);
        pending = registration;
        explicitSessionId = undefined; // session 由我们自己的注册持有
      } else {
        explicitSessionId = sessionId;
      }
    }

    const page = await pending;
    // 抢先注册若用的正是我们显式 attach 的 session（回显事件先于响应到达时
    // handler 会拿它注册），session 仍在用——只有确认不用时才回收，否则会把
    // 活页面的 session 杀掉（goto 全线挂起）。
    if (explicitSessionId && page.sessionId !== explicitSessionId) {
      this._browser._detachFromTarget(explicitSessionId).catch(() => {});
    }
    // context options 属 newPage 语义（viewport/UA/headers），无论 wrapper 由
    // 哪条路径创建都不能漏——join 路径也照常应用（幂等）。
    await this._applyNewPageOptions(page);
    return page;
  }

  pages(): XBPage[] {
    return [...this._pages.values()];
  }

  browser(): XBBrowser {
    return this._browser;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Close all pages
    for (const page of this._pages.values()) {
      await page.close().catch(() => {});
    }
    this._pages.clear();
    this._pendingRegistrations.clear();

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
    for (const page of this._pages.values()) {
      await page.addInitScript(script);
    }
  }

  // ── Cookies ─────────────────────────────────────────────────

  /**
   * Real CDP browserContextId (from Target.createBrowserContext), or undefined
   * for the default context (contextId 'default' / '' is not a CDP id — passing
   * it to Storage.* makes CDP reject the whole call).
   */
  private get storageContextId(): string | undefined {
    return this.contextId && this.contextId !== 'default' ? this.contextId : undefined;
  }

  async cookies(urls?: string | string[]): Promise<XBCookie[]> {
    const urlList = typeof urls === 'string' ? [urls] : urls;
    const bcId = this.storageContextId;
    const params = bcId
      ? { ...(urlList ? { urls: urlList } : {}), browserContextId: bcId }
      : urlList ? { urls: urlList } : undefined;
    // Chrome 149+ deprecated Network.getCookies. Try multiple approaches:
    // 1) Storage.getCookies (Chrome 149+, may not exist yet)
    // 2) Network.getCookies (Chrome <149)
    // 3) document.cookie via evaluate (fallback, no httpOnly)
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
    // 必须 带 browserContextId：XBContext 是 Target.createBrowserContext 的隔离
    // context，缺省时 CDP 静默写进 default context——页面永远看不到（不报错）。
    const bcId = this.storageContextId;
    const params = bcId ? { cookies: cdpCookies, browserContextId: bcId } : { cookies: cdpCookies };
    try {
      await this.conn.send('Storage.setCookies', params);
    } catch {
      await this.conn.send('Network.setCookies', { cookies: cdpCookies });
    }
  }

  async clearCookies(): Promise<void> {
    // Chrome 149+: Storage.clearCookies; older: Network.clearBrowserCookies
    const bcId = this.storageContextId;
    try {
      await this.conn.send('Storage.clearCookies', bcId ? { browserContextId: bcId } : undefined);
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
   * Attach an existing target (discovered via Target.getTargets / HTTP
   * /json/list) and register exactly one wrapper for it. Used by
   * XBBrowserImpl.discoverContexts() to wire up pages from the user's
   * existing browser session so they appear in `context.pages()`.
   *
   * 显式 attach 同样会触发 attachedToTarget 回显事件（auto-attach 也会对
   * 既有 target 补附着）——全部经注册表预约去重。attach 失败（如 target
   * 已被其他客户端占用）返回 null：context 仍注册，后续 newPage() 可用。
   */
  async _attachExistingPage(targetId: string): Promise<XBPageImpl | null> {
    let pending = this._reserveTarget(targetId);
    let explicitSessionId: string | undefined;

    if (!pending) {
      let sessionId: string;
      try {
        sessionId = await this._browser._attachToTarget(targetId);
      } catch {
        return null;
      }
      pending = this._reserveTarget(targetId);
      if (!pending) {
        const registration = this._registerTarget(targetId, sessionId);
        this._pendingRegistrations.set(targetId, registration);
        pending = registration;
      } else {
        // 回显事件先于响应到达时，抢注用的正是我们的 session——不能盲目回收
        explicitSessionId = sessionId;
      }
    }

    try {
      const page = await pending;
      if (explicitSessionId && page.sessionId !== explicitSessionId) {
        this._browser._detachFromTarget(explicitSessionId).catch(() => {});
      }
      return page;
    } catch {
      return null;
    }
  }

  // ── Private ─────────────────────────────────────────────────

  /**
   * 同步查询/预约 target：已注册返回其 resolved Promise；in-flight 返回
   * 注册 Promise（join 同一 wrapper）；否则返回 null，调用方须同步发起
   * 注册并 set 进 `_pendingRegistrations`（在任意 await 之前）。
   */
  private _reserveTarget(targetId: string): Promise<XBPageImpl> | null {
    const registered = this._pages.get(targetId);
    if (registered) return Promise.resolve(registered);
    return this._pendingRegistrations.get(targetId) ?? null;
  }

  /**
   * 执行注册：创建 wrapper → _init → 应用 init scripts → 入注册表。
   * Promise 覆盖到 init scripts 应用完成；成功/失败都从 in-flight 表移除
   * （失败向上抛给所有 join 者，后续可重新预约重试）。
   */
  private async _registerTarget(targetId: string, sessionId: string): Promise<XBPageImpl> {
    try {
      const page = new XBPageImpl(this.conn, sessionId, targetId, this, this._browser);
      await page._init();
      for (const script of this._initScripts) {
        await page.addInitScript(script).catch(() => {});
      }
      this._pages.set(targetId, page);
      page.on('close', () => {
        if (this._pages.get(targetId) === page) this._pages.delete(targetId);
      });
      this.forwardPageEvents(page);
      return page;
    } finally {
      this._pendingRegistrations.delete(targetId);
    }
  }

  /** newPage 的上下文选项（viewport/UA/headers）——自建与 join 路径共用 */
  private async _applyNewPageOptions(page: XBPageImpl): Promise<void> {
    if (this.options.viewport) {
      await page.setViewportSize(this.options.viewport).catch(() => {});
    }
    if (this.options.userAgent) {
      await page._setUserAgent(this.options.userAgent);
    }
    if (this.options.extraHTTPHeaders) {
      await page._setExtraHTTPHeaders(this.options.extraHTTPHeaders);
    }
  }

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

      if (params.targetInfo.type !== 'page') return;

      // Context 归属过滤：具名 context 精确匹配 browserContextId；default
      // context 只收无 browserContextId 的 target（default 浏览器上下文的
      // tab 不带该字段）。旧实现对 default 放行一切——attach 流程里
      // default wrapper 会把具名 context 的 target 也抢建一份。
      const bcId = params.targetInfo.browserContextId;
      if (this.contextId === 'default') {
        if (bcId) return;
      } else if (bcId !== this.contextId) {
        return;
      }

      // Resume the target if paused by waitForDebuggerOnStart——无论本
      // context 是否建 wrapper，这个 session 都必须放行
      this.conn.send('Runtime.runIfWaitingForDebugger', undefined, params.sessionId).catch(() => {});

      // 注册表已（或正在）注册该 target：无需再造 wrapper
      if (this._reserveTarget(params.targetInfo.targetId)) return;

      // Auto-created page (e.g. window.open)
      const registration = this._registerTarget(params.targetInfo.targetId, params.sessionId);
      this._pendingRegistrations.set(params.targetInfo.targetId, registration);
      registration.then(
        (page) => { this._emitter.emit('page', page); },
        () => { /* 注册失败已从 in-flight 表移除，可重试 */ },
      );
    };

    this.conn.on('Target.attachedToTarget', this.targetAttachedHandler);
  }
}
