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
  evaluateInTab,
  isBridgeAvailable,
  locateByText,
  openTaskTab,
  closeTaskTab,
  trustedClick,
} from './bridge.js';

export type PublishChannel = 'bridge' | 'local';

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
    return {
      adapter: new BridgePageAdapter(bridge, tabId),
      channel: 'bridge',
      taskName: opts.taskName,
    };
  }

  if (!opts.page) {
    throw new Error(
      '没有可用通道：chrome-bridge 扩展未连接，且没有本地浏览器页面。' +
        '请先跑 `xbrowser chrome-bridge serve` 并在 Chrome 中启用扩展，或改用带 --cdp 的会话。',
    );
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
  /** 打开编辑器 */
  open(adapter: PageAdapter): Promise<void>;
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
