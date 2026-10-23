/**
 * FrameInputService — OOPIF 输入（mouse/click/fill --frame 的驱动层实现）
 *
 * 跨域 iframe（验证码/支付窗）跑在独立渲染进程：主页面 session 上派发的
 * Input 事件进不去，必须 attach 到 iframe 自己的 CDP target session 派发
 * （qqmail 验证码 4 次页面级拖动全败、frame session 拖动一次过的实证）。
 * 坐标语义：iframe 局部坐标系（与该 session 内 getBoundingClientRect 一致）。
 */

import type { CDPConnection } from './connection.js';
import type { XBMouse, XBKeyboard } from './types.js';
import { XBMouseImpl } from './mouse.js';
import { errMsg } from '../utils/error.js';

interface FrameInputDeps {
  conn: CDPConnection;
  /** 输入专用 frame session 解析（Target attach 两路，必须拿到真 target session） */
  resolveFrameSession(urlIncludes: string): Promise<string>;
  /** iframe 上下文求值（读写 frame 内 DOM） */
  evaluateInFrame<R = unknown>(urlIncludes: string, expression: string): Promise<R>;
  /** 主页面上下文求值（同进程 iframe 的祖先偏移查询用） */
  evaluateMain<R = unknown>(expression: string): Promise<R>;
  /** 主页面鼠标（同进程 iframe 的输入派发通道——Input 事件按 hit-test 落进同进程 iframe） */
  pageMouse: XBMouse;
  /** 主页面键盘（同进程 iframe 填写用——逐键 dispatchKeyEvent，焦点已由点击落在目标元素） */
  pageKeyboard: XBKeyboard;
  /** 完整 frame 树（含嵌套——同进程 iframe 祖先链构造用） */
  frameTreeNodes(): Promise<FrameNode>;
}

/** getFrameTree 节点（递归） */
type FrameNode = { frame: { id: string; url: string }; childFrames?: FrameNode[] };

/** 同进程 iframe 错误识别（resolveFrameSession 对无独立 target 的帧抛出） */
function isSameProcessError(err: unknown): boolean {
  return /同进程/.test(String(err));
}

/** CDP 层 session 失效（OOPIF 被 Chrome 异步销毁/验证码 iframe 重建） */
function isSessionDeadError(err: unknown): boolean {
  return /session (with given id )?not found|no session with given id/i.test(errMsg(err));
}

export class FrameInputService {
  /** urlIncludes → 已 attach 的 session + 鼠标实例（跨命令保持位置状态） */
  private readonly cache = new Map<string, { sessionId: string; mouse: XBMouseImpl }>();

  constructor(private readonly deps: FrameInputDeps) {}

  /**
   * 拿到指定 OOPIF 的鼠标（Input 域派发进 iframe 渲染进程，isTrusted=true）。
   * 缓存的 session 失效（iframe 重建/刷新）时自动重 attach；重 attach 会
   * 重置鼠标位置——调用方需重新读取目标元素坐标。
   */
  async frameMouse(urlIncludes: string, opts: { fresh?: boolean } = {}): Promise<XBMouse> {
    if (opts.fresh) this.cache.delete(urlIncludes);
    const cached = this.cache.get(urlIncludes);
    if (cached) {
      try {
        await this.deps.conn.send('Runtime.evaluate', { expression: '1', returnByValue: true }, cached.sessionId);
        return cached.mouse;
      } catch {
        this.cache.delete(urlIncludes); // session 已死（iframe 重建），重解析
      }
    }
    const sessionId = await this.deps.resolveFrameSession(urlIncludes);
    const mouse = new XBMouseImpl(this.deps.conn, sessionId);
    this.cache.set(urlIncludes, { sessionId, mouse });
    return mouse;
  }

  /**
   * 带重试的 frame 鼠标操作：Chrome 异步销毁旧 OOPIF target 的窗口期里
   * （连续导航/验证码 iframe 重建），probe 通过后 dispatch 仍可能撞上死
   * session——session 失效时强制重 attach 再做一次。
   */
  async runFrameMouse<T>(
    urlIncludes: string,
    fn: (mouse: XBMouse) => Promise<T>,
  ): Promise<T> {
    try {
      return await fn(await this.frameMouse(urlIncludes));
    } catch (err) {
      if (!isSessionDeadError(err)) throw err;
      this.cache.delete(urlIncludes);
      return fn(await this.frameMouse(urlIncludes, { fresh: true }));
    }
  }

  /** 在 OOPIF 内点击选择器命中的元素（frame 局部坐标，stealth 落点偏移继承） */
  async clickInFrame(
    urlIncludes: string,
    selector: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ x: number; y: number }> {
    try {
      const rect = await this.pollFrameRect(urlIncludes, selector, opts.timeoutMs ?? 5000);
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      await this.runFrameMouse(urlIncludes, (mouse) => mouse.click(x, y, { elementWidth: rect.width, elementHeight: rect.height }));
      return { x, y };
    } catch (err) {
      if (!isSameProcessError(err)) throw err;
      return this.clickInSameProcessFrame(urlIncludes, selector, opts);
    }
  }

  /**
   * 同进程跨源 iframe 点击（站点隔离按 eTLD+1 分组——qq.com 子域 iframe 同进程
   * 但跨源，DOM 进不去、也没有独立 target；输入派发到主 session，Input 事件按
   * hit-test 落进 iframe，isTrusted=true）。坐标 = 祖先 iframe 偏移累加 + 局部 rect。
   */
  private async clickInSameProcessFrame(
    urlIncludes: string,
    selector: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ x: number; y: number }> {
    this.cache.delete(urlIncludes); // iframe 若从 OOPIF 变同进程，旧 session 缓存作废（防输入误路由）
    const { ox, oy } = await this.resolveFrameViewportOffset(urlIncludes);
    const rect = await this.pollFrameRect(urlIncludes, selector, opts.timeoutMs ?? 5000);
    const x = ox + rect.x + rect.width / 2;
    const y = oy + rect.y + rect.height / 2;
    await this.deps.pageMouse.click(x, y, { elementWidth: rect.width, elementHeight: rect.height });
    return { x, y };
  }

  /**
   * 目标帧在主页面视口中的偏移：沿 getFrameTree 祖先链逐帧查询
   * 「src 匹配子帧 URL 的 iframe 元素」的视口 rect 并累加（嵌套帧每层一次求值）。
   */
  private async resolveFrameViewportOffset(urlIncludes: string): Promise<{ ox: number; oy: number }> {
    const nodes = await this.deps.frameTreeNodes();
    const norm = (u: string): string => (u || '').replace(/\/+$/, '');
    const findPath = (node: FrameNode, path: FrameNode[]): FrameNode[] | null => {
      const next = [...path, node];
      if (norm(node.frame.url).includes(norm(urlIncludes))) return next;
      for (const child of node.childFrames ?? []) {
        const hit = findPath(child, next);
        if (hit) return hit;
      }
      return null;
    };
    const path = findPath(nodes, []);
    if (!path || path.length < 2) throw new Error(`no ancestor chain for frame "${urlIncludes}"`);

    let ox = 0;
    let oy = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const parent = path[i];
      const child = path[i + 1];
      const isRoot = i === 0;
      // URL 匹配三级：完整包含 → 去参数包含 → origin 相等（子帧 URL 常是
      // 重定向后的路径，与 DOM src 的 path 不同——graph.qq.com authorize→show 实测）
      const expr = `(function(){var u=${JSON.stringify(child.frame.url)};var hit=null;var ou='';try{ou=new URL(u).origin;}catch(e){}` +
        "[...document.querySelectorAll('iframe')].forEach(function(f){if(hit)return;var s=f.src||'';if(!s)return;" +
        "var os='';try{os=new URL(s).origin;}catch(e){}" +
        "if(s.indexOf(u)>=0||u.indexOf(s)>=0||(ou&&os&&ou===os))hit=f;});" +
        'if(!hit)return null;var r=hit.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y});})()';
      const raw = isRoot
        ? await this.deps.evaluateMain<string | null>(expr)
        : await this.deps.evaluateInFrame<string | null>(parent.frame.url, expr);
      if (!raw) throw new Error(`ancestor frame offset not found for "${child.frame.url.slice(0, 60)}"`);
      const off = JSON.parse(String(raw)) as { x: number; y: number };
      ox += off.x;
      oy += off.y;
    }
    return { ox, oy };
  }

  /** 在 OOPIF 内填输入框：点击聚焦 → el.select() 全选 → insertText 整体替换 → 回读验证 */
  async fillInFrame(
    urlIncludes: string,
    selector: string,
    text: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ value: string }> {
    try {
      return await this.fillInFrameInner(urlIncludes, selector, text, opts);
    } catch (err) {
      if (isSameProcessError(err)) return this.fillInSameProcessFrame(urlIncludes, selector, text, opts);
      if (!isSessionDeadError(err)) throw err;
      this.cache.delete(urlIncludes);
      return this.fillInFrameInner(urlIncludes, selector, text, opts);
    }
  }

  /** 同进程跨源 iframe 填写：主 session 点击聚焦 + insertText + frame 内回读 */
  private async fillInSameProcessFrame(
    urlIncludes: string,
    selector: string,
    text: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ value: string }> {
    const { ox, oy } = await this.resolveFrameViewportOffset(urlIncludes);
    const rect = await this.pollFrameRect(urlIncludes, selector, opts.timeoutMs ?? 5000);
    const x = ox + rect.x + rect.width / 2;
    const y = oy + rect.y + rect.height / 2;
    await this.deps.pageMouse.click(x, y, { elementWidth: rect.width, elementHeight: rect.height });
    await this.deps.evaluateInFrame(
      urlIncludes,
      `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(el&&typeof el.select==='function')el.select();return true;})()`,
    );
    // 逐键 trusted 输入（焦点已由点击落在目标元素）。不用 Input.insertText：
    // 实测主 session 上该方法报 "wasn't found"（frame session 可用，主通道不可用）
    await this.deps.pageKeyboard.type(text, { delay: 18 });
    const readback = await this.deps.evaluateInFrame<string>(
      urlIncludes,
      `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el?String(el.value??''):'';})()`,
    );
    return { value: readback ?? '' };
  }

  private async fillInFrameInner(
    urlIncludes: string,
    selector: string,
    text: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ value: string }> {
    await this.clickInFrame(urlIncludes, selector, opts);
    // OOPIF：insertText 发到 frame session；同进程 iframe（clickInFrame 走了
    // 主 session fallback，无 frame session 缓存）：insertText 发到主 session
    //（焦点已在目标元素上，Input 事件按焦点路由）
    const cached = this.cache.get(urlIncludes);
    // 原生 select() 全选（方法调用，非合成事件）→ insertText 替换选区，
    // 与 page.fill 的"先清空再输入"语义对齐（cleared=true）。
    // 不用 triple-click：CDP clickCount 序列无法合成 1→2→3，选不中。
    await this.deps.evaluateInFrame(
      urlIncludes,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el && typeof el.select === 'function') el.select(); return true; })()`,
    );
    // 输入路由：OOPIF（有 frame session）走 insertText；同进程 iframe
    //（clickInFrame 已走主 session fallback、无 frame session）走主键盘逐键
    if (cached) {
      await this.deps.conn.send('Input.insertText', { text }, cached.sessionId);
    } else {
      await this.deps.pageKeyboard.type(text, { delay: 18 });
    }
    const readback = await this.deps.evaluateInFrame<string>(
      urlIncludes,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? String(el.value ?? '') : ''; })()`,
    );
    return { value: readback ?? '' };
  }

  /** 轮询 OOPIF 内元素 rect（等待元素出现/可测量） */
  private async pollFrameRect(
    urlIncludes: string,
    selector: string,
    timeoutMs: number,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const expr = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`;
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const rect = await this.deps.evaluateInFrame<{ x: number; y: number; width: number; height: number } | null>(urlIncludes, expr);
        if (rect) return rect;
      } catch (err) {
        lastErr = err; // frame 还在加载/执行上下文未就绪，继续轮询
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`[frame ${urlIncludes}] element "${selector}" not found/visible within ${timeoutMs}ms${lastErr instanceof Error ? `（last: ${lastErr.message}）` : ''}`);
  }
}
