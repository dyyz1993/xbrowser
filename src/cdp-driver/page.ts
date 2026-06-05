/**
 * XBPage — Page-level CDP operations
 *
 * The main interface for page automation. Each XBPage manages a CDP session
 * attached to a specific browser target (tab).
 *
 * CDP domains used:
 *   Page.*      — navigation, lifecycle, scripts, screenshot, dialog
 *   Runtime.*   — JavaScript evaluation
 *   DOM.*       — element querying (querySelector, performSearch)
 *   Network.*   — request/response tracking
 *   Emulation.* — viewport, user-agent
 */

import { EventEmitter } from 'node:events';
import type { CDPConnection } from './connection.js';
import type {
  XBPage, XBContext, XBBrowser, XBLocator, XBMouse, XBKeyboard,
  XBElementHandle, XBFrame, WaitUntilState,
  XBClickOptions, XBFillOptions, XBScreenshotOptions, XBPdfOptions,
  XBNavigationResponse,
  XBConsoleMessage, XBDIALOG,
  XBResponse, XBRequest, XBRoute, XBFilePayload,
} from './types.js';
import type { XBContextImpl } from './context.js';
import type { XBBrowserImpl } from './browser.js';
import { XBMouseImpl } from './mouse.js';
import { XBKeyboardImpl } from './keyboard.js';
import { XBLocatorImpl } from './locator.js';
import { XBElementHandleImpl } from './element-handle.js';
import {
  type FetchPausedParams,
  globToRegex, matchGlob,
  createResponsePredicate, createRequestPredicate,
  createXBResponse, createXBRequest, createXBRouteFetch,
} from './page-helpers.js';

type XBConsoleType = 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd';

interface PageLoadState {
  loadFired: boolean;
  domContentFired: boolean;
  networkIdle: boolean;
}

interface DialogInfo {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultValue: string;
}

export class XBPageImpl implements XBPage {
  private conn: CDPConnection;
  private _emitter = new EventEmitter();
  private _subscriptions: (() => void)[] = [];
  readonly sessionId: string;
  readonly _targetId: string;
  private _contextImpl: XBContextImpl;
  private _browserImpl: XBBrowserImpl;
  private _closed = false;
  private _url = 'about:blank';
  private _title = '';
  private _viewportSize: { width: number; height: number } | null = null;
  private _loadState: PageLoadState = {
    loadFired: true,
    domContentFired: true,
    networkIdle: true,
  };

  readonly mouse: XBMouse;
  readonly keyboard: XBKeyboard;

  // Network tracking for waitForLoadState('networkidle')
  private inflightRequests = new Set<string>();
  private networkIdleResolve: (() => void) | null = null;
  private networkIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly NETWORK_IDLE_MS = 500;

  constructor(
    conn: CDPConnection,
    sessionId: string,
    targetId: string,
    context: XBContextImpl,
    browser: XBBrowserImpl,
  ) {
    this.conn = conn;
    this.sessionId = sessionId;
    this._targetId = targetId;
    this._contextImpl = context;
    this._browserImpl = browser;

    this.mouse = new XBMouseImpl(conn, sessionId);
    this.keyboard = new XBKeyboardImpl(conn, sessionId);
  }

  protected _emit(event: string, ...args: unknown[]): void {
    this._emitter.emit(event, ...args);
  }

  /** Internal initialization — must be called after construction */
  async _init(): Promise<void> {
    // Enable required CDP domains
    await this.conn.send('Page.enable', undefined, this.sessionId);
    await this.conn.send('Runtime.enable', undefined, this.sessionId);
    await this.conn.send('Network.enable', undefined, this.sessionId);

    // Setup event listeners
    this.setupPageEvents();
    this.setupNetworkEvents();
    this.setupConsoleEvents();

    // Resume if paused at debugger
    await this.conn.send('Runtime.runIfWaitingForDebugger', undefined, this.sessionId).catch(() => {});

    // Get current URL
    try {
      const info = await this.conn.send<{ url: string; title: string }>(
        'Target.getTargetInfo',
        { targetId: this._targetId },
      );
      this._url = info.url;
      this._title = info.title;
    } catch { /* target info optional */ }
  }

  get _connection(): CDPConnection {
    return this.conn;
  }

  // ── Navigation ──────────────────────────────────────────────

  async goto(
    url: string,
    opts: { waitUntil?: WaitUntilState; timeout?: number; referer?: string } = {},
  ): Promise<XBNavigationResponse | null> {
    if (this._closed) throw new Error('Page is closed');

    const waitUntil = opts.waitUntil ?? 'load';
    const timeout = opts.timeout ?? 30_000;

    // Reset load state
    this._loadState = { loadFired: false, domContentFired: false, networkIdle: false };

    // Navigate
    const result = await this.conn.send<{ errorText?: string; frameId?: string }>(
      'Page.navigate',
      { url, referrer: opts.referer },
      this.sessionId,
    );

    if (result.errorText) {
      throw new Error(`Navigation failed: ${result.errorText}`);
    }

    // Wait for the specified load state
    await this.waitForLoadState(waitUntil, timeout);

    this._url = url;

    // Best-effort navigation response — CDP doesn't expose HTTP status directly
    const statusCode = 200;
    const finalUrl = url;
    const headers: Record<string, string> = {};
    return {
      status: () => statusCode,
      ok: () => statusCode >= 200 && statusCode < 300,
      url: () => finalUrl,
      headers: () => headers,
    };
  }

  async goBack(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    await this.evaluate('() => history.back()');
    await this.waitForLoadState(opts.waitUntil ?? 'load', opts.timeout);
  }

  async goForward(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    await this.evaluate('() => history.forward()');
    await this.waitForLoadState(opts.waitUntil ?? 'load', opts.timeout);
  }

  async reload(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    this._loadState = { loadFired: false, domContentFired: false, networkIdle: false };
    await this.conn.send('Page.reload', undefined, this.sessionId);
    await this.waitForLoadState(opts.waitUntil ?? 'load', opts.timeout);
  }

  async waitForLoadState(state: WaitUntilState = 'load', timeout = 30_000): Promise<void> {
    if (this._closed) throw new Error('Page is closed');

    const checkState = (): boolean => {
      switch (state) {
        case 'domcontentloaded': return this._loadState.domContentFired;
        case 'load': return this._loadState.loadFired;
        case 'networkidle': return this._loadState.networkIdle;
        case 'commit': return this._loadState.domContentFired;
        default: return true;
      }
    };

    if (checkState()) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`waitForLoadState('${state}') timeout after ${timeout}ms`));
      }, timeout);

      const check = (): void => {
        if (checkState()) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Allow process to exit even if timer is pending
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  async waitForSelector(
    selector: string,
    opts: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number } = {},
  ): Promise<void> {
    const state = opts.state ?? 'visible';
    const timeout = opts.timeout ?? 30_000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const exists = await this.evaluate<boolean>(
        `(function() { const el = document.querySelector(${JSON.stringify(selector)}); return !!el; })()`,
      );

      if (state === 'attached' && exists) return;
      if (state === 'detached' && !exists) return;

      if (state === 'visible' && exists) {
        const visible = await this.evaluate<boolean>(
          `(function() { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const rect = el.getBoundingClientRect(); const style = window.getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; })()`,
        );
        if (visible) return;
      }

      if (state === 'hidden' && !exists) return;

      await this.waitForTimeout(100);
    }

    throw new Error(`waitForSelector('${selector}', state='${state}') timeout after ${timeout}ms`);
  }

  async waitForFunction<R>(
    fn: string | Function,
    opts: { timeout?: number; polling?: number | 'raf' } = {},
    ...args: unknown[]
  ): Promise<R> {
    const timeout = opts.timeout ?? 30_000;
    const polling = opts.polling ?? 100;
    const deadline = Date.now() + timeout;

    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    let lastError: Error | null = null;

    while (Date.now() < deadline) {
      try {
        const result = await this.evaluate<R>(
          `(function(fnStr, ...evalArgs) { const fn = new Function('return ' + fnStr); return fn(...evalArgs); })(${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
        );
        if (result) return result;
      } catch (err) {
        lastError = err as Error;
      }
      const pollMs = typeof polling === 'number' ? polling : 16;
      await this.waitForTimeout(pollMs);
    }

    const detail = lastError ? `\nLast error: ${lastError.message}` : '';
    throw new Error(`waitForFunction timeout after ${timeout}ms${detail}`);
  }

  url(): string {
    return this._url;
  }

  async title(): Promise<string> {
    this._title = await this.evaluate<string>('document.title');
    return this._title;
  }

  async content(): Promise<string> {
    return this.evaluate<string>('document.documentElement.outerHTML');
  }

  // ── Evaluation ──────────────────────────────────────────────

  async evaluate<R = unknown>(
    fn: string | Function,
    ...args: unknown[]
  ): Promise<R> {
    if (this._closed) throw new Error('Page is closed');

    let expression: string;
    if (typeof fn === 'string') {
      expression = fn;
    } else {
      const argStr = args.length > 0
        ? `...${JSON.stringify(args)}`
        : '';
      expression = `(()=>{const __fn=(${fn.toString()});return __fn(${argStr});})()`;
    }

    const result = await this.conn.send<{
      result?: { type: string; value?: unknown; description?: string; subtype?: string };
      exceptionDetails?: {
        text: string;
        exception?: { description?: string; value?: string };
      };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, this.sessionId);

    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.exception?.value
        ?? result.exceptionDetails.text;
      throw new Error(`${detail}`);
    }

    return result.result?.value as R;
  }

  async $eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    return this.evaluate<R>(
      `(function(sel, fnStr, ...evalArgs) {
        const el = document.querySelector(sel);
        if (!el) throw new Error('No element found for selector: ' + sel);
        const fn = new Function('return ' + fnStr)();
        return fn(el, ...evalArgs);
      })(${JSON.stringify(selector)}, ${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
    );
  }

  async $$eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    return this.evaluate<R>(
      `(function(sel, fnStr, ...evalArgs) {
        const els = Array.from(document.querySelectorAll(sel));
        const fn = new Function('return ' + fnStr)();
        return fn(els, ...evalArgs);
      })(${JSON.stringify(selector)}, ${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
    );
  }

  // ── Locator ─────────────────────────────────────────────────

  locator(selector: string): XBLocator {
    return new XBLocatorImpl(this, selector);
  }

  getByText(text: string, opts?: { exact?: boolean }): XBLocator {
    const escaped = text.replace(/'/g, "\\'");
    if (opts?.exact) {
      return this.locator(`xpath=//*[normalize-space(text())='${escaped}']`);
    }
    return this.locator(`xpath=//*[contains(text(),'${escaped}')]`);
  }

  getByRole(role: string, opts?: { name?: string; exact?: boolean }): XBLocator {
    let sel = `[role="${role}"]`;
    if (opts?.name) {
      sel += opts.exact
        ? `[aria-label="${opts.name}"]`
        : `[aria-label*="${opts.name}"]`;
    }
    return this.locator(sel);
  }

  getByLabel(label: string, opts?: { exact?: boolean }): XBLocator {
    const escaped = label.replace(/'/g, "\\'");
    const sel = opts?.exact
      ? `xpath=//*[@aria-label='${escaped}' or @id=//label[normalize-space(text())='${escaped}']/@for]`
      : `xpath=//*[contains(@aria-label,'${escaped}') or @id=//label[contains(text(),'${escaped}')]/@for]`;
    return this.locator(sel);
  }

  getByPlaceholder(text: string, opts?: { exact?: boolean }): XBLocator {
    return this.locator(
      opts?.exact ? `[placeholder="${text}"]` : `[placeholder*="${text}"]`,
    );
  }

  getByTestId(id: string): XBLocator {
    return this.locator(`[data-testid="${id}"]`);
  }

  getByAltText(text: string, opts?: { exact?: boolean }): XBLocator {
    return this.locator(opts?.exact ? `[alt="${text}"]` : `[alt*="${text}"]`);
  }

  getByTitle(title: string, opts?: { exact?: boolean }): XBLocator {
    return this.locator(
      opts?.exact ? `[title="${title}"]` : `[title*="${title}"]`,
    );
  }

  // ── Interaction shortcuts ───────────────────────────────────

  async click(selector: string, opts: XBClickOptions = {}): Promise<void> {
    await this.locator(selector).click(opts);
  }

  async dblclick(selector: string, opts: XBClickOptions = {}): Promise<void> {
    await this.locator(selector).click({ ...opts, clickCount: 2 });
  }

  async fill(selector: string, value: string, opts: XBFillOptions = {}): Promise<void> {
    await this.locator(selector).fill(value, opts);
  }

  async press(selector: string, key: string, opts?: { timeout?: number }): Promise<void> {
    await this.locator(selector).press(key, opts);
  }

  async hover(selector: string, opts?: { timeout?: number; force?: boolean }): Promise<void> {
    await this.locator(selector).hover(opts);
  }

  async type(selector: string, text: string, opts: { delay?: number; timeout?: number } = {}): Promise<void> {
    await this.locator(selector).type(text, opts);
  }

  async check(selector: string, opts?: { timeout?: number }): Promise<void> {
    await this.locator(selector).check(opts);
  }

  async uncheck(selector: string, opts?: { timeout?: number }): Promise<void> {
    await this.locator(selector).uncheck(opts);
  }

  async selectOption(
    selector: string,
    value: string | string[] | { label?: string; value?: string; index?: number },
  ): Promise<string[]> {
    return this.locator(selector).selectOption(value);
  }

  // ── Convenience selectors ───────────────────────────────────

  async textContent(selector: string): Promise<string | null> {
    return this.evaluate<string | null>(
      `(function() { const el = document.querySelector(${JSON.stringify(selector)}); return el?.textContent ?? null; })()`,
    );
  }

  async innerText(selector: string): Promise<string> {
    return this.evaluate<string>(
      `(function() { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Element not found'); return el.innerText; })()`,
    );
  }

  async innerHTML(selector: string): Promise<string> {
    return this.evaluate<string>(
      `(function() { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Element not found'); return el.innerHTML; })()`,
    );
  }

  async getAttribute(selector: string, name: string): Promise<string | null> {
    return this.evaluate<string | null>(
      `(function() { const el = document.querySelector(${JSON.stringify(selector)}); return el?.getAttribute(${JSON.stringify(name)}) ?? null; })()`,
    );
  }

  // ── Query ───────────────────────────────────────────────────

  async $(selector: string): Promise<XBElementHandle | null> {
    const nodeId = await this.querySelector(selector);
    if (!nodeId) return null;
    return new XBElementHandleImpl(this, nodeId);
  }

  async $$(selector: string): Promise<XBElementHandle[]> {
    const nodeIds = await this.querySelectorAll(selector);
    return nodeIds.map((id) => new XBElementHandleImpl(this, id));
  }

  // ── Screen ──────────────────────────────────────────────────

  async screenshot(opts: XBScreenshotOptions = {}): Promise<Buffer> {
    const params: Record<string, unknown> = {
      format: opts.type ?? 'png',
    };

    if (opts.quality !== undefined && (opts.type === 'jpeg' || (!opts.type && opts.quality))) {
      params.quality = opts.quality;
    }

    if (opts.fullPage) {
      params.captureBeyondViewport = true;
    }

    if (opts.clip) {
      params.clip = opts.clip;
    }

    if (opts.omitBackground) {
      params.omitBackground = true;
    }

    const result = await this.conn.send<{ data: string }>(
      'Page.captureScreenshot',
      params,
      this.sessionId,
    );

    return Buffer.from(result.data, 'base64');
  }

  async pdf(opts: XBPdfOptions = {}): Promise<Buffer> {
    const params: Record<string, unknown> = {};
    if (opts.landscape !== undefined) params.landscape = opts.landscape;
    if (opts.printBackground !== undefined) params.printBackground = opts.printBackground;
    if (opts.scale !== undefined) params.scale = opts.scale;
    if (opts.format) params.paperFormat = opts.format;
    if (opts.preferCSSPageSize !== undefined) params.preferCSSPageSize = opts.preferCSSPageSize;
    if (opts.margin) {
      if (opts.margin.top) params.marginTop = parseFloat(opts.margin.top);
      if (opts.margin.bottom) params.marginBottom = parseFloat(opts.margin.bottom);
      if (opts.margin.left) params.marginLeft = parseFloat(opts.margin.left);
      if (opts.margin.right) params.marginRight = parseFloat(opts.margin.right);
    }
    const result = await this.conn.send<{ data: string }>('Page.printToPDF', params, this.sessionId);
    return Buffer.from(result.data, 'base64');
  }

  viewportSize(): { width: number; height: number } | null {
    // Tracked via Emulation.setDeviceMetricsOverride
    return this._viewportSize ?? null;
  }

  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    await this.conn.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      this.sessionId,
    );
    this._viewportSize = size;
  }

  // ── Scripts ─────────────────────────────────────────────────

  async addInitScript(script: string): Promise<void> {
    await this.conn.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: script },
      this.sessionId,
    );
  }

  /** Internal: set user agent */
  async _setUserAgent(userAgent: string): Promise<void> {
    await this.conn.send(
      'Network.setUserAgentOverride',
      { userAgent },
      this.sessionId,
    );
  }

  /** Internal: set extra HTTP headers */
  async _setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    await this.setExtraHTTPHeaders(headers);
  }

  async bringToFront(): Promise<void> {
    await this.conn.send('Page.bringToFront', undefined, this.sessionId);
  }

  async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    await this.conn.send('Network.setExtraHTTPHeaders', { headers }, this.sessionId);
  }

  // ── Events ──────────────────────────────────────────────────

  on(event: string, handler: (...args: unknown[]) => void): void {
    this._emitter.on(event, handler);
  }

  off(event: string, handler: Function): void {
    this._emitter.off(event, handler as (...args: unknown[]) => void);
  }

  // ── Lifecycle ───────────────────────────────────────────────

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Clear network idle timer to prevent leaks
    if (this.networkIdleTimer) {
      clearTimeout(this.networkIdleTimer);
      this.networkIdleTimer = null;
    }

    // Unsubscribe all event listeners
    for (const unsub of this._subscriptions) {
      unsub();
    }
    this._subscriptions = [];

    // Close the target (which closes the page)
    await this._browserImpl._closeTarget(this._targetId).catch(() => {});

    // Detach session
    await this._browserImpl._detachFromTarget(this.sessionId).catch(() => {});

    this._emitter.emit('close');
  }

  isClosed(): boolean {
    return this._closed;
  }

  context(): XBContext {
    return this._contextImpl;
  }

  browser(): XBBrowser {
    return this._browserImpl;
  }

  mainFrame(): XBFrame {
    return {
      url: () => this._url,
      name: () => '',
      isDetached: () => this._closed,
      page: () => this,
      evaluate: (fn, ...args) => this.evaluate(fn, ...args),
      $: (sel) => this.$(sel),
      $$: (sel) => this.$$(sel),
    };
  }

  frames(): XBFrame[] {
    return [this.mainFrame()];
  }

  // ── CDP helpers exposed for locator/element ─────────────────

  /** Query a single element, returns CDP nodeId or 0 if not found */
  async querySelector(selector: string): Promise<number> {
    // Get document root
    const doc = await this.conn.send<{ root: { nodeId: number } }>(
      'DOM.getDocument',
      { depth: 0 },
      this.sessionId,
    );

    const result = await this.conn.send<{ nodeId: number }>(
      'DOM.querySelector',
      { nodeId: doc.root.nodeId, selector },
      this.sessionId,
    );

    return result.nodeId;
  }

  /** Query all matching elements, returns array of CDP nodeIds */
  async querySelectorAll(selector: string): Promise<number[]> {
    const doc = await this.conn.send<{ root: { nodeId: number } }>(
      'DOM.getDocument',
      { depth: 0 },
      this.sessionId,
    );

    const result = await this.conn.send<{ nodeIds: number[] }>(
      'DOM.querySelectorAll',
      { nodeId: doc.root.nodeId, selector },
      this.sessionId,
    );

    return result.nodeIds ?? [];
  }

  /** Resolve a CDP nodeId to a RemoteObject for evaluate */
  async resolveNode(nodeId: number): Promise<string> {
    const result = await this.conn.send<{ object: { objectId: string } }>(
      'DOM.resolveNode',
      { nodeId },
      this.sessionId,
    );
    return result.object.objectId;
  }

  /** Get the box model for a nodeId */
  async getBoxModel(nodeId: number): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
      const result = await this.conn.send<{
        model: { content: number[] };
      }>('DOM.getBoxModel', { nodeId }, this.sessionId);

      const c = result.model?.content;
      if (!c || c.length < 8) return null;

      const x1 = c[0];
      const y1 = c[1];
      const x2 = c[4];
      const y2 = c[5];

      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    } catch {
      return null;
    }
  }

  /** Call a function on a RemoteObject */
  async callFunctionOn<T = unknown>(
    objectId: string,
    functionDeclaration: string,
    args: unknown[] = [],
  ): Promise<T> {
    const result = await this.conn.send<{
      result?: { value?: T; type: string };
      exceptionDetails?: { text: string };
    }>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args.map((a) => ({ value: a })),
      returnByValue: true,
    }, this.sessionId);

    if (result.exceptionDetails) {
      throw new Error(`CallFunctionOn error: ${result.exceptionDetails.text}`);
    }

    return result.result?.value as T;
  }

  /** Send a CDP command scoped to this page's session */
  async _cdpSend<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.conn.send<T>(method, params, this.sessionId);
  }

  /** Subscribe to a CDP event on this page's session. Returns unsubscribe function. */
  _subscribe(event: string, handler: (params: unknown) => void): () => void {
    return this.conn.subscribe(event, this.sessionId, handler);
  }

  // ── Private: Event Setup ────────────────────────────────────

  private setupPageEvents(): void {
    // Page navigation events
    this._subscriptions.push(
      this.conn.subscribe('Page.frameNavigated', this.sessionId, (params: unknown) => {
        const p = params as { frame: { url: string } };
        if (p.frame) {
          this._url = p.frame.url;
        }
        this._emit('framenavigated', this.mainFrame());
      }),
    );

    this._subscriptions.push(
      this.conn.subscribe('Page.loadEventFired', this.sessionId, () => {
        this._loadState.loadFired = true;
      }),
    );

    this._subscriptions.push(
      this.conn.subscribe('Page.domContentEventFired', this.sessionId, () => {
        this._loadState.domContentFired = true;
      }),
    );

    this._subscriptions.push(
      this.conn.subscribe('Page.javascriptDialogOpening', this.sessionId, (params: unknown) => {
        const p = params as DialogInfo;
        const dialog: XBDIALOG = {
          type: p.type,
          message: () => p.message,
          defaultValue: () => p.defaultValue,
          accept: async (text?: string) => {
            await this.conn.send('Page.handleJavaScriptDialog', {
              accept: true,
              promptText: text,
            }, this.sessionId);
          },
          dismiss: async () => {
            await this.conn.send('Page.handleJavaScriptDialog', {
              accept: false,
            }, this.sessionId);
          },
        };
        this._emit('dialog', dialog);
      }),
    );
  }

  private setupNetworkEvents(): void {
    this._subscriptions.push(
      this.conn.subscribe('Network.requestWillBeSent', this.sessionId, (params: unknown) => {
        const p = params as {
          requestId: string;
          request: { url: string; method: string; headers: Record<string, string>; postData?: string };
          type: string;
        };
        this.inflightRequests.add(p.requestId);
        this._storeNetworkRequest(p.requestId, {
          url: p.request.url,
          method: p.request.method,
          headers: p.request.headers,
          postData: p.request.postData ?? null,
          resourceType: p.type,
        });
        this._emit('request', p);
        this.checkNetworkIdle();
      }),
    );

    this._subscriptions.push(
      this.conn.subscribe('Network.responseReceived', this.sessionId, (params: unknown) => {
        const p = params as {
          requestId: string;
          type: string;
          response: {
            status: number;
            url: string;
            headers: Record<string, string>;
            mimeType: string;
          };
        };
        this._storeNetworkResponse(p.requestId, {
          status: p.response.status,
          url: p.response.url,
          headers: p.response.headers,
        });
        this._emit('response', p);
      }),
    );

    this._subscriptions.push(
      this.conn.subscribe('Network.loadingFinished', this.sessionId, (params: unknown) => {
        const p = params as { requestId: string };
        this.inflightRequests.delete(p.requestId);
        this._emit('requestfinished', p);
        this.checkNetworkIdle();
      }),
    );

    this._subscriptions.push(
      this.conn.subscribe('Network.loadingFailed', this.sessionId, (params: unknown) => {
        const p = params as { requestId: string };
        this.inflightRequests.delete(p.requestId);
        this.checkNetworkIdle();
      }),
    );
  }

  private setupConsoleEvents(): void {
    this._subscriptions.push(
      this.conn.subscribe('Runtime.consoleAPICalled', this.sessionId, (params: unknown) => {
        const p = params as {
          type: string;
          args: { value?: unknown; description?: string }[];
          stackTrace?: { callFrames: { url: string; lineNumber: number; columnNumber: number }[] };
        };

        const text = p.args.map((a) => {
          if (a.value !== undefined) return String(a.value);
          return a.description ?? '';
        }).join(' ');

        const location = p.stackTrace?.callFrames?.[0]
          ? {
              url: p.stackTrace.callFrames[0].url,
              lineNumber: p.stackTrace.callFrames[0].lineNumber,
              columnNumber: p.stackTrace.callFrames[0].columnNumber,
            }
          : { url: '', lineNumber: 0, columnNumber: 0 };

        const msg: XBConsoleMessage = {
          type: () => p.type as XBConsoleType,
          text: () => text,
          location: () => location,
        };

        this._emit('console', msg);
      }),
    );
  }

  private checkNetworkIdle(): void {
    if (this.inflightRequests.size === 0) {
      // Network is potentially idle — wait for quiet window
      if (this.networkIdleTimer) clearTimeout(this.networkIdleTimer);
      this.networkIdleTimer = setTimeout(() => {
        if (this.inflightRequests.size === 0) {
          this._loadState.networkIdle = true;
          if (this.networkIdleResolve) {
            this.networkIdleResolve();
            this.networkIdleResolve = null;
          }
        }
      }, XBPageImpl.NETWORK_IDLE_MS);
    } else {
      if (this.networkIdleTimer) {
        clearTimeout(this.networkIdleTimer);
        this.networkIdleTimer = null;
      }
    }
  }

  // ── Network Data Store (for waitForResponse/waitForRequest) ──

  _networkResponses = new Map<string, { requestId: string; status: number; url: string; headers: Record<string, string> }>();
  _networkRequests = new Map<string, { requestId: string; url: string; method: string; headers: Record<string, string>; postData: string | null; resourceType: string }>();
  private _routeHandlers: Array<{ pattern: string; regex: RegExp; handler: (route: XBRoute) => Promise<void> | void }> = [];
  private _interceptionEnabled = false;

  /** Store network data — called by browser.ts installNetworkCapture or internal event handlers */
  _storeNetworkRequest(requestId: string, data: { url: string; method: string; headers: Record<string, string>; postData: string | null; resourceType: string }): void {
    this._networkRequests.set(requestId, { requestId, ...data });
  }

  _storeNetworkResponse(requestId: string, data: { status: number; url: string; headers: Record<string, string> }): void {
    this._networkResponses.set(requestId, { requestId, ...data });
  }

  // ── waitForResponse ─────────────────────────────────────────

  async waitForResponse(
    urlOrPredicate: string | RegExp | ((response: XBResponse) => boolean),
    opts: { timeout?: number } = {},
  ): Promise<XBResponse> {
    const timeout = opts.timeout ?? 30000;
    const predicate = createResponsePredicate(urlOrPredicate);

    // Check existing responses
    for (const [, data] of this._networkResponses) {
      const response = createXBResponse(data, this.conn, this.sessionId);
      if (predicate(response)) return response;
    }

    // Wait for future responses
    return new Promise<XBResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._emitter.removeListener('response', handler);
        reject(new Error(`waitForResponse timed out after ${timeout}ms`));
      }, timeout);

      const handler = (params: unknown): void => {
        const p = params as { requestId: string; response: { status: number; url: string; headers: Record<string, string> } };
        const data = {
          requestId: p.requestId,
          status: p.response.status,
          url: p.response.url,
          headers: p.response.headers,
        };
        const response = createXBResponse(data, this.conn, this.sessionId);
        if (predicate(response)) {
          clearTimeout(timer);
          this._emitter.removeListener('response', handler);
          resolve(response);
        }
      };

      this._emitter.on('response', handler);
    });
  }

  // ── waitForRequest ──────────────────────────────────────────

  async waitForRequest(
    urlOrPredicate: string | RegExp | ((request: XBRequest) => boolean),
    opts: { timeout?: number } = {},
  ): Promise<XBRequest> {
    const timeout = opts.timeout ?? 30000;
    const predicate = createRequestPredicate(urlOrPredicate);

    // Check existing requests
    for (const [, data] of this._networkRequests) {
      const request = createXBRequest(this, data);
      if (predicate(request)) return request;
    }

    // Wait for future requests
    return new Promise<XBRequest>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._emitter.removeListener('request', handler);
        reject(new Error(`waitForRequest timed out after ${timeout}ms`));
      }, timeout);

      const handler = (params: unknown): void => {
        const p = params as { requestId: string; request: { url: string; method: string; headers: Record<string, string>; postData?: string }; type: string };
        const data = {
          requestId: p.requestId,
          url: p.request.url,
          method: p.request.method,
          headers: p.request.headers,
          postData: p.request.postData ?? null,
          resourceType: p.type,
        };
        const request = createXBRequest(this, data);
        if (predicate(request)) {
          clearTimeout(timer);
          this._emitter.removeListener('request', handler);
          resolve(request);
        }
      };

      this._emitter.on('request', handler);
    });
  }

  // ── waitForURL ──────────────────────────────────────────────

  async waitForURL(
    url: string | RegExp | ((url: string) => boolean),
    opts: { timeout?: number; waitUntil?: WaitUntilState } = {},
  ): Promise<void> {
    const timeout = opts.timeout ?? 30000;
    const checkFn = typeof url === 'function'
      ? url
      : typeof url === 'string'
        ? (current: string) => matchGlob(url, current)
        : (current: string) => url.test(current);

    // Check current URL
    if (checkFn(this._url)) return;

    // Wait for URL change
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._emitter.removeListener('framenavigated', handler);
        reject(new Error(`waitForURL timed out after ${timeout}ms`));
      }, timeout);

      const handler = (): void => {
        if (checkFn(this._url)) {
          clearTimeout(timer);
          this._emitter.removeListener('framenavigated', handler);
          resolve();
        }
      };

      this._emitter.on('framenavigated', handler);
    });
  }

  // ── route / unroute ─────────────────────────────────────────

  async route(
    url: string | RegExp,
    handler: (route: XBRoute) => Promise<void> | void,
  ): Promise<void> {
    const regex = typeof url === 'string' ? globToRegex(url) : url;
    this._routeHandlers.push({ pattern: String(url), regex, handler });

    if (!this._interceptionEnabled) {
      this._interceptionEnabled = true;
      await this.conn.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }],
      }, this.sessionId);

      this._subscriptions.push(
        this.conn.subscribe('Fetch.requestPaused', this.sessionId, (params: unknown) => {
          this._handleRequestPaused(params as FetchPausedParams);
        }),
      );
    }
  }

  async unroute(
    url: string | RegExp,
    handler?: (route: XBRoute) => Promise<void> | void,
  ): Promise<void> {
    const regex = typeof url === 'string' ? globToRegex(url) : url;
    this._routeHandlers = this._routeHandlers.filter(
      (h) => !(regex.source === h.regex.source && (!handler || h.handler === handler)),
    );

    if (this._routeHandlers.length === 0 && this._interceptionEnabled) {
      this._interceptionEnabled = false;
      await this.conn.send('Fetch.disable', undefined, this.sessionId).catch(() => {});
    }
  }

  private async _handleRequestPaused(params: FetchPausedParams): Promise<void> {
    const requestUrl = params.request.url;

    for (const { regex, handler } of this._routeHandlers) {
      if (regex.test(requestUrl)) {
        const route = createXBRouteFetch(this.conn, this.sessionId, params);
        try {
          await handler(route);
        } catch {
          // Handler threw — continue the request to prevent stalling
          await this.conn.send('Fetch.continueRequest', {
            requestId: params.requestId,
          }, this.sessionId).catch(() => {});
        }
        return;
      }
    }

    // No handler matched — continue the request
    await this.conn.send('Fetch.continueRequest', {
      requestId: params.requestId,
    }, this.sessionId).catch(() => {});
  }

  // ── setInputFiles ───────────────────────────────────────────

  async setInputFiles(selector: string, files: XBFilePayload | XBFilePayload[]): Promise<void> {
    const fileArr = Array.isArray(files) ? files : [files];

    // Use JavaScript DataTransfer API — more reliable across Chrome versions
    // than CDP DOM.setFileInputFiles which has inconsistent parameter formats
    const fileList = fileArr.map((f) => ({
      name: f.name,
      type: f.mimeType,
      dataBase64: f.buffer.toString('base64'),
    }));

    await this.evaluate(`
      (function() {
        var selector = ${JSON.stringify(selector)};
        var input = document.querySelector(selector);
        if (!input) throw new Error('Element not found: ' + selector);

        var fileList = ${JSON.stringify(fileList)};
        var dt = new DataTransfer();

        fileList.forEach(function(f) {
          var binary = atob(f.dataBase64);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          var blob = new Blob([bytes], { type: f.type });
          var file = new File([blob], f.name, { type: f.type });
          dt.items.add(file);
        });

        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
  }

  // ── dragAndDrop ─────────────────────────────────────────────

  async dragAndDrop(source: string, target: string): Promise<void> {

    // Get bounding boxes
    const sourceRect = await this.evaluate<{ x: number; y: number; width: number; height: number }>(`
      (function() {
        const el = document.querySelector(${JSON.stringify(source)});
        if (!el) throw new Error('Source not found: ${source}');
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);

    const targetRect = await this.evaluate<{ x: number; y: number; width: number; height: number }>(`
      (function() {
        const el = document.querySelector(${JSON.stringify(target)});
        if (!el) throw new Error('Target not found: ${target}');
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);

    const sx = sourceRect.x + sourceRect.width / 2;
    const sy = sourceRect.y + sourceRect.height / 2;
    const tx = targetRect.x + targetRect.width / 2;
    const ty = targetRect.y + targetRect.height / 2;

    // Simulate drag-and-drop via CDP Input.dispatchDragEvent
    // First try the DragData approach (more reliable for HTML5 drag-and-drop)
    try {
      await this.conn.send('Input.dispatchDragEvent', {
        type: 'dragStart',
        x: sx,
        y: sy,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.sessionId);

      await this.conn.send('Input.dispatchDragEvent', {
        type: 'dragOver',
        x: tx,
        y: ty,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.sessionId);

      await this.conn.send('Input.dispatchDragEvent', {
        type: 'drop',
        x: tx,
        y: ty,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.sessionId);

      await this.conn.send('Input.dispatchDragEvent', {
        type: 'dragCancel',
        x: sx,
        y: sy,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.sessionId);
    } catch {
      // Fallback: simulate via mouse events
      await this.mouse.move(sx, sy);
      await this.mouse.down();
      await this.mouse.move(tx, ty, { steps: 10 });
      await this.mouse.up();
    }
  }

  // ── setOfflineMode ──────────────────────────────────────────

  async setOfflineMode(offline: boolean): Promise<void> {
    await this.conn.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
    }, this.sessionId);
  }
}

