/**
 * FrameInputService — OOPIF 输入（mouse/click/fill --frame 的驱动层实现）
 *
 * 跨域 iframe（验证码/支付窗）跑在独立渲染进程：主页面 session 上派发的
 * Input 事件进不去，必须 attach 到 iframe 自己的 CDP target session 派发
 * （qqmail 验证码 4 次页面级拖动全败、frame session 拖动一次过的实证）。
 * 坐标语义：iframe 局部坐标系（与该 session 内 getBoundingClientRect 一致）。
 */

import type { CDPConnection } from './connection.js';
import type { XBMouse } from './types.js';
import { XBMouseImpl } from './mouse.js';
import { errMsg } from '../utils/error.js';

interface FrameInputDeps {
  conn: CDPConnection;
  /** 输入专用 frame session 解析（Target attach 两路，必须拿到真 target session） */
  resolveFrameSession(urlIncludes: string): Promise<string>;
  /** iframe 上下文求值（读写 frame 内 DOM） */
  evaluateInFrame<R = unknown>(urlIncludes: string, expression: string): Promise<R>;
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
    const rect = await this.pollFrameRect(urlIncludes, selector, opts.timeoutMs ?? 5000);
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await this.runFrameMouse(urlIncludes, (mouse) => mouse.click(x, y, { elementWidth: rect.width, elementHeight: rect.height }));
    return { x, y };
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
      if (!isSessionDeadError(err)) throw err;
      this.cache.delete(urlIncludes);
      return this.fillInFrameInner(urlIncludes, selector, text, opts);
    }
  }

  private async fillInFrameInner(
    urlIncludes: string,
    selector: string,
    text: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ value: string }> {
    await this.clickInFrame(urlIncludes, selector, opts);
    const cached = this.cache.get(urlIncludes);
    if (!cached) throw new Error(`frame session lost for "${urlIncludes}"`);
    // 原生 select() 全选（方法调用，非合成事件）→ insertText 替换选区，
    // 与 page.fill 的"先清空再输入"语义对齐（cleared=true）。
    // 不用 triple-click：CDP clickCount 序列无法合成 1→2→3，选不中。
    await this.deps.evaluateInFrame(
      urlIncludes,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el && typeof el.select === 'function') el.select(); return true; })()`,
    );
    await this.deps.conn.send('Input.insertText', { text }, cached.sessionId);
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
