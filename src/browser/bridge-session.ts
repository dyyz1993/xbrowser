/**
 * bridge-backed session —— `--session` 统一路由的 chrome-bridge 通道实现。
 *
 * 目标（用户定调 2026-11-18）：`xbrowser <命令> --session foo --bridge`（首次）
 * 或 meta kind=bridge（后续粘性识别）把会话路由到用户浏览器的 bridge 通道：
 *  - 首次：task-open foo 建任务组拿 tabId，落盘 meta
 *  - 命令：BridgePage 把 XBPage 接口调用翻译成 bridge /exec HTTP 命令
 *    （navigate/evaluate/fill/type/trustedClick/screenshot 等扩展侧 executor，
 *     全部 isTrusted 可信管线，天然过 CDP Guard）
 *  - close：task-close 收任务组
 *
 * v1 能力面：导航 / 求值 / 点击 / 填写 / 键入 / 截图 / 等待（轮询实现）。
 * 事件类能力（network capture、waitForEvent、filechooser）依赖 CDP 事件推送，
 * bridge 通道暂无事件上行——显式抛 NotImplemented，不静默撒谎。
 */
import type {
  XBClickOptions,
  XBContext,
  XBContextOptions,
  XBCookie,
  XBCDPSession,
  XBElementHandle,
  XBFillOptions,
  XBFrame,
  XBKeyboard,
  XBLocator,
  XBMouse,
  XBPage,
  XBPdfOptions,
  XBNavigationResponse,
  XBBrowser,
  XBRequest,
  XBResponse,
  XBRoute,
  XBScreenshotOptions,
  XBFilePayload,
  WaitUntilState,
} from '../cdp-driver/types.js';
import { deleteSessionDiskMeta, newSessionId, readSessionDiskMeta, saveSessionDiskMeta, sessions } from './state.js';
import type { ManagedSession } from './state.js';
import { registerSession } from './lifecycle.js';

const DEFAULT_BRIDGE_HTTP = 'http://127.0.0.1:9347';

/**
 * HTTP base of the chrome-bridge channel for this process. `XBROWSER_BRIDGE_HTTP`
 * is the one isolation switch for everything that talks to a bridge: the driver,
 * the daemon, the console panel and (through `.xcli/plugins/shared/bridge-endpoint.ts`)
 * the plugins.
 */
export function bridgeHttpBase(): string {
  return process.env.XBROWSER_BRIDGE_HTTP || DEFAULT_BRIDGE_HTTP;
}

interface BridgeReply {
  ok?: boolean;
  data?: unknown;
  error?: string;
}

/** bridge /exec 命令；网络级失败统一带 closed 字样（executor 探活据此重建会话） */
async function bridgeExec(cmd: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  let resp: Response;
  try {
    resp = await fetch(`${bridgeHttpBase()}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, args }),
    });
  } catch (e) {
    throw new Error(`[bridge-session] bridge 通道不可达（会话视为 closed）: ${e instanceof Error ? e.message : String(e)}`);
  }
  const reply = await resp.json().catch(() => null) as BridgeReply | null;
  if (!reply) throw new Error('[bridge-session] bridge 响应非 JSON（会话视为 closed）');
  if (reply.ok !== true) throw new Error(`[bridge-session] ${cmd} 失败: ${reply.error ?? 'unknown'}`);
  return (reply.data ?? {}) as Record<string, unknown>;
}

function unimplemented(op: string): never {
  throw new Error(`[bridge-session] 未支持「${op}」——bridge 会话 v1 能力面：导航/求值/点击/填写/键入/截图/轮询等待；事件类能力（网络捕获、waitForEvent 等）需要 CDP 事件上行，暂未开放`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function pollUntil(pred: () => Promise<boolean>, timeoutMs: number, intervalMs = 120): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await sleep(intervalMs);
  }
  return await pred();
}

/** Function 形参 → 页内表达式（executor 探活 `() => true` 等路径） */
function toExpression(fn: string | Function, args: unknown[]): string {
  if (typeof fn === 'string') return fn;
  const callArgs = args.map((a) => JSON.stringify(a ?? null)).join(', ');
  return `(${fn.toString()})(${callArgs})`;
}

interface Rect { x: number; y: number; width: number; height: number }

// ── 页内辅助表达式（全部经 evaluate 执行，selector JSON 内嵌防注入） ──

function rectExpression(selector: string, index: number): string {
  return `(() => { const els = document.querySelectorAll(${JSON.stringify(selector)});`
    + ` const el = els[${index}]; if (!el) return null; const r = el.getBoundingClientRect();`
    + ` return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`;
}

function stateExpression(selector: string, index: number): string {
  return `(() => { const els = document.querySelectorAll(${JSON.stringify(selector)});`
    + ` const el = els[${index}]; if (!el) return null;`
    + ` const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);`
    + ` return { found: true, visible, text: el.textContent, html: el.innerHTML,`
    + ` disabled: el.disabled === true || el.getAttribute('disabled') !== null }; })()`;
}

// ── BridgePage ─────────────────────────────────────────────────

export class BridgePage implements XBPage {
  private readonly taskName: string;
  private tabId: number;
  private _url: string;
  private closed = false;
  readonly mouse: XBMouse;
  readonly keyboard: XBKeyboard;
  private readonly ctxStub: BridgeContextStub;

  constructor(taskName: string, tabId: number) {
    this.taskName = taskName;
    this.tabId = tabId;
    this._url = 'about:blank';
    this.mouse = new BridgeMouse(this);
    this.keyboard = new BridgeKeyboard(this);
    this.ctxStub = new BridgeContextStub(this);
  }

  get bridgeTabId(): number { return this.tabId; }
  get bridgeTaskName(): string { return this.taskName; }

  /** 会话内 tab 被任务组回收后重锚（task-open 复用路径刷新 tabId） */
  retab(tabId: number): void { this.tabId = tabId; }

  async exec(cmd: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return bridgeExec(cmd, { ...args, tabId: this.tabId, task: this.taskName });
  }

  private async evalExpr<R = unknown>(expression: string): Promise<R> {
    const data = await this.exec('evaluate', { expression });
    if (data.ok !== true) throw new Error(`[bridge-session] evaluate 失败: ${String(data.error ?? 'unknown')}`);
    return (data.value ?? null) as R;
  }

  async rectOf(selector: string, index = 0): Promise<Rect | null> {
    const raw = await this.evalExpr<Rect | string | null>(rectExpression(selector, index));
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) as Rect : raw;
  }

  async stateOf(selector: string, index = 0): Promise<{ found: boolean; visible: boolean; text: string | null; html: string; disabled: boolean } | null> {
    const raw = await this.evalExpr<ReturnType<BridgePage['stateOf']> | string | null>(stateExpression(selector, index));
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async trustedClickAt(x: number, y: number): Promise<void> {
    const r = await this.exec('trustedClick', { x, y });
    if (r.ok !== true) throw new Error(`[bridge-session] trustedClick 失败: ${String(r.error ?? 'unknown')}`);
  }

  private async clickSelector(selector: string, index = 0): Promise<void> {
    await this.waitForSelector(selector, { state: 'attached', timeout: 8000 }).catch(() => {
      throw new Error(`[bridge-session] 元素未找到: ${selector}`);
    });
    const rect = await this.rectOf(selector, index);
    if (!rect) throw new Error(`[bridge-session] 元素未找到: ${selector}`);
    await this.trustedClickAt(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
  }

  // ── Navigation ──

  async goto(url: string, opts?: { waitUntil?: WaitUntilState; timeout?: number; referer?: string }): Promise<XBNavigationResponse | null> {
    await this.exec('navigate', { url });
    this._url = url;
    await this.waitForLoadState(opts?.waitUntil ?? 'load', opts?.timeout ?? 30000).catch(() => { /* 超时不阻断——返回时 url 已更新 */ });
    return {
      status: () => 200,
      ok: () => true,
      url: () => url,
      headers: () => ({}),
    };
  }

  async goBack(): Promise<void> { await this._cdpSend('Page.navigateToHistory', { entryId: -1 }); }
  async goForward(): Promise<void> { await this._cdpSend('Page.navigateToHistory', { entryId: 1 }); }
  async reload(opts?: { timeout?: number }): Promise<void> {
    await this._cdpSend('Page.reload', {});
    await this.waitForLoadState('load', opts?.timeout ?? 30000).catch(() => { /* busy 页面不阻断 */ });
  }

  async waitForLoadState(state: WaitUntilState = 'load', timeout = 30000): Promise<void> {
    const want = state === 'domcontentloaded' ? ['interactive', 'complete'] : ['complete'];
    const ok = await pollUntil(async () => {
      const rs = await this.evalExpr<string>('document.readyState').catch(() => 'loading');
      return want.includes(rs);
    }, timeout);
    if (!ok) throw new Error(`[bridge-session] waitForLoadState(${state}) 超时`);
  }

  async waitForTimeout(ms: number): Promise<void> { await sleep(ms); }

  async waitForSelector(selector: string, opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void> {
    const state = opts?.state ?? 'visible';
    const timeout = opts?.timeout ?? 30000;
    const ok = await pollUntil(async () => {
      const st = await this.stateOf(selector).catch(() => null);
      if (!st) return state === 'detached';
      if (state === 'attached') return st.found;
      if (state === 'visible') return st.found && st.visible;
      if (state === 'hidden') return !st.found || !st.visible;
      return !st.found; // detached
    }, timeout);
    if (!ok) throw new Error(`[bridge-session] waitForSelector(${selector}, ${state}) 超时`);
  }

  async waitForFunction<R>(fn: string | Function, opts?: { timeout?: number; polling?: number | 'raf' }, ...args: unknown[]): Promise<R> {
    const expression = toExpression(fn, args);
    const timeout = opts?.timeout ?? 30000;
    const interval = typeof opts?.polling === 'number' ? opts.polling : 120;
    let last: unknown = null;
    const ok = await pollUntil(async () => {
      last = await this.evalExpr<unknown>(expression).catch(() => false);
      return Boolean(last);
    }, timeout, interval);
    if (!ok) throw new Error(`[bridge-session] waitForFunction 超时（last=${JSON.stringify(last)?.slice(0, 80)}）`);
    return last as R;
  }

  async waitForURL(url: string | RegExp | ((url: string) => boolean), opts?: { timeout?: number }): Promise<void> {
    const match = (href: string): boolean => {
      if (typeof url === 'string') return href === url || href.startsWith(url);
      if (url instanceof RegExp) return url.test(href);
      return url(href);
    };
    const ok = await pollUntil(async () => {
      const href = await this.evalExpr<string>('location.href').catch(() => '');
      if (match(href)) { this._url = href; return true; }
      return false;
    }, opts?.timeout ?? 30000);
    if (!ok) throw new Error('[bridge-session] waitForURL 超时');
  }

  async waitForResponse(): Promise<XBResponse> { return unimplemented('waitForResponse（事件类）'); }
  async waitForRequest(): Promise<XBRequest> { return unimplemented('waitForRequest（事件类）'); }

  url(): string { return this._url; }

  async title(): Promise<string> { return this.evalExpr<string>('document.title'); }
  async content(): Promise<string> { return this.evalExpr<string>('document.documentElement.outerHTML'); }

  // ── Evaluation ──

  async evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R> {
    return this.evalExpr<R>(toExpression(fn, args));
  }

  async $eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const callArgs = args.map((a) => JSON.stringify(a ?? null)).join(', ');
    const expression = `(() => { const el = document.querySelector(${JSON.stringify(selector)});`
      + ` if (!el) throw new Error('no element: ${selector.replace(/'/g, "\\'")}');`
      + ` return (${typeof fn === 'string' ? fn : fn.toString()})(${callArgs.length ? 'el, ' + callArgs : 'el'}); })()`;
    return this.evalExpr<R>(expression);
  }

  async $$eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const callArgs = args.map((a) => JSON.stringify(a ?? null)).join(', ');
    const expression = `(() => { const els = document.querySelectorAll(${JSON.stringify(selector)});`
      + ` return (${typeof fn === 'string' ? fn : fn.toString()})(${callArgs.length ? 'els, ' + callArgs : 'els'}); })()`;
    return this.evalExpr<R>(expression);
  }

  // ── Locator ──

  locator(selector: string): XBLocator { return new BridgeLocator(this, selector, 0); }
  getByText(text: string, opts?: { exact?: boolean }): XBLocator {
    return new BridgeLocator(this, BridgeLocator.textQuery(text, opts?.exact ?? true), 0, true);
  }
  getByRole(role: string, opts?: { name?: string; exact?: boolean }): XBLocator {
    const name = opts?.name ? `[aria-label*=${JSON.stringify(opts.name)}]` : '';
    return new BridgeLocator(this, `[role="${role}"]${name}, ${role}${name}`, 0);
  }
  getByLabel(label: string, opts?: { exact?: boolean }): XBLocator {
    void opts;
    return new BridgeLocator(this, `label[for], [aria-label*=${JSON.stringify(label)}]`, 0);
  }
  getByPlaceholder(text: string): XBLocator {
    return new BridgeLocator(this, `[placeholder*=${JSON.stringify(text)}]`, 0);
  }
  getByTestId(id: string): XBLocator { return new BridgeLocator(this, `[data-testid="${id}"]`, 0); }
  getByAltText(text: string): XBLocator { return new BridgeLocator(this, `[alt*=${JSON.stringify(text)}]`, 0); }
  getByTitle(text: string): XBLocator { return new BridgeLocator(this, `[title*=${JSON.stringify(text)}]`, 0); }

  // ── Interaction shortcuts ──

  async click(selector: string, _opts?: XBClickOptions): Promise<void> { await this.clickSelector(selector); }
  async dblclick(selector: string, _opts?: XBClickOptions): Promise<void> {
    const rect = await this.rectOf(selector);
    if (!rect) throw new Error(`[bridge-session] 元素未找到: ${selector}`);
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    await this.trustedClickAt(x, y);
    await sleep(60);
    await this.trustedClickAt(x, y);
  }

  async fill(selector: string, value: string, _opts?: XBFillOptions): Promise<void> {
    const direct = await this.exec('fill', { selector, value });
    if (direct.ok === true) return;
    // 清空（value 为 ''）不走键盘流：键盘流要求页面可见，后台任务 tab 不满足，
    // 回退只会把「清空」变成整条 fill 失败。改用页面脚本清空。
    if (value === '') {
      const cleared = await this.evalExpr<boolean>(`(function(){
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        if (el.isContentEditable) { el.textContent = ''; }
        else {
          var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (cleared !== true) throw new Error(`[bridge-session] fill 失败: ${String(direct.error ?? 'element not found')}`);
      return;
    }
    // 受控编辑器被拒（input-not-retained / upgrade 提示）→ 升级键盘流
    const typed = await this.exec('type', { selector, text: value });
    if (typed.ok !== true) throw new Error(`[bridge-session] fill 失败: ${String(direct.error ?? typed.error ?? 'unknown')}`);
  }

  async press(selector: string, key: string, _opts?: { timeout?: number }): Promise<void> {
    await this.clickSelector(selector);
    await this.keyboard.press(key);
  }

  async hover(selector: string, _opts?: { timeout?: number; force?: boolean }): Promise<void> {
    const rect = await this.rectOf(selector);
    if (!rect) throw new Error(`[bridge-session] 元素未找到: ${selector}`);
    await this.mouse.move(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
  }

  async type(selector: string, text: string, _opts?: { delay?: number; timeout?: number }): Promise<void> {
    const r = await this.exec('type', { selector, text });
    if (r.ok !== true) throw new Error(`[bridge-session] type 失败: ${String(r.error ?? 'unknown')}`);
  }

  async check(selector: string, _opts?: { timeout?: number }): Promise<void> {
    const st = await this.stateOf(selector);
    if (st && !(await this.evalExpr<boolean>(`document.querySelector(${JSON.stringify(selector)}).checked`))) {
      await this.clickSelector(selector);
    }
  }

  async uncheck(selector: string, _opts?: { timeout?: number }): Promise<void> {
    const checked = await this.evalExpr<boolean>(`document.querySelector(${JSON.stringify(selector)})?.checked === true`);
    if (checked) await this.clickSelector(selector);
  }

  async selectOption(selector: string, value: string | string[] | { label?: string; value?: string; index?: number }): Promise<string[]> {
    const v = Array.isArray(value) ? value : [value];
    const result = await this.evalExpr<string[]>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return [];`
      + ` const vals = ${JSON.stringify(v)}; let applied = [];`
      + ` for (const opt of el.options) { if (vals.includes(opt.value) || vals.includes(opt.text)) { opt.selected = true; applied.push(opt.value); } }`
      + ` el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return applied; })()`,
    );
    return result ?? [];
  }

  // ── Convenience selectors ──

  async textContent(selector: string): Promise<string | null> {
    const st = await this.stateOf(selector);
    return st?.text ?? null;
  }
  async innerText(selector: string): Promise<string> {
    return this.evalExpr<string>(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`);
  }
  async innerHTML(selector: string): Promise<string> {
    return this.evalExpr<string>(`document.querySelector(${JSON.stringify(selector)})?.innerHTML ?? ''`);
  }
  async getAttribute(selector: string, name: string): Promise<string | null> {
    return this.evalExpr<string | null>(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`);
  }

  // ── Query ──

  async $(selector: string): Promise<XBElementHandle | null> {
    const st = await this.stateOf(selector);
    return st ? new BridgeElementHandle(this, selector, 0) : null;
  }
  async $$(selector: string): Promise<XBElementHandle[]> {
    const count = await this.evalExpr<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    return Array.from({ length: count }, (_, i) => new BridgeElementHandle(this, selector, i));
  }

  // ── Screen ──

  async screenshot(_opts?: XBScreenshotOptions): Promise<Buffer> {
    const r = await this.exec('screenshot', {});
    const b64 = (r as { base64?: string }).base64;
    if (!b64) throw new Error(`[bridge-session] screenshot 失败: ${String(r.error ?? 'no base64')}`);
    return Buffer.from(b64, 'base64');
  }
  async pdf(_opts?: XBPdfOptions): Promise<Buffer> { return unimplemented('pdf'); }
  viewportSize(): { width: number; height: number } | null { return null; }
  async setViewportSize(_size: { width: number; height: number }): Promise<void> { unimplemented('setViewportSize'); }
  async setDeviceScaleFactor(_dsf: number): Promise<void> { unimplemented('setDeviceScaleFactor'); }

  // ── Scripts / UA / Frames / OOPIF ──
  async addInitScript(_script: string): Promise<void> { unimplemented('addInitScript'); }
  async setUserAgent(_ua: string): Promise<void> { unimplemented('setUserAgent'); }
  async discoverFrames(): Promise<never[]> { return []; }
  async evaluateInFrame<R = unknown>(_urlIncludes: string, _expression: string): Promise<R> { return unimplemented('evaluateInFrame'); }
  async listFrameTargets(): Promise<Array<{ url: string; targetId: string }>> { return []; }
  async frameMouse(_urlIncludes: string, _opts?: { fresh?: boolean }): Promise<XBMouse> { return unimplemented('frameMouse'); }
  async runFrameMouse<T>(_urlIncludes: string, _fn: (mouse: XBMouse) => Promise<T>): Promise<T> { return unimplemented('runFrameMouse'); }
  async clickInFrame(_urlIncludes: string, _selector: string, _opts?: { timeoutMs?: number }): Promise<{ x: number; y: number }> { return unimplemented('clickInFrame'); }
  async fillInFrame(_urlIncludes: string, _selector: string, _text: string, _opts?: { timeoutMs?: number }): Promise<{ value: string }> { return unimplemented('fillInFrame'); }

  // ── Page management ──
  async bringToFront(): Promise<void> { await this._cdpSend('Page.bringToFront', {}); }
  async setExtraHTTPHeaders(_headers: Record<string, string>): Promise<void> { unimplemented('setExtraHTTPHeaders'); }
  async setOfflineMode(_offline: boolean): Promise<void> { unimplemented('setOfflineMode'); }
  async route(_url: string | RegExp, _handler: (route: XBRoute) => Promise<void> | void): Promise<void> { unimplemented('route'); }
  async unroute(_url: string | RegExp, _handler?: (route: XBRoute) => Promise<void> | void): Promise<void> { unimplemented('unroute'); }
  async setInputFiles(_selector: string, _files: XBFilePayload | XBFilePayload[]): Promise<void> { unimplemented('setInputFiles'); }
  async dropFiles(_selector: string, _payload: XBFilePayload): Promise<void> { unimplemented('dropFiles'); }
  setBeforeUnloadBehavior(_mode: 'accept' | 'dismiss'): void { /* bridge 扩展侧已自动 accept */ }
  async dragAndDrop(_source: string, _target: string): Promise<void> { unimplemented('dragAndDrop'); }

  // ── Dialog / events ──
  on(_event: string, _handler: Function): void { /* bridge 无事件上行；监听注册为无害 no-op */ }
  off(_event: string, _handler: Function): void { /* 同上 */ }
  async waitForEvent(_event: string, opts?: { timeout?: number }): Promise<never> {
    await sleep(opts?.timeout ?? 30000);
    return unimplemented(`waitForEvent(${_event})——事件类能力`);
  }

  // ── CDP escape hatch ──
  async _cdpSend<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const r = await this.exec('cdp', { method, params: params ?? {} });
    if (r.ok !== true) throw new Error(`[bridge-session] cdp ${method} 失败: ${String(r.error ?? 'unknown')}`);
    return (r.data ?? null) as T;
  }
  _subscribe(_event: string, _handler: (params: unknown) => void): () => void { return () => { /* no events */ }; }

  // ── Lifecycle ──
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await bridgeExec('task-close', { name: this.taskName }).catch(() => { /* 组可能已被回收 */ });
  }
  isClosed(): boolean { return this.closed; }
  context(): XBContext { return this.ctxStub; }
  browser(): XBBrowser { return this.ctxStub.browser(); }
  mainFrame(): XBFrame { return new BridgeFrame(this); }
  frames(): XBFrame[] { return [this.mainFrame()]; }
}

// ── Locator / ElementHandle（CSS 选择器 + 序号定位，rect→trustedClick 可信管线） ──

class BridgeLocator implements XBLocator {
  constructor(
    private readonly page: BridgePage,
    private readonly selector: string,
    private readonly index: number,
    private readonly isText = false,
  ) {}

  /** text 伪查询编码：==精确 / ~包含（无等价 CSS，rect() 编译为 evaluate 表达式） */
  static textQuery(text: string, exact: boolean): string {
    return `${exact ? '==' : '~'}${text}`;
  }

  private async rect(): Promise<Rect | null> {
    if (!this.isText) return this.page.rectOf(this.selector, this.index);
    const m = /^(==|~)([\s\S]*)$/.exec(this.selector);
    const exact = m?.[1] === '==';
    const text = JSON.stringify(m?.[2] ?? this.selector);
    const cmp = exact ? `e.textContent.trim() === ${text}` : `e.textContent.includes(${text})`;
    const expression = `(() => { const cand = [...document.querySelectorAll('a,button,[role=button],input,select,textarea,label,h1,h2,h3,p,span,div,li')];`
      + ` const el = cand.filter(e => ${cmp})[${this.index}];`
      + ` if (!el) return null; const b = el.getBoundingClientRect();`
      + ` return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`;
    const r = await this.page.evaluate(expression);
    const v = r as Rect | string | null;
    return v == null ? null : typeof v === 'string' ? JSON.parse(v) : v;
  }

  async click(_opts?: XBClickOptions): Promise<void> {
    const rect = await this.rect();
    if (!rect) throw new Error(`[bridge-session] locator 未命中: ${this.selector}`);
    await this.page.trustedClickAt(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
  }
  async fill(value: string, _opts?: XBFillOptions): Promise<void> {
    if (!this.isText) { await this.page.fill(this.selector, value); return; }
    await this.click();
    await this.page.keyboard.type(value);
  }
  async press(key: string, _opts?: { timeout?: number }): Promise<void> { await this.page.keyboard.press(key); }
  async pressSequentially(text: string, opts?: { delay?: number; timeout?: number }): Promise<void> { await this.page.keyboard.type(text, opts); }
  async hover(_opts?: { timeout?: number; force?: boolean }): Promise<void> {
    const rect = await this.rect();
    if (rect) await this.page.mouse.move(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
  }
  async type(text: string, _opts?: { delay?: number; timeout?: number }): Promise<void> { await this.page.keyboard.type(text); }
  async check(_opts?: { timeout?: number }): Promise<void> { await this.click(); }
  async uncheck(_opts?: { timeout?: number }): Promise<void> { await this.click(); }
  async selectOption(value: string | string[] | { label?: string; value?: string; index?: number }): Promise<string[]> {
    if (!this.isText) return this.page.selectOption(this.selector, value);
    return unimplemented('text locator selectOption');
  }
  async screenshot(opts?: XBScreenshotOptions): Promise<Buffer> { return this.page.screenshot(opts); }
  async focus(): Promise<void> {
    if (!this.isText) await this.page.evaluate(`document.querySelectorAll(${JSON.stringify(this.selector)})[${this.index}]?.focus()`);
  }
  async waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void> {
    if (!this.isText) await this.page.waitForSelector(this.selector, opts);
  }
  async count(): Promise<number> {
    if (!this.isText) return this.page.evaluate(`document.querySelectorAll(${JSON.stringify(this.selector)}).length`);
    const rect = await this.rect();
    return rect ? 1 : 0;
  }
  async isVisible(): Promise<boolean> {
    const rect = await this.rect();
    return rect !== null && rect.width + rect.height > 0;
  }
  async isHidden(): Promise<boolean> { return !(await this.isVisible()); }
  async isEnabled(): Promise<boolean> {
    const st = await this.page.stateOf(this.selector, this.index).catch(() => null);
    return st ? !st.disabled : false;
  }
  async isDisabled(): Promise<boolean> { return !(await this.isEnabled()); }
  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> { return this.rect(); }
  async textContent(): Promise<string | null> {
    const st = await this.page.stateOf(this.selector, this.index).catch(() => null);
    return st?.text ?? null;
  }
  async innerText(): Promise<string> { return (await this.textContent()) ?? ''; }
  async innerHTML(): Promise<string> {
    const st = await this.page.stateOf(this.selector, this.index).catch(() => null);
    return st?.html ?? '';
  }
  async getAttribute(name: string): Promise<string | null> {
    return this.page.evaluate(`document.querySelectorAll(${JSON.stringify(this.selector)})[${this.index}]?.getAttribute(${JSON.stringify(name)}) ?? null`);
  }
  async evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R> {
    const callArgs = args.map((a) => JSON.stringify(a ?? null)).join(', ');
    return this.page.evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(this.selector)})[${this.index}]; return el ? (${typeof fn === 'string' ? fn : fn.toString()})(${callArgs}) : null; })()`);
  }
  async ariaSnapshot(): Promise<string> { return unimplemented('ariaSnapshot'); }
  first(): XBLocator { return new BridgeLocator(this.page, this.selector, 0, this.isText); }
  last(): XBLocator { return unimplemented('locator.last()'); }
  nth(index: number): XBLocator { return new BridgeLocator(this.page, this.selector, index, this.isText); }
  filter(_opts: { visible?: boolean }): XBLocator { return unimplemented('locator.filter()'); }
  async all(): Promise<XBLocator[]> {
    const n = await this.count();
    return Array.from({ length: n }, (_, i) => new BridgeLocator(this.page, this.selector, i, this.isText));
  }
}

class BridgeElementHandle implements XBElementHandle {
  constructor(private readonly page: BridgePage, private readonly selector: string, private readonly index: number) {}
  async click(_opts?: XBClickOptions): Promise<void> {
    const rect = await this.page.rectOf(this.selector, this.index);
    if (!rect) throw new Error('[bridge-session] element 未命中');
    await this.page.trustedClickAt(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
  }
  async fill(value: string, _opts?: XBFillOptions): Promise<void> { await this.page.fill(this.selector, value); }
  async hover(): Promise<void> {
    const rect = await this.page.rectOf(this.selector, this.index);
    if (rect) await this.page.mouse.move(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
  }
  async press(key: string): Promise<void> { await this.page.keyboard.press(key); }
  async screenshot(opts?: XBScreenshotOptions): Promise<Buffer> { return this.page.screenshot(opts); }
  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> { return this.page.rectOf(this.selector, this.index); }
  async isVisible(): Promise<boolean> {
    const st = await this.page.stateOf(this.selector, this.index).catch(() => null);
    return Boolean(st?.visible);
  }
  async isEnabled(): Promise<boolean> {
    const st = await this.page.stateOf(this.selector, this.index).catch(() => null);
    return st ? !st.disabled : false;
  }
  async textContent(): Promise<string | null> {
    const st = await this.page.stateOf(this.selector, this.index).catch(() => null);
    return st?.text ?? null;
  }
  async innerText(): Promise<string> { return (await this.textContent()) ?? ''; }
  async innerHTML(): Promise<string> {
    const st = await this.page.stateOf(this.selector, this.index).catch(() => null);
    return st?.html ?? '';
  }
  async getAttribute(name: string): Promise<string | null> { return this.page.getAttribute(this.selector, name); }
  async scrollIntoViewIfNeeded(): Promise<void> {
    await this.page.evaluate(`document.querySelectorAll(${JSON.stringify(this.selector)})[${this.index}]?.scrollIntoView({ block: 'center' })`);
  }
  dispose(): void { /* 无句柄资源 */ }
}

// ── Input devices（CDP Input 域透传，isTrusted=true） ──

const KEY_CODES: Record<string, number> = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
};

class BridgeMouse implements XBMouse {
  constructor(private readonly page: BridgePage) {}
  private async dispatch(params: Record<string, unknown>): Promise<void> {
    await this.page._cdpSend('Input.dispatchMouseEvent', params);
  }
  async click(x: number, y: number, opts?: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number }): Promise<void> {
    const button = opts?.button ?? 'left';
    const clickCount = opts?.clickCount ?? 1;
    const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4;
    await this.dispatch({ type: 'mousePressed', x, y, button, buttons, clickCount });
    if (opts?.delay) await sleep(opts.delay);
    await this.dispatch({ type: 'mouseReleased', x, y, button, buttons, clickCount });
  }
  async dblclick(x: number, y: number, opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void> {
    await this.click(x, y, { ...opts, clickCount: 1 });
    await sleep(60);
    await this.click(x, y, { ...opts, clickCount: 2 });
  }
  async down(opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void> {
    const button = opts?.button ?? 'left';
    await this.dispatch({ type: 'mousePressed', x: 0, y: 0, button, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4, clickCount: 1 });
  }
  async up(opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void> {
    const button = opts?.button ?? 'left';
    await this.dispatch({ type: 'mouseReleased', x: 0, y: 0, button, buttons: 0, clickCount: 1 });
  }
  async move(x: number, y: number, opts?: { steps?: number }): Promise<void> {
    const steps = Math.max(1, opts?.steps ?? 1);
    for (let i = 1; i <= steps; i++) {
      await this.dispatch({ type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 0 });
    }
  }
  async wheel(deltaX: number, deltaY: number): Promise<void> {
    await this.dispatch({ type: 'mouseWheel', x: 0, y: 0, deltaX, deltaY });
  }
  async wheelAt(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.move(x, y);
    await this.dispatch({ type: 'mouseWheel', x, y, deltaX, deltaY });
  }
  async drag(x: number, y: number, opts?: { steps?: number }): Promise<void> {
    await this.dispatch({ type: 'mousePressed', x: 0, y: 0, button: 'left', buttons: 1, clickCount: 1 });
    const steps = Math.max(1, opts?.steps ?? 10);
    for (let i = 1; i <= steps; i++) await this.dispatch({ type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 1 });
    await this.dispatch({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
}

class BridgeKeyboard implements XBKeyboard {
  constructor(private readonly page: BridgePage) {}
  private async key(event: { type: string; key: string; code?: string; modifiers?: number; text?: string }): Promise<void> {
    await this.page._cdpSend('Input.dispatchKeyEvent', {
      type: event.type,
      key: event.key,
      code: event.code ?? event.key,
      windowsVirtualKeyCode: KEY_CODES[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase().charCodeAt(0) : 0),
      nativeVirtualKeyCode: KEY_CODES[event.key] ?? 0,
      ...(event.modifiers !== undefined ? { modifiers: event.modifiers } : {}),
      ...(event.text !== undefined ? { text: event.text } : {}),
    });
  }
  async press(key: string, _opts?: { delay?: number }): Promise<void> {
    await this.key({ type: 'keyDown', key });
    await this.key({ type: 'keyUp', key });
  }
  async pressNav(key: string): Promise<void> { await this.key({ type: 'keyDown', key }); }
  async pressCombo(key: string, modifier: 'Meta' | 'Control' | 'Alt' | 'Shift'): Promise<void> {
    const bits: Record<string, number> = { Alt: 1, Meta: 4, Control: 2, Shift: 8 };
    await this.key({ type: 'keyDown', key: modifier, modifiers: bits[modifier] });
    await this.key({ type: 'keyDown', key, modifiers: bits[modifier] });
    await this.key({ type: 'keyUp', key, modifiers: bits[modifier] });
    await this.key({ type: 'keyUp', key: modifier });
  }
  async down(key: string): Promise<void> { await this.key({ type: 'keyDown', key }); }
  async up(key: string): Promise<void> { await this.key({ type: 'keyUp', key }); }
  async type(text: string, _opts?: { delay?: number; stealth?: boolean }): Promise<void> {
    const r = await this.page.exec('trusted-type', { text });
    if (r.ok !== true) {
      // trusted-type 不可用时退化为逐字符键事件
      for (const ch of text) await this.key({ type: 'keyDown', key: ch, text: ch });
    }
  }
  async insertText(text: string): Promise<void> {
    await this.page._cdpSend('Input.insertText', { text });
  }
}

// ── Frame / Context / Browser 桩（满足 ManagedSession 结构；close 无副作用） ──

class BridgeFrame implements XBFrame {
  constructor(private readonly bridgePage: BridgePage) {}
  url(): string { return this.bridgePage.url(); }
  name(): string { return ''; }
  isDetached(): boolean { return this.bridgePage.isClosed(); }
  page(): XBPage { return this.bridgePage; }
  async evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R> { return this.bridgePage.evaluate(fn, ...args); }
  async $(selector: string): Promise<XBElementHandle | null> { return this.bridgePage.$(selector); }
  async $$(selector: string): Promise<XBElementHandle[]> { return this.bridgePage.$$(selector); }
}

class BridgeBrowserStub implements XBBrowser {
  disconnected = false;
  private readonly ctx: BridgeContextStub;
  constructor(ctx: BridgeContextStub) { this.ctx = ctx; }
  async close(): Promise<void> { /* 会话生命周期由 BridgePage.close 管理 */ }
  async disconnect(): Promise<void> { this.disconnected = true; }
  async newContext(_opts?: XBContextOptions): Promise<XBContext> { return unimplemented('browser.newContext'); }
  contexts(): XBContext[] { return [this.ctx]; }
  async discoverContexts(): Promise<void> { /* 单一用户浏览器 */ }
  on(_event: string, _handler: Function): void { /* 无事件上行 */ }
  off(_event: string, _handler: Function): void { /* 无事件上行 */ }
}

class BridgeContextStub implements XBContext {
  private readonly browserStub: BridgeBrowserStub;
  constructor(private readonly bridgePage: BridgePage) {
    this.browserStub = new BridgeBrowserStub(this);
  }
  async newPage(): Promise<XBPage> { return this.bridgePage; }
  pages(): XBPage[] { return this.bridgePage.isClosed() ? [] : [this.bridgePage]; }
  async close(): Promise<void> { await this.bridgePage.close(); }
  browser(): XBBrowser { return this.browserStub; }
  async newCDPSession(_page?: XBPage): Promise<XBCDPSession> { return unimplemented('newCDPSession'); }
  async addInitScript(_script: string): Promise<void> { unimplemented('addInitScript'); }
  async cookies(_urls?: string | string[]): Promise<XBCookie[]> { return []; }
  async addCookies(_cookies: XBCookie[]): Promise<void> { unimplemented('addCookies'); }
  async clearCookies(): Promise<void> { unimplemented('clearCookies'); }
  on(_event: string, _handler: Function): void { /* 无事件上行 */ }
  off(_event: string, _handler: Function): void { /* 无事件上行 */ }
}

// ── 会话路由 ───────────────────────────────────────────────────

interface BridgeMetaRecord {
  kind?: string;
  taskName?: string;
  id?: string;
  url?: string;
  createdAt?: string;
}

export interface BridgeMetaStore {
  read(name: string): BridgeMetaRecord | null;
  save(name: string, data: Record<string, unknown>): void;
  /** 删除落盘 meta（清掉粘性路由标记）；真实存储总是提供。 */
  delete?(name: string): void;
}

const realMetaStore: BridgeMetaStore = {
  read: (name) => readSessionDiskMeta(name),
  save: (name, data) => { saveSessionDiskMeta(name, data); },
  delete: (name) => { deleteSessionDiskMeta(name); },
};

/** 测试注入：避免单元测试写真实 ~/.xbrowser/sessions */
let metaStore: BridgeMetaStore | null = realMetaStore;

export function __setBridgeMetaStoreForTests(store: BridgeMetaStore | null): void {
  metaStore = store ?? realMetaStore;
}

/**
 * 收掉「不在内存里」的 bridge 会话——典型是 daemon 重启之后：任务组还在用户浏览器里，
 * 按 meta 里记的任务名关组，并清掉粘性路由标记（否则同名会话下次仍粘回旧 tab）。
 * 不是 bridge 会话时返回 false。
 */
export async function closeDetachedBridgeSession(name: string): Promise<boolean> {
  const store = metaStore ?? realMetaStore;
  const meta = store.read(name);
  if (meta?.kind !== 'bridge') return false;
  await bridgeExec('task-close', { name: meta.taskName ?? name }).catch(() => undefined);
  store.delete?.(name);
  return true;
}

/**
 * 解析/创建 bridge 会话。返回 null = 非 bridge 会话（走原浏览器路径）。
 * - preferBridge（--bridge 首用标记）：创建并落盘 kind=bridge
 * - meta kind=bridge（粘性）：无需 flag 自动路由
 */
export async function findOrCreateBridgeSession(
  name: string,
  opts?: { preferBridge?: boolean; url?: string },
): Promise<ManagedSession | null> {
  const store = metaStore ?? realMetaStore;
  const meta = store.read(name);
  if (meta?.kind !== 'bridge' && !opts?.preferBridge) return null;

  // 内存命中：直接复用（并发命令共享同一会话对象）
  const inMemory = sessions.find(name);
  if (inMemory?.bridge) return inMemory;

  const taskName = meta?.taskName ?? name;
  const opened = await bridgeExec('task-open', { name: taskName }).catch(() => null);
  const tabId = Number((opened as { tabId?: number } | null)?.tabId ?? 0);
  if (!opened || !tabId) {
    throw new Error('[bridge-session] task-open 失败：bridge 未启动或扩展未连接（先跑 xbrowser chrome-bridge serve / revive）');
  }

  const id = meta?.id ?? newSessionId();
  const createdAt = meta?.createdAt ?? new Date().toISOString();
  store.save(name, {
    id,
    kind: 'bridge',
    taskName,
    tabId,
    url: opts?.url ?? meta?.url ?? '',
    createdAt,
  });

  const page = new BridgePage(taskName, tabId);
  const session = registerSession({
    id,
    name,
    context: page.context(),
    page,
    browser: page.browser(),
    createdAt,
    bridge: { taskName, tabId },
  });
  return session;
}
