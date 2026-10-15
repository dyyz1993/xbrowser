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
import { errMsg } from '../utils/error.js';
import type { CDPConnection } from './connection.js';
import type {
  XBPage, XBContext, XBBrowser, XBLocator, XBMouse, XBKeyboard,
  XBElementHandle, XBFrame, WaitUntilState,
  XBClickOptions, XBFillOptions, XBScreenshotOptions, XBPdfOptions,
  XBNavigationResponse,
  XBConsoleMessage,
  XBResponse, XBRequest, XBRoute, XBFilePayload,
} from './types.js';
import type { XBContextImpl } from './context.js';
import type { XBBrowserImpl } from './browser.js';
import { XBMouseImpl } from './mouse.js';
import { XBKeyboardImpl } from './keyboard.js';
import { XBLocatorImpl } from './locator.js';
import { XBElementHandleImpl } from './element-handle.js';
import { MediaService } from './page-media.js';
import { FileInputService } from './page-file-input.js';
import { setupNetworkEvents } from './page-network-events.js';
import { setupPageEvents } from './page-lifecycle-events.js';
import { NetworkWaitService } from './page-network-waits.js';
import { NetworkRouteService } from './page-routes.js';
import { NavigationService } from './page-navigation.js';
import { DomQueryService } from './page-dom.js';
import { queryJS } from './selector-utils.js';


type XBConsoleType = 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd';

interface PageLoadState {
  loadFired: boolean;
  domContentFired: boolean;
  networkIdle: boolean;
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
  private readonly mediaService: MediaService;
  private readonly fileInputService: FileInputService;
  private readonly networkWaitService: NetworkWaitService;
  private readonly networkRouteService: NetworkRouteService;
  private readonly navigationService: NavigationService;
  private readonly domQueryService: DomQueryService;

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
    this.mediaService = new MediaService({
      conn,
      sessionId,
      viewportSize: this._viewportSize,
      evaluate: <T>(script: string) => this.evaluate(script) as Promise<T>,
      onViewportSize: (size) => { this._viewportSize = size; },
    });
    this.fileInputService = new FileInputService({
      conn,
      sessionId,
      evaluate: <T>(script: string) => this.evaluate(script) as Promise<T>,
      mouse: this.mouse,
    });
    this.networkWaitService = new NetworkWaitService({
      conn,
      sessionId,
      responses: this._networkResponses,
      requests: this._networkRequests,
      on: (event, handler) => this._emitter.on(event, handler),
      off: (event, handler) => this._emitter.removeListener(event, handler),
      currentUrl: () => this.url(),
    });
    this.networkRouteService = new NetworkRouteService({
      conn,
      sessionId,
      emit: (event, ...args) => this._emit(event, ...args),
    });
    this.navigationService = new NavigationService({
      conn,
      sessionId,
      state: this._loadState,
      stealthConfig: this._contextImpl.stealthConfig,
      isClosed: () => this._closed,
      setUrl: (url) => { this._url = url; },
      currentUrl: () => this.url(),
      waitForLoadState: (state, timeout) => this.waitForLoadState(state, timeout),
      waitForTimeout: (ms) => this.waitForTimeout(ms),
      evaluate: <T>(script: string) => this.evaluate(script) as Promise<T>,
    });
    this.domQueryService = new DomQueryService({
      conn,
      sessionId,
      evaluate: <T>(script: string) => this.evaluate(script) as Promise<T>,
    });
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
    // DOM agent: without DOM.enable, DOM.getDocument can hang forever on
    // freshly-attached tab sessions (d07: target=_blank tab switch froze every
    // subsequent page.$ call).
    await this.conn.send('DOM.enable', undefined, this.sessionId).catch(() => {});
    // sup-s9: HTTP Basic/Digest 认证压制——主框架导航到 401 挑战时，
    // headful 弹模态认证框（CDP 的 handleJavaScriptDialog 管不着）、
    // 凭证错则反复挂起。Fetch.authRequired 自动响应：配置了凭证则
    // ProvideCredentials，否则 CancelAuth 快速失败。空 patterns 不拦截
    // 常规请求（仅认证事件）。
    // sup-s12: SSL interstitial 压制——ignoreHTTPSErrors 原为死字段（声明
    // 零消费者），接线 Security.setIgnoreCertificateErrors（自签/内网页）
    if (this._contextImpl.ignoreHTTPSErrors) {
      await this.conn.send('Security.enable', undefined, this.sessionId).catch(() => {});
      await this.conn.send('Security.setIgnoreCertificateErrors', { ignore: true }, this.sessionId).catch(() => {});
    }

    // sup-s9: HTTP Basic/Digest 认证压制——主框架导航到 401 挑战时，
    // headful 弹模态认证框（handleJavaScriptDialog 管不着）。s9 三点实证：
    // ①headless 无凭证本就快速失败（ERR_INVALID_AUTH_CREDENTIALS，无框
    // 无挂起）——压制默认态免费；②本构建 Fetch.enable 空 patterns=拦截
    // 全部请求（about:blank 加载挂起→newPage 卡死）；③patterns 同时门控
    // authRequired（永不匹配 pattern 会让 auth 事件也收不到）。
    // 结论：仅凭证场景启用（pattern 全配 + requestPaused 旁路直通），
    // authRequired 按 context.httpCredentials 应答，无凭证路径走原生快败。
    if (this._contextImpl.httpCredentials) {
      await this.conn.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }],
        handleAuthRequests: true,
      }, this.sessionId).catch(() => {});
      this._subscriptions.push(
        this.conn.subscribe('Fetch.requestPaused', this.sessionId, (params: unknown) => {
          // route() 未激活时旁路直通（仅认证场景需要 Fetch，不拦截常规流量）
          if (this.networkRouteService.isInterceptionEnabled) return;
          const p = params as { requestId: string };
          this.conn.send('Fetch.continueRequest', { requestId: p.requestId }, this.sessionId).catch(() => {});
        }),
      );
      this._subscriptions.push(
        this.conn.subscribe('Fetch.authRequired', this.sessionId, (params: unknown) => {
          const p = params as { requestId: string };
          const creds = this._contextImpl.httpCredentials;
          this.conn.send('Fetch.continueWithAuth', {
            requestId: p.requestId,
            authChallengeResponse: creds
              ? { response: 'ProvideCredentials', username: creds.username, password: creds.password }
              : { response: 'CancelAuth' },
          }, this.sessionId).catch(() => { /* best-effort */ });
        }),
      );
    }

    // r29: 打印对话框压制——headful 下 print 预览会阻塞页面交互；    // headless 本就无副作用，统一守卫并打标记供测试/诊断断言。
    // sup-s2: File System Access API stub——showOpenFilePicker 等弹 OS 级
    // 系统对话框（CDP 无法拦截，headless 下 promise 挂起/拒绝），stub 返回
    // 合成 FileSystemFileHandle（包装内存 File），页面无感零弹框。
    await this.conn.send('Page.addScriptToEvaluateOnNewDocument', {
      source: [
        'try { window.print = function() {}; window.__xb_print_suppressed = true; } catch (e) {}',
        'try {',
        '  if (window.showOpenFilePicker) {',
        '    var __xb_mkHandle = function(name, content) {',
        '      var file = new File([content], name, { type: "text/plain" });',
        '      return {',
        '        kind: "file", name: name,',
        '        getFile: function() { return Promise.resolve(file); },',
        '        createWritable: function() { return Promise.resolve({ write: function() { return Promise.resolve(); }, close: function() { return Promise.resolve(); } }); },',
        '        isSameEntry: function() { return Promise.resolve(false); },',
        '        queryPermission: function() { return Promise.resolve("granted"); },',
        '        requestPermission: function() { return Promise.resolve("granted"); },',
        '      };',
        '    };',
        '    window.showOpenFilePicker = function() {',
        '      return Promise.resolve([__xb_mkHandle("xbrowser-stub.txt", "xbrowser fs access stub")]);',
        '    };',
        '    window.showSaveFilePicker = function() {',
        '      return Promise.resolve(__xb_mkHandle("xbrowser-stub-save.txt", ""));',
        '    };',
        '    window.showDirectoryPicker = function() {',
        '      var emptyIter = function() { return [][Symbol.iterator](); };',
        '      return Promise.resolve({',
        '        kind: "directory", name: "xbrowser-stub-dir",',
        '        values: emptyIter, entries: emptyIter, keys: emptyIter,',
        '        getDirectoryHandle: function() { return Promise.reject(new Error("stub empty dir")); },',
        '        getFileHandle: function() { return Promise.reject(new Error("stub empty dir")); },',
        '        isSameEntry: function() { return Promise.resolve(false); },',
        '        queryPermission: function() { return Promise.resolve("granted"); },',
        '        requestPermission: function() { return Promise.resolve("granted"); },',
        '      });',
        '    };',
        '    window.__xb_fs_stub_installed = true;',
        '  }',
        '} catch (e) {}',
        // sup-s7: 右键菜单压制——headful 下 CDP 右键弹浏览器原生菜单（CDP
        // 无法关闭浏览器 UI）。document 捕获阶段 preventDefault 抑制原生
        // 菜单；不阻断传播，录制 contextmenu 事件与页面自定义菜单不受影响。
        'try {',
        '  document.addEventListener("contextmenu", function(e) { e.preventDefault(); }, true);',
        '  window.__xb_ctxmenu_suppressed = true;',
        '} catch (e) {}',
        // sup-s10: Notification 守卫——new Notification() 弹 OS 级系统横幅
        // （headful 污染屏幕，等待通知交互的流程挂起）。no-op 包装但保
        // API 形状：permission/granted、requestPermission→granted、实例
        // title/close 可用——页面通知流程无感继续。
        'try {',
        '  var XBN = function Notification(title, options) {',
        '    this.title = title;',
        '    this.body = (options && options.body) || "";',
        '    this.tag = (options && options.tag) || "";',
        '    this.onclick = null; this.onshow = null; this.onerror = null; this.onclose = null;',
        '  };',
        '  XBN.prototype.close = function() {};',
        '  XBN.permission = "granted";',
        '  XBN.requestPermission = function() { return Promise.resolve("granted"); };',
        '  XBN.maxActions = (window.Notification && window.Notification.maxActions) || 2;',
        '  window.Notification = XBN;',
        '  window.__xb_notification_suppressed = true;',
        '} catch (e) {}',
        // sup-W1: WebAPI 选择器/配对框家族 stub（1/7 Serial）——
        // navigator.serial.requestPort() 弹浏览器原生串口选择器（CDP 无法
        // 拦截），headless 下 promise 挂起。stub 返回 rejected Promise
        // （NotFoundError），页面 catch 分支接管、流程继续。
        'try {',
        '  if (navigator.serial) {',
        '    navigator.serial.requestPort = function() {',
        '      return Promise.reject(new DOMException("xbrowser serial stub", "NotFoundError"));',
        '    };',
        '    window.__xb_serial_stubbed = true;',
        '  }',
        '} catch (e) {}',
        // sup-W2: WebAPI stub（2/7 USB）——requestDevice 弹原生设备配对框，
        // 同 Serial pattern：rejected Promise（NotFoundError），catch 接管。
        'try {',
        '  if (navigator.usb) {',
        '    navigator.usb.requestDevice = function() {',
        '      return Promise.reject(new DOMException("xbrowser usb stub", "NotFoundError"));',
        '    };',
        '    window.__xb_usb_stubbed = true;',
        '  }',
        '} catch (e) {}',
        // sup-W3: WebAPI stub（3/7 Bluetooth）——requestDevice 弹原生蓝牙
        // 配对框，同 Serial/USB pattern：rejected Promise（NotFoundError）。
        // CI linux headless 下 navigator.bluetooth 原生不存在——缺失时合成
        // 对象再包装，保证跨平台语义一致（requestDevice 恒 rejected）。
        'try {',
        '  if (!navigator.bluetooth) {',
        '    try { Object.defineProperty(navigator, "bluetooth", { value: {}, configurable: true }); } catch (e) {}',
        '  }',
        '  if (navigator.bluetooth) {',
        '    navigator.bluetooth.requestDevice = function() {',
        '      return Promise.reject(new DOMException("xbrowser ble stub", "NotFoundError"));',
        '    };',
        '    window.__xb_ble_stubbed = true;',
        '  }',
        '} catch (e) {}',
        // sup-W4: WebAPI stub（4/7 HID）——requestDevices 弹原生 HID 设备
        // 选择器，同家族 pattern：rejected Promise（NotFoundError）。
        'try {',
        '  if (navigator.hid) {',
        '    navigator.hid.requestDevices = function() {',
        '      return Promise.reject(new DOMException("xbrowser hid stub", "NotFoundError"));',
        '    };',
        '    window.__xb_hid_stubbed = true;',
        '  }',
        '} catch (e) {}',
        // sup-W5: WebAPI stub（5/7 WakeLock）——request('screen') 在无用户
        // 激活/权限时挂起或拒绝，等待 wake 事件的流程死锁。stub 返回合成
        // sentinel（release 可用，不真实持锁）。
        'try {',
        '  if (navigator.wakeLock) {',
        '    navigator.wakeLock.request = function() {',
        '      return Promise.resolve({',
        '        released: false,',
        '        type: "screen",',
        '        release: function() { this.released = true; return Promise.resolve(); },',
        '        addEventListener: function() {},',
        '        removeEventListener: function() {},',
        '      });',
        '    };',
        '    window.__xb_wakelock_stubbed = true;',
        '  }',
        '} catch (e) {}',
        // sup-W6: WebAPI stub（6/7 IdleDetector）——start() 需权限气泡授权
        // 才能继续，headless 下挂起。stub 返回 rejected（NotAllowedError），
        // 页面 catch 分支接管。
        'try {',
        '  if (window.IdleDetector) {',
        '    IdleDetector.start = function() {',
        '      return Promise.reject(new DOMException("xbrowser idle stub", "NotAllowedError"));',
        '    };',
        '    window.__xb_idle_stubbed = true;',
        '  }',
        '} catch (e) {}',
        // sup-W7: WebAPI stub（7/7 PaymentRequest）——show() 弹浏览器支付
        // 面板（无用户交互不关闭），headless 下 promise 挂起。stub 返回
        // rejected（NotAllowedError），页面 catch 分支接管。
        'try {',
        '  if (window.PaymentRequest) {',
        '    PaymentRequest.prototype.show = function() {',
        '      return Promise.reject(new DOMException("xbrowser pay stub", "NotAllowedError"));',
        '    };',
        '    window.__xb_pay_stubbed = true;',
        '  }',
        '} catch (e) {}',
      ].join('\n'),
    }, this.sessionId).catch(() => {});

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
      // Auto-attached pages (target=_blank, window.open) already finished
      // loading BEFORE we attached — the load events fired without us. Mark
      // the load state as reached, or every waitForLoadState('load'/'dom…')
      // needlessly burns its full timeout (d07: 30s per call).
      if (info.url && info.url !== 'about:blank' && info.url !== '') {
        this._loadState = { loadFired: true, domContentFired: true, networkIdle: true };
      }
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
    return this.navigationService.goto(url, opts);
  }

  async goBack(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    return this.navigationService.goBack(opts);
  }

  async goForward(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    return this.navigationService.goForward(opts);
  }

  async reload(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    return this.navigationService.reload(opts);
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
        `(function() { const el = ${queryJS(selector)}; return !!el; })()`,
      );

      if (state === 'attached' && exists) return;
      if (state === 'detached' && !exists) return;

      if (state === 'visible' && exists) {
        const visible = await this.evaluate<boolean>(
          `(function() { const el = ${queryJS(selector)}; if (!el) return false; const rect = el.getBoundingClientRect(); const style = window.getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; })()`,
        );
        if (visible) return;
      }

      if (state === 'hidden') {
        if (!exists) return;
        const visible = await this.evaluate<boolean>(
          `(function() { const el = ${queryJS(selector)}; if (!el) return false; const rect = el.getBoundingClientRect(); const style = window.getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; })()`,
        );
        if (!visible) return;
      }

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
        lastError = err instanceof Error ? err : new Error(errMsg(err));
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
    // Poll for non-empty title — at domcontentloaded time, <title> may not
    // be parsed yet. Wait up to 1s (20 × 50ms) for it to become available.
    for (let i = 0; i < 20; i++) {
      try {
        this._title = await this.evaluate<string>('document.title');
        if (this._title) return this._title;
      } catch {
        // execution context not ready — retry
      }
      await new Promise(r => setTimeout(r, 50));
    }
    // Fallback to Target.getTargetInfo if evaluate didn't yield a title
    try {
      const info = await this._cdpSend<{ title?: string }>('Target.getTargetInfo', { targetId: this._targetId });
      if (info?.title) {
        this._title = info.title;
        return this._title;
      }
    } catch {
      // best-effort
    }
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

    // Dismiss any pending dialog before evaluation (prevents hanging on stale alerts)
    this.conn.send('Page.handleJavaScriptDialog', { accept: false }, this.sessionId).catch(() => {});

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

  /**
   * 在指定 iframe 上下文中执行表达式（攻防 D16 能力建设，2026-08-19）。
   *
   * 双路径：
   *  1. 同进程 iframe —— Runtime.enable 收集 executionContextCreated，
   *     找到目标 frameId 的 contextId，用 contextId 定向执行；
   *  2. 跨域 OOPIF（独立 target）—— Target.setAutoAttach(flatten) 监听
   *     attachedToTarget 中 type==='iframe' 的会话，用其 sessionId 执行。
   *
   * 这绕过了页面同源策略（那是页面 JS 的约束，CDP 是调试通道）——
   * 支付窗/验证码/第三方嵌入内容的读写都靠它。
   */
  async evaluateInFrame<R = unknown>(urlIncludes: string, expression: string): Promise<R> {
    if (this._closed) throw new Error('Page is closed');

    const evalIn = async (sessionId: string | undefined, contextId?: number): Promise<R> => {
      const params: Record<string, unknown> = { expression, returnByValue: true, awaitPromise: true };
      if (contextId !== undefined) params.contextId = contextId;
      const result = await this.conn.send<{
        result?: { value?: unknown };
        exceptionDetails?: { text: string; exception?: { description?: string; value?: string } };
      }>('Runtime.evaluate', params, sessionId);
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.exception?.value
          ?? result.exceptionDetails.text;
        throw new Error(`[frame ${urlIncludes}] ${detail}`);
      }
      return result.result?.value as R;
    };

    // 路径 A（首选）：OOPIF 是独立 CDP target——浏览器级 Target.getTargets
    // 直接按 type==='iframe' + URL 匹配，attach 后执行。实测 Page.getFrameTree
    // 对 OOPIF 不可靠（树里没有，但 target 存在且正常渲染）。
    try {
      const tg = await this.conn.send<{ targetInfos?: Array<{ targetId: string; type: string; url?: string }> }>('Target.getTargets', undefined);
      const hit = (tg.targetInfos || []).find((t) => t.type === 'iframe' && (t.url || '').includes(urlIncludes));
      if (hit) {
        const att = await this.conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId: hit.targetId, flatten: true });
        return evalIn(att.sessionId);
      }
    } catch { /* 落到路径 B（tunnel 扩展链路可能不支持浏览器级 getTargets） */ }

    // 路径 B：同进程 iframe——Runtime.enable 收集 executionContextCreated，
    // 用 Page.getFrameTree 做 frameId→URL 映射，contextId 定向执行
    type FrameNode = { frame: { id: string; url: string }; childFrames?: FrameNode[] };
    type CtxEvent = { context?: { id?: number; auxData?: { frameId?: string } } };
    type AttachEvent = { sessionId?: string; targetInfo?: { type?: string; url?: string } };
    const tree = await this.conn.send<{ frameTree: FrameNode }>('Page.getFrameTree', undefined, this.sessionId);
    const all: Array<{ id: string; url: string }> = [];
    const walk = (node: FrameNode): void => {
      all.push({ id: node.frame.id, url: node.frame.url });
      for (const child of node.childFrames || []) walk(child);
    };
    walk(tree.frameTree);
    const mainId = tree.frameTree?.frame?.id;
    const target = all.find((f) => f.id !== mainId && f.url.includes(urlIncludes));

    if (target) {
      const contexts: Array<{ id: number; frameId: string }> = [];
      const onCtx = (raw: unknown): void => {
        const c = (raw as CtxEvent)?.context;
        if (c?.id && c?.auxData?.frameId) contexts.push({ id: c.id, frameId: c.auxData.frameId });
      };
      this.conn.on('Runtime.executionContextCreated', onCtx);
      try {
        await this.conn.send('Runtime.enable', undefined, this.sessionId).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
      } finally {
        this.conn.off('Runtime.executionContextCreated', onCtx);
      }
      const ctx = contexts.find((c) => c.frameId === target.id);
      if (ctx) return evalIn(this.sessionId, ctx.id);
    }

    // 路径 C：Target.setAutoAttach 监听后续 attach 的 iframe target（兜底）
    const attached: Array<{ sessionId: string; url: string }> = [];
    const onAttach = (raw: unknown): void => {
      const ev = raw as AttachEvent;
      if (ev?.sessionId && ev.targetInfo?.type === 'iframe') {
        attached.push({ sessionId: ev.sessionId, url: ev.targetInfo.url || '' });
      }
    };
    this.conn.on('Target.attachedToTarget', onAttach);
    try {
      await this.conn.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }, this.sessionId);
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      this.conn.off('Target.attachedToTarget', onAttach);
      this.conn.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, this.sessionId).catch(() => {});
    }
    const hit = attached.find((a) => a.url.includes(urlIncludes));
    if (!hit) {
      throw new Error(`frame not found for "${urlIncludes}"（OOPIF target、frame 树、auto-attach 三路均未命中；可能仍在加载）`);
    }
    return evalIn(hit.sessionId);
  }

  /** evaluateHandle — evaluates fn and returns a handle for element bounding box */
  async evaluateHandle(
    fn: string | Function,
    ...args: unknown[]
  ): Promise<{
    asElement: () => { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> } | null;
  }> {
    let expression: string;
    if (typeof fn === 'string') {
      expression = fn;
    } else {
      const argStr = args.length > 0 ? `...${JSON.stringify(args)}` : '';
      expression = `(()=>{const __fn=(${fn.toString()});const __el=__fn(${argStr});if(__el&&typeof __el.getBoundingClientRect==='function'){const r=__el.getBoundingClientRect();return JSON.parse(JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}));}return null;})()`;
    }
    const result = await this.conn.send<{
      result?: { value?: string | null };
      exceptionDetails?: unknown;
    }>('Runtime.evaluate', { expression, returnByValue: true }).catch(() => ({ result: { value: null } }));
    let box: { x: number; y: number; width: number; height: number } | null = null;
    try { box = JSON.parse(result.result?.value as string); } catch { /* ignore */ }
    return {
      asElement: () => box ? { boundingBox: async () => box } : null,
    };
  }

  async $eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    const selJSON = JSON.stringify(selector);
    const xpathPrefix = selector.startsWith('xpath=') ? JSON.stringify(selector.slice(6)) : 'null';
    return this.evaluate<R>(
      `(function(sel, xpathExpr, fnStr, ...evalArgs) {
        const el = xpathExpr
          ? document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
          : document.querySelector(sel);
        if (!el) throw new Error('No element found for selector: ' + sel);
        const fn = new Function('return ' + fnStr)();
        return fn(el, ...evalArgs);
      })(${selJSON}, ${xpathPrefix}, ${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
    );
  }

  async $$eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    const selJSON = JSON.stringify(selector);
    const xpathPrefix = selector.startsWith('xpath=') ? JSON.stringify(selector.slice(6)) : 'null';
    return this.evaluate<R>(
      `(function(sel, xpathExpr, fnStr, ...evalArgs) {
        const els = xpathExpr
          ? (() => { const it = document.evaluate(xpathExpr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const r=[]; for(let i=0;i<it.snapshotLength;i++) r.push(it.snapshotItem(i)); return r; })()
          : Array.from(document.querySelectorAll(sel));
        const fn = new Function('return ' + fnStr)();
        return fn(els, ...evalArgs);
      })(${selJSON}, ${xpathPrefix}, ${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
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
    // Map ARIA roles to native HTML tags (implicit roles)
    const ROLE_TO_TAGS: Record<string, string[]> = {
      button: ['button'],
      link: ['a[href]'],
      heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      textbox: ['input[type="text"]', 'input:not([type])', 'textarea'],
      checkbox: ['input[type="checkbox"]'],
      radio: ['input[type="radio"]'],
      searchbox: ['input[type="search"]'],
      combobox: ['select'],
      img: ['img'],
      navigation: ['nav'],
      article: ['article'],
      banner: ['header'],
      contentinfo: ['footer'],
      main: ['main'],
      complementary: ['aside'],
    };
    const tags = ROLE_TO_TAGS[role] || [];
    const tagSel = tags.length > 0 ? tags.join(',') + ',' : '';
    let sel = `${tagSel}[role="${role}"]`;
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
    // 双击必须两段式（detail 1 → detail 2）浏览器才会合成 dblclick 事件；
    // 单对 clickCount:2 派发只产生 click(detail=2)，页面 ondblclick 不触发
    const locator = this.locator(selector);
    await locator.click({ ...opts, clickCount: 1 });
    await locator.click({ ...opts, clickCount: 2 });
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
      `(function() { const el = ${queryJS(selector)}; return el?.textContent ?? null; })()`,
    );
  }

  async innerText(selector: string): Promise<string> {
    return this.evaluate<string>(
      `(function() { const el = ${queryJS(selector)}; if (!el) throw new Error('Element not found'); return el.innerText; })()`,
    );
  }

  async innerHTML(selector: string): Promise<string> {
    return this.evaluate<string>(
      `(function() { const el = ${queryJS(selector)}; if (!el) throw new Error('Element not found'); return el.innerHTML; })()`,
    );
  }

  async getAttribute(selector: string, name: string): Promise<string | null> {
    return this.evaluate<string | null>(
      `(function() { const el = ${queryJS(selector)}; return el?.getAttribute(${JSON.stringify(name)}) ?? null; })()`,
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
    return this.mediaService.screenshot(opts);
  }

  async pdf(opts: XBPdfOptions = {}): Promise<Buffer> {
    return this.mediaService.pdf(opts);
  }

  viewportSize(): { width: number; height: number } | null {
    return this._viewportSize;
  }

  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    return this.mediaService.setViewportSize(size);
  }

  async setDeviceScaleFactor(dsf: number): Promise<void> {
    return this.mediaService.setDeviceScaleFactor(dsf);
  }

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

  /** 覆盖 User-Agent（headless 环境对抗 UA 检测的标配能力） */
  async setUserAgent(userAgent: string): Promise<void> {
    await this._setUserAgent(userAgent);
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

  off(event: string, handler: (...args: unknown[]) => void): void {
    this._emitter.off(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Wait for a one-shot event (Playwright-compatible subset).
   * Used to listen for 'filechooser', 'dialog', 'popup', 'framenavigated', etc.
   */
  async waitForEvent(
    event: string,
    opts: { timeout?: number; predicate?: (...args: unknown[]) => boolean } = {}
  ): Promise<unknown> {
    const timeout = opts.timeout ?? 30000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._emitter.off(event, handler);
        reject(new Error(`waitForEvent('${event}') timeout after ${timeout}ms`));
      }, timeout);

      const handler = (...args: unknown[]) => {
        if (opts.predicate && !opts.predicate(...args)) return;
        clearTimeout(timer);
        this._emitter.off(event, handler);
        resolve(args.length === 1 ? args[0] : args);
      };
      this._emitter.on(event, handler);
    });
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

  /**
   * Discover all frames (main + iframes) via CDP Page.getFrameTree.
   * This is async because CDP doesn't maintain a frame list client-side.
   */
  async discoverFrames(): Promise<XBFrame[]> {
    try {
      const result = await this.conn.send<{
        frameTree: {
          frame: { id: string; url: string; name?: string };
          childFrames?: Array<{ frame: { id: string; url: string; name?: string } }>;
        };
      }>('Page.getFrameTree', undefined, this.sessionId);

      const frames: XBFrame[] = [];
      const collect = (node: typeof result.frameTree): void => {
        const frame: XBFrame = {
          name: () => node.frame.name || '',
          url: () => node.frame.url,
          isDetached: () => false,
          page: () => this,
          evaluate: <R>(fn: string | Function, ...args: unknown[]) => this.evaluate<R>(fn, ...args),
          $: (sel: string) => this.$(sel),
          $$: (sel: string) => this.$$(sel),
        };
        frames.push(frame);
        for (const child of node.childFrames || []) {
          collect({ frame: child.frame, childFrames: [] });
        }
      };
      collect(result.frameTree);
      return frames;
    } catch {
      return [this.mainFrame()];
    }
  }

  // ── CDP helpers exposed for locator/element ─────────────────

  async querySelector(selector: string): Promise<number> {
    return this.domQueryService.querySelector(selector);
  }

  async querySelectorAll(selector: string): Promise<number[]> {
    return this.domQueryService.querySelectorAll(selector);
  }

  async resolveNode(nodeId: number): Promise<string> {
    return this.domQueryService.resolveNode(nodeId);
  }

  async getBoxModel(nodeId: number): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.domQueryService.getBoxModel(nodeId);
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

  setBeforeUnloadBehavior(mode: 'accept' | 'dismiss'): void {
    this._beforeUnloadAccept = mode === 'accept';
  }

  /**
   * 开启/关闭原生文件选择框拦截（CDP stateful 开关）。
   *
   * - enabled=true（执行期默认）：点击上传按钮时不弹系统文件框，改发 Page.fileChooserOpened 事件，
   *   page 的 'filechooser' 监听器拿到 chooser 后用 setFiles/setInputFiles 注入文件。
   * - enabled=false（录制期默认）：真实文件选择框正常弹出，用户手动选文件；
   *   前端 input[type=file] 的 change 事件由 action signal 脚本捕获记录。
   *
   * 可多次调用切换状态（CDP 协议是 stateful 的）。
   */
  async setFileDialogInterception(enabled: boolean): Promise<void> {
    await this.conn.send('Page.setInterceptFileChooserDialog', { enabled }, this.sessionId)
      .catch((e) => console.error('[XBPage] setInterceptFileChooserDialog failed:', errMsg(e)));
  }

  /** Subscribe to a CDP event on this page's session. Returns unsubscribe function. */
  _subscribe(event: string, handler: (params: unknown) => void): () => void {
    return this.conn.subscribe(event, this.sessionId, handler);
  }

  // ── Private: Event Setup ────────────────────────────────────

  private setupPageEvents(): void {
    setupPageEvents({
      conn: this.conn,
      sessionId: this.sessionId,
      addSubscription: (unsubscribe) => this._subscriptions.push(unsubscribe),
      emit: (event, ...args) => this._emit(event, ...args),
      setUrl: (url) => { this._url = url; },
      currentUrl: () => this.url(),
      mainFrame: () => this.mainFrame(),
      markLoadFired: () => { this._loadState.loadFired = true; },
      markDomContentFired: () => { this._loadState.domContentFired = true; },
      getBeforeUnloadAccept: () => this._beforeUnloadAccept,
      setInputFiles: (selector, files) => this.setInputFiles(selector, files),
    });
  }

  private setupNetworkEvents(): void {
    setupNetworkEvents({
      conn: this.conn,
      sessionId: this.sessionId,
      state: { inflightRequests: this.inflightRequests },
      emit: (event, ...args) => this._emit(event, ...args),
      storeRequest: (id, data) => this._storeNetworkRequest(id, data),
      storeResponse: (id, data) => this._storeNetworkResponse(id, data),
      checkNetworkIdle: () => this.checkNetworkIdle(),
      addSubscription: (unsubscribe) => this._subscriptions.push(unsubscribe),
    });
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
  private _beforeUnloadAccept = true;

  /** Store network data — called by browser.ts installNetworkCapture or internal event handlers */
  _storeNetworkRequest(requestId: string, data: { url: string; method: string; headers: Record<string, string>; postData: string | null; resourceType: string }): void {
    this._networkRequests.set(requestId, { requestId, ...data });
  }

  _storeNetworkResponse(requestId: string, data: { status: number; url: string; headers: Record<string, string> }): void {
    this._networkResponses.set(requestId, { requestId, ...data });
  }

  async waitForResponse(
    urlOrPredicate: string | RegExp | ((response: XBResponse) => boolean),
    opts: { timeout?: number } = {},
  ): Promise<XBResponse> {
    return this.networkWaitService.waitForResponse(urlOrPredicate, opts);
  }

  async waitForRequest(
    urlOrPredicate: string | RegExp | ((request: XBRequest) => boolean),
    opts: { timeout?: number } = {},
  ): Promise<XBRequest> {
    return this.networkWaitService.waitForRequest(urlOrPredicate, opts);
  }

  async waitForURL(
    url: string | RegExp | ((url: string) => boolean),
    opts: { timeout?: number } = {},
  ): Promise<void> {
    return this.networkWaitService.waitForURL(url, opts);
  }

  async route(
    pattern: string,
    handler: (route: XBRoute) => Promise<void> | void,
  ): Promise<void> {
    return this.networkRouteService.route(pattern, handler);
  }

  async unroute(pattern: string): Promise<void> {
    return this.networkRouteService.unroute(pattern);
  }

  async dropFiles(selector: string, payload: XBFilePayload): Promise<void> {
    return this.fileInputService.dropFiles(selector, payload);
  }

  async setInputFiles(selector: string, files: XBFilePayload | XBFilePayload[]): Promise<void> {
    return this.fileInputService.setInputFiles(selector, files);
  }

  async dragAndDrop(source: string, target: string): Promise<void> {
    return this.fileInputService.dragAndDrop(source, target);
  }

  async setOfflineMode(offline: boolean): Promise<void> {
    await this.conn.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
    }, this.sessionId);
  }
}

