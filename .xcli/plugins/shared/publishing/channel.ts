/**
 * 发布通道抽象：chrome-bridge 优先，本地 page 兜底。
 *
 * 设计动机
 * ----------
 * 实战的五站发布全部走 chrome-bridge（复用用户 Chrome 登录态）。但插件
 * 不能只支持一条通道——扩展没装/没连上的用户仍需能用。
 *
 * 契约
 * ----
 * 每个站点实现 `SitePublisher`，声明它需要的「页面动作」；本模块负责
 * 决定用哪条通道执行：
 *
 * - **bridge 可用**（扩展已连接）→ 走 bridge，复用用户登录态
 * - **bridge 不可用** → 回退本地 `ctx.page`，用插件自带的登录流程
 *
 * 两条通道的差异被收敛在 `PageAdapter` 接口后面：
 *
 * | 能力 | bridge | 本地 page |
 * |---|---|---|
 * | 求值 | `Runtime.evaluate` | `page.evaluate` |
 * | 可信点击 | CDP Input 域 | `page.mouse.click` |
 * | 打开页面 | 已在 tab 里 | `page.goto` |
 * | 等待 | 轮询 | 轮询 |
 */

import type { PageLike } from '../page-types.js';
import {
  type BridgeTransport,
  type ElementPoint,
  createHttpBridge,
  checkWindowReady,
  evaluateInTab,
  isBridgeAvailable,
  locateByText,
  openTaskTab,
  closeTaskTab,
  trustedClick,
  bringToFront,
  waitForDocumentReady,
} from './bridge.js';

export type PublishChannel = 'bridge' | 'local';

/**
 * 在**同源 iframe** 内求值。
 *
 * 宿主页面用 `contentDocument` 拿到 iframe 文档，再用该文档的 `defaultView`
 * 构造一个真正的 iframe 作用域函数执行——**必须走 `Function` 构造，不能用
 * `.call(doc)`**：后者只换 `this`，`expression` 里的 `document` 仍然指向
 * 宿主页，会静默读写错误对象（实测踩坑：写入的正文进了宿主 document）。
 *
 * 跨源 iframe 的 `contentDocument` 为 `null`，此时返回 `null` 让调用方
 * 决定怎么处理（不会静默成功）。
 */
async function evaluateInIframe<T>(
  hostEvaluate: <R>(expr: string) => Promise<R>,
  iframeSelector: string,
  expression: string,
): Promise<T> {
  const wrapper = `(function(){
    var f = document.querySelector(${JSON.stringify(iframeSelector)});
    if (!f) return { err: 'iframe-not-found' };
    var d;
    try { d = f.contentDocument; } catch (e) { return { err: 'cross-origin' }; }
    if (!d) return { err: 'cross-origin' };
    var win = d.defaultView;
    if (!win) return { err: 'no-window' };
    try {
      // 在 iframe 自己的全局作用域里执行，document/window 才真的是 iframe 的
      var fn = new win.Function(${JSON.stringify(expression)});
      return { ok: fn.call(win) };
    } catch (e) {
      return { err: 'eval-failed: ' + String((e && e.message) || e).slice(0, 120) };
    }
  })()`;
  const raw = await hostEvaluate<{ err?: string; ok?: T }>(wrapper);
  if (!raw || raw.err) return null as T;
  return raw.ok as T;
}

export interface PageAdapter {
  readonly channel: PublishChannel;
  /** 在页面内求值，返回原始值 */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** 可信点击（isTrusted=true） */
  clickAt(x: number, y: number): Promise<void>;
  /** 当前 URL */
  url(): Promise<string>;
  /**
   * 按可见文本定位元素中心点。
   *
   * 命中判定放宽到 `elementsFromPoint` 栈顶为 BUTTON 的内部 SPAN——
   * 否则按钮内部的文本节点会被误判成"被遮挡"（ERR-20261022-011）。
   */
  locateByText(options: {
    text: string | RegExp;
    scope?: string;
    exact?: boolean;
    requireViewport?: boolean;
  }): Promise<ElementPoint | null>;
  /** 按可见文本定位并点击 */
  clickByText(options: {
    text: string | RegExp;
    scope?: string;
    exact?: boolean;
    requireViewport?: boolean;
  }): Promise<boolean>;
  /** 等待文档进入 ready 状态（bridge 的 task-open 是异步导航，返回时页面可能还在加载） */
  waitReady(timeout?: number): Promise<boolean>;
  /**
   * 可信键盘输入（CDP Input.insertText，isTrusted=true）。
   *
   * 强受控编辑器（wukong / ProseMirror / CKEditor）会拒收合成事件与
   * HTML 直注——只有真实键盘事件能存活。文本越长耗时越久。
   */
  insertText(text: string): Promise<void>;
  /** 点击元素中心（可信事件） */
  clickSelector(selector: string): Promise<boolean>;
  /** 把页面切到前台（后台 tab 的可信输入会被 Chrome 静默丢弃） */
  bringToFront(): Promise<void>;
  /**
   * 在**同源 iframe** 内求值（Blogger 的正文编辑器就是这种形态）。
   *
   * 用 `contentDocument` 直通——跨源 iframe 会抛错，调用方需自行判断。
   * `expression` 在 iframe 文档的作用域里执行，可访问 `document` / `window`，
   * 但**看不到宿主页面的变量**。
   */
  evaluateInIframe<T = unknown>(iframeSelector: string, expression: string): Promise<T>;
}

/** bridge 通道适配器 */
export class BridgePageAdapter implements PageAdapter {
  readonly channel: PublishChannel = 'bridge';

  constructor(
    private readonly bridge: BridgeTransport,
    private readonly tabId: number,
  ) {}

  evaluate<T = unknown>(expression: string): Promise<T> {
    return evaluateInTab<T>(this.bridge, expression, this.tabId);
  }

  async clickAt(x: number, y: number): Promise<void> {
    await trustedClick(this.bridge, this.tabId, x, y);
  }

  async url(): Promise<string> {
    const v = await this.evaluate<string>('location.href');
    return typeof v === 'string' ? v : '';
  }

  locateByText(options: Parameters<PageAdapter['locateByText']>[0]): Promise<ElementPoint | null> {
    return locateByText(this.bridge, this.tabId, options);
  }

  async clickByText(options: Parameters<PageAdapter['clickByText']>[0]): Promise<boolean> {
    const point = await this.locateByText(options);
    if (!point) return false;
    await this.clickAt(point.x, point.y);
    return true;
  }

  async waitReady(timeout = 20000): Promise<boolean> {
    return waitForDocumentReady(this.bridge, this.tabId, timeout);
  }

  async bringToFront(): Promise<void> {
    await bringToFront(this.bridge, this.tabId);
  }

  async insertText(text: string): Promise<void> {
    // 后台 tab 的可信输入会被 Chrome 静默丢弃——先切前台
    await this.bringToFront();
    // 分块：单次 insertText 太大会被截断
    const chunk = 3000;
    for (let i = 0; i < text.length; i += chunk) {
      await this.bridge.call('cdp', {
        method: 'Input.insertText',
        params: { text: text.slice(i, i + chunk) },
        tabId: this.tabId,
      });
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async clickSelector(selector: string): Promise<boolean> {
    const point = await this.evaluate<string | null>(`(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
    })()`);
    if (!point) return false;
    const p = JSON.parse(point) as { x: number; y: number };
    await this.clickAt(p.x, p.y);
    return true;
  }

  evaluateInIframe<T = unknown>(iframeSelector: string, expression: string): Promise<T> {
    return evaluateInIframe<T>(this.evaluate.bind(this), iframeSelector, expression);
  }
}

/** 本地 page 通道适配器 */
export class LocalPageAdapter implements PageAdapter {
  readonly channel: PublishChannel = 'local';

  constructor(private readonly page: PageLike) {}

  async evaluate<T = unknown>(expression: string): Promise<T> {
    return this.page.evaluate<T>(expression);
  }

  async clickAt(x: number, y: number): Promise<void> {
    const mouse = (this.page as unknown as { mouse?: { click(x: number, y: number): Promise<void> } }).mouse;
    if (mouse?.click) {
      await mouse.click(x, y);
      return;
    }
    // 没有 mouse 时退化为坐标派发（page.evaluate 合成事件会被 CDP Guard 拦）
    await this.page.evaluate(
      `(() => { const el = document.elementFromPoint(${x}, ${y}); if (el) el.click(); })()`,
    );
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async locateByText(options: Parameters<PageAdapter['locateByText']>[0]): Promise<ElementPoint | null> {
    const { text, scope = 'body', exact = false, requireViewport = true } = options;
    const isReg = text instanceof RegExp;
    // pattern 必须内联进页面表达式——页面作用域里没有这个变量
    const literal = isReg ? text.source : JSON.stringify(text);
    const expression = `(function(){
      var scopeEl = document.querySelector(${JSON.stringify(scope)}) || document.body;
      var pattern = ${literal};
      var re = ${isReg ? `new RegExp(pattern)` : 'null'};
      var candidates = scopeEl.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit], label, .ant-radio-wrapper, .ant-checkbox-wrapper');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var raw = (el.textContent || el.value || '').replace(/\\s+/g, ' ').trim();
        if (!raw || raw.length > 24) continue;
        var hit = ${isReg ? 're.test(raw)' : (exact ? 'raw === pattern' : 'raw.indexOf(pattern) >= 0')};
        if (!hit) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (${requireViewport ? 'true' : 'false'} && (rect.top < 0 || rect.top > window.innerHeight)) continue;
        var x = Math.round(rect.x + rect.width / 2);
        var y = Math.round(rect.y + rect.height / 2);
        var top = document.elementsFromPoint(x, y)[0];
        var topTag = top ? top.tagName : '';
        if (!(el.contains(top) || top === el || topTag === 'BUTTON' || topTag === 'A')) continue;
        return JSON.stringify({ x: x, y: y, text: raw, tag: el.tagName, inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight });
      }
      return null;
    })()`;
    const raw = await this.evaluate<string | null>(expression);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ElementPoint;
    } catch {
      return null;
    }
  }

  async clickByText(options: Parameters<PageAdapter['clickByText']>[0]): Promise<boolean> {
    const point = await this.locateByText(options);
    if (!point) return false;
    await this.clickAt(point.x, point.y);
    return true;
  }

  async waitReady(timeout = 20000): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const ready = await this.page
        .evaluate<string>('document.readyState')
        .catch(() => undefined);
      // 必须等 'complete'——'interactive' 时 DOM 已可读但仍在解析，
      // 后续的编辑器初始化会重渲染，把刚注入的内容清掉。
      if (ready === 'complete') return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  async bringToFront(): Promise<void> {
    const page = this.page as unknown as { bringToFront?: () => Promise<void> };
    await page.bringToFront?.();
  }

  async insertText(text: string): Promise<void> {
    await this.bringToFront();
    const keyboard = this.page.keyboard;
    if (keyboard?.insertText) {
      const chunk = 3000;
      for (let i = 0; i < text.length; i += chunk) {
        await keyboard.insertText(text.slice(i, i + chunk));
        await this.page.waitForTimeout(300);
      }
      return;
    }
    // 无 keyboard.insertText 时退化为 DOM 写入（仅对弱编辑器有效）
    await this.page.evaluate(
      `(function(){ var ta = document.querySelector('[contenteditable=true]');` +
      ` if (ta) { ta.focus(); ta.textContent = ${JSON.stringify(text)};` +
      ` ta.dispatchEvent(new Event('input', { bubbles: true })); } })()`,
    );
  }

  async clickSelector(selector: string): Promise<boolean> {
    const point = await this.evaluate<string | null>(`(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
    })()`);
    if (!point) return false;
    const p = JSON.parse(point) as { x: number; y: number };
    await this.clickAt(p.x, p.y);
    return true;
  }

  evaluateInIframe<T = unknown>(iframeSelector: string, expression: string): Promise<T> {
    return evaluateInIframe<T>(this.evaluate.bind(this), iframeSelector, expression);
  }
}

/** 通道解析结果 */
export interface ChannelResolution {
  adapter: PageAdapter;
  channel: PublishChannel;
  /** bridge 模式下需要清理的任务分组名 */
  taskName?: string;
}

/**
 * 解析发布通道。
 *
 * @param opts.taskName bridge 模式下的任务分组名（用于清理）
 * @param opts.localUrl 本地模式要导航到的 URL
 */
export async function resolveChannel(opts: {
  page?: PageLike;
  taskName: string;
  localUrl: string;
  bridgePort?: number;
  preferBridge?: boolean;
}): Promise<ChannelResolution> {
  const port = opts.bridgePort ?? 9347;
  const preferBridge = opts.preferBridge !== false;

  if (preferBridge && (await isBridgeAvailable(port))) {
    const bridge = createHttpBridge(port);
    const tabId = await openTaskTab(bridge, opts.taskName, opts.localUrl);
    // 无可见窗口时 CDP 坐标点击静默失效——提前失败，别让调用方以为「点了没反应」
    const win = await checkWindowReady(bridge, tabId);
    if (!win.ok) {
      await closeTaskTab(bridge, opts.taskName).catch(() => undefined);
      throw new Error(`chrome-bridge：${win.reason ?? '窗口不可用'}`);
    }
    return {
      adapter: new BridgePageAdapter(bridge, tabId),
      channel: 'bridge',
      taskName: opts.taskName,
    };
  }

  if (!opts.page) {
    // 与仓库其他插件保持一致：无 page 时统一抛「需要浏览器页面」
    throw new Error('需要浏览器页面');
  }
  await opts.page.goto(opts.localUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => undefined);
  return {
    adapter: new LocalPageAdapter(opts.page),
    channel: 'local',
  };
}

/** 清理通道资源（bridge 模式关闭任务分组） */
export async function releaseChannel(resolution: ChannelResolution): Promise<void> {
  if (resolution.channel !== 'bridge' || !resolution.taskName) return;
  const bridge = createHttpBridge();
  await closeTaskTab(bridge, resolution.taskName);
}

/**
 * 发布站点协议：声明各站点差异，通道差异由 PageAdapter 吸收。
 */
export interface SitePublisher {
  /** 站点标识（任务分组名用） */
  readonly site: string;
  /** 打开编辑器（options 承载站点特定的额外参数，如 OSChina 的 uid） */
  open(adapter: PageAdapter, options?: Record<string, unknown>): Promise<void>;
  /** 填标题 */
  setTitle(adapter: PageAdapter, title: string): Promise<void>;
  /** 填正文 */
  setBody(adapter: PageAdapter, markdown: string): Promise<void>;
  /** 提交发布（返回发布结果描述） */
  publish(adapter: PageAdapter, options?: Record<string, unknown>): Promise<{ published: boolean; url?: string; note?: string }>;
}

/** 读取本地 markdown 文件 */
export async function readMarkdownFile(file: string): Promise<string> {
  const fsp = await import('node:fs/promises');
  return fsp.readFile(file, 'utf-8');
}
