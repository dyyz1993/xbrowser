/**
 * XBContextImpl page-registry regression tests
 *
 * 回归背景（headless E2E 实测）：context.pages() 对同一 target 出现最多
 * 3 个 wrapper——newPage() 的显式创建、setAutoAttach 的自动附着事件、
 * Target.attachToTarget 的回显事件（CDP 规范：显式 attach 也发
 * attachedToTarget）三条路径并发创建，旧实现去重发生在
 * `await page._init()` 之后，事件在 _init 期间到达时全部穿透。
 *
 * 修复：单一规范注册表（targetId → wrapper）+ in-flight 注册 Promise。
 * 所有路径在任意 await 之前同步预约；后到者 join 同一个注册 Promise。
 *
 * 两组用例：
 *   1. 单元级（FakeConnection）：确定性复现各种事件顺序排列
 *   2. 真实 headless Chrome：newPage / window.open / 外部 CDP attach
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { XBContextImpl } from '../../src/cdp-driver/context.js';
import type { XBBrowserImpl } from '../../src/cdp-driver/browser.js';
import type { CDPConnection } from '../../src/cdp-driver/connection.js';
import type { XBPageImpl } from '../../src/cdp-driver/page.js';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Unit: fake CDP connection / browser ─────────────────────────

interface SendCall {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

class FakeConnection extends EventEmitter {
  sent: SendCall[] = [];
  /** 指定方法的延迟（ms），用于拉宽 _init 窗口让竞态事件落进初始化中途 */
  delays: Record<string, number> = {};
  /** 指定方法的注入失败 */
  rejections: Record<string, Error | undefined> = {};

  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> {
    this.sent.push({ method, params, sessionId });
    const rejectWith = this.rejections[method];
    if (rejectWith) throw rejectWith;
    const delay = this.delays[method];
    if (delay) await settle(delay);
    return {} as T;
  }

  subscribe(
    event: string,
    sessionId: string | undefined,
    handler: (params: unknown) => void,
  ): () => void {
    const wrapper = (params: unknown, sid?: string): void => {
      if (sid === sessionId || (!sessionId && !sid)) handler(params);
    };
    this.on(event, wrapper);
    return () => this.off(event, wrapper);
  }
}

interface FakeBrowserHooks {
  onCreateTarget?: (targetId: string) => void;
  onAttach?: (targetId: string, sessionId: string) => void;
}

function createFakeBrowser(hooks: FakeBrowserHooks = {}) {
  let seq = 0;
  const fns = {
    _createTarget: vi.fn(async () => {
      seq += 1;
      const targetId = `T${seq}`;
      hooks.onCreateTarget?.(targetId);
      return { targetId };
    }),
    _attachToTarget: vi.fn(async (targetId: string) => {
      const sessionId = `S-${targetId}`;
      hooks.onAttach?.(targetId, sessionId);
      return sessionId;
    }),
    _detachFromTarget: vi.fn(async (_sessionId: string) => {}),
    _closeTarget: vi.fn(async (_targetId: string) => {}),
    _removeContext: vi.fn((_contextId: string) => {}),
  };
  return { browser: fns as unknown as XBBrowserImpl, fns };
}

function emitAttached(
  conn: FakeConnection,
  p: { targetId: string; sessionId: string; browserContextId?: string; type?: string },
): void {
  conn.emit('Target.attachedToTarget', {
    targetInfo: {
      targetId: p.targetId,
      type: p.type ?? 'page',
      browserContextId: p.browserContextId,
      url: 'about:blank',
    },
    sessionId: p.sessionId,
  });
}

/** auto-attach 事件在 createTarget 响应之前到达（queueMicrotask 先于 await 续体） */
function autoAttachBeforeCreateTargetResumes(conn: FakeConnection, contextId: string): FakeBrowserHooks {
  return {
    onCreateTarget: (targetId) => {
      queueMicrotask(() => {
        emitAttached(conn, { targetId, sessionId: `S-auto-${targetId}`, browserContextId: contextId });
      });
    },
  };
}

describe('XBContextImpl page registry (unit, deterministic event orders)', () => {
  it('auto-attach fires BEFORE newPage claims → newPage joins the auto registration, single wrapper', async () => {
    const conn = new FakeConnection();
    conn.delays['Page.enable'] = 25; // 拉宽 _init 窗口
    const { browser, fns } = createFakeBrowser(autoAttachBeforeCreateTargetResumes(conn, 'CTX-1'));
    const ctx = new XBContextImpl(conn as unknown as CDPConnection, 'CTX-1', browser, {});

    const page = await ctx.newPage();
    await settle(60); // 若存在竞态重复注册，让它们全部完成后再断言

    expect(ctx.pages()).toHaveLength(1);
    expect(ctx.pages()[0]).toBe(page);
    expect((page as XBPageImpl).sessionId).toBe('S-auto-T1');
    // auto-attach 已持有 session，newPage 不应再显式 attach（不造孤儿 session）
    expect(fns._attachToTarget).not.toHaveBeenCalled();
  });

  it('newPage claims first; auto-attach + attach echo events land mid-_init → single wrapper (E2E "3 wrappers" scenario)', async () => {
    const conn = new FakeConnection();
    conn.delays['Page.enable'] = 25;
    const { browser } = createFakeBrowser({
      onAttach: (targetId, sessionId) => {
        // 显式 attach 的回显事件 + 自动附着补发事件，都落在 _init 进行中
        setTimeout(() => emitAttached(conn, { targetId, sessionId: `${sessionId}-echo`, browserContextId: 'CTX-1' }), 5);
        setTimeout(() => emitAttached(conn, { targetId, sessionId: `${sessionId}-auto2`, browserContextId: 'CTX-1' }), 10);
      },
    });
    const ctx = new XBContextImpl(conn as unknown as CDPConnection, 'CTX-1', browser, {});

    const page = await ctx.newPage();
    await settle(60);

    expect(ctx.pages()).toHaveLength(1);
    expect(ctx.pages()[0]).toBe(page);
    expect((page as XBPageImpl).sessionId).toBe('S-T1');
  });

  it('registration promise covers init scripts when auto-attach claims first (applied exactly once, not re-applied by newPage join)', async () => {
    const conn = new FakeConnection();
    conn.delays['Page.enable'] = 25;
    const { browser } = createFakeBrowser(autoAttachBeforeCreateTargetResumes(conn, 'CTX-1'));
    const ctx = new XBContextImpl(conn as unknown as CDPConnection, 'CTX-1', browser, {});
    await ctx.addInitScript('__XB_REGISTRY_MARKER__');

    await ctx.newPage();
    await settle(30);

    const markerSends = conn.sent.filter(
      (s) =>
        s.method === 'Page.addScriptToEvaluateOnNewDocument' &&
        String(s.params?.source ?? '').includes('__XB_REGISTRY_MARKER__'),
    );
    expect(markerSends).toHaveLength(1);
  });

  it('context options (viewport/UA) are applied on a joined wrapper, not silently skipped', async () => {
    const conn = new FakeConnection();
    conn.delays['Page.enable'] = 25;
    const { browser } = createFakeBrowser(autoAttachBeforeCreateTargetResumes(conn, 'CTX-1'));
    const ctx = new XBContextImpl(conn as unknown as CDPConnection, 'CTX-1', browser, {
      viewport: { width: 640, height: 480 },
      userAgent: 'XB-Registry-Test-UA',
    });

    const page = await ctx.newPage();
    await settle(30);

    expect((page as XBPageImpl).sessionId).toBe('S-auto-T1'); // join 路径
    expect(
      conn.sent.some(
        (s) =>
          s.method === 'Emulation.setDeviceMetricsOverride' &&
          (s.params as { width?: number } | undefined)?.width === 640,
      ),
    ).toBe(true);
    expect(
      conn.sent.some(
        (s) =>
          s.method === 'Network.setUserAgentOverride' &&
          (s.params as { userAgent?: string } | undefined)?.userAgent === 'XB-Registry-Test-UA',
      ),
    ).toBe(true);
  });

  it('_attachExistingPage dedups with a synchronous echo event fired inside attach, and is idempotent', async () => {
    const conn = new FakeConnection();
    const { browser } = createFakeBrowser({
      onAttach: (targetId, sessionId) => {
        // 回显事件在 attach 响应解析前同步到达（handler 先预约注册）
        emitAttached(conn, { targetId, sessionId: `${sessionId}-echo`, browserContextId: 'CTX-1' });
      },
    });
    const ctx = new XBContextImpl(conn as unknown as CDPConnection, 'CTX-1', browser, {});

    const page = await ctx._attachExistingPage('TEX-1');
    await settle(30);

    expect(page).not.toBeNull();
    expect(ctx.pages()).toHaveLength(1);
    expect(ctx.pages()[0]).toBe(page);

    const again = await ctx._attachExistingPage('TEX-1');
    expect(again).toBe(page);
    expect(ctx.pages()).toHaveLength(1);
  });

  it('default context only adopts targets WITHOUT browserContextId; named contexts match exactly (no cross-context stealing)', async () => {
    const conn = new FakeConnection();
    const { browser } = createFakeBrowser();
    const ctxDefault = new XBContextImpl(conn as unknown as CDPConnection, 'default', browser, {});
    const ctxNamed = new XBContextImpl(conn as unknown as CDPConnection, 'CTX-1', browser, {});

    emitAttached(conn, { targetId: 'N-1', sessionId: 'S-n1', browserContextId: 'CTX-1' }); // 命中 named
    emitAttached(conn, { targetId: 'N-2', sessionId: 'S-n2', browserContextId: 'CTX-OTHER' }); // 谁都不收
    emitAttached(conn, { targetId: 'N-3', sessionId: 'S-n3' }); // 无 bcId → default
    await settle(30);

    expect(ctxNamed.pages()).toHaveLength(1);
    expect((ctxNamed.pages()[0] as XBPageImpl)._targetId).toBe('N-1');
    expect(ctxDefault.pages()).toHaveLength(1);
    expect((ctxDefault.pages()[0] as XBPageImpl)._targetId).toBe('N-3');
  });

  it('registration failure rejects joiners AND frees the target for a later retry', async () => {
    const conn = new FakeConnection();
    conn.rejections['Page.enable'] = new Error('init boom');
    const { browser } = createFakeBrowser(autoAttachBeforeCreateTargetResumes(conn, 'CTX-1'));
    const ctx = new XBContextImpl(conn as unknown as CDPConnection, 'CTX-1', browser, {});

    await expect(ctx.newPage()).rejects.toThrow('init boom');
    expect(ctx.pages()).toHaveLength(0);

    // 失败后 in-flight 预约必须被清理——后续 newPage 能重新注册成功
    conn.rejections['Page.enable'] = undefined;
    const page = await ctx.newPage();
    await settle(30);
    expect(ctx.pages()).toHaveLength(1);
    expect(ctx.pages()[0]).toBe(page);
  });
});

// ── Real headless Chrome (isolated local synthetic) ──────────────

describe('XBContextImpl page registry (real headless Chrome)', () => {
  let browser: XBBrowser | null = null;
  let wsEndpoint = '';

  beforeAll(async () => {
    try {
      const result = await launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
      browser = result.browser;
      wsEndpoint = result.wsEndpoint;
    } catch {
      browser = null; // 无 Chrome 环境（如部分 CI）跳过真实浏览器组
    }
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
  }, 30_000);

  it('newPage() × 3 → exactly 3 wrappers, unique targetIds, identity preserved across pages() calls', async (t) => {
    if (!browser) return t.skip();
    const context = await browser.newContext();
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    const p3 = await context.newPage();
    await settle(500); // 让所有竞态 attachedToTarget 事件（若有重复注册）跑完

    const all = context.pages();
    expect(all).toHaveLength(3);
    expect(all).toContain(p1);
    expect(all).toContain(p2);
    expect(all).toContain(p3);
    const ids = (all as XBPageImpl[]).map((p) => p._targetId);
    expect(new Set(ids).size).toBe(3);
    // 重复调用 pages() 返回同一批 wrapper 对象（注册表稳定性）
    expect(context.pages()[0]).toBe(all[0]);
  }, 30_000);

  it('window.open auto-attach → exactly one wrapper for the popup, emitted once', async (t) => {
    if (!browser) return t.skip();
    const context = await browser.newContext();
    const opener = await context.newPage(); // about:blank 即可触发 window.open

    const popupPages: XBPage[] = [];
    context.on('page', (p: unknown) => popupPages.push(p as XBPage));
    // void：window.open 返回 Window 对象，Runtime.evaluate 深序列化会报
    // "Object reference chain is too long"——丢弃返回值
    await opener.evaluate("void window.open('about:blank')");

    await vi.waitFor(() => expect(context.pages().length).toBe(2), { timeout: 10_000 });
    await settle(500); // 若修复失效，迟到的重复注册会在此窗口内落进 pages()

    expect(popupPages).toHaveLength(1);
    const all = context.pages();
    expect(all).toHaveLength(2);
    const ids = (all as XBPageImpl[]).map((p) => p._targetId);
    expect(new Set(ids).size).toBe(2);
    expect(all).toContain(popupPages[0]);
  }, 30_000);

  it('external CDP attach (discoverContexts) → one wrapper per target across all contexts; newPage on attached browser stays unique', async (t) => {
    if (!browser) return t.skip();
    const second = await launch({ cdpEndpoint: wsEndpoint });
    try {
      await second.browser.discoverContexts();
      await settle(500);

      const wrappers = second.browser
        .contexts()
        .flatMap((ctx) => ctx.pages() as XBPageImpl[]);
      expect(wrappers.length).toBeGreaterThan(0);
      const byTarget = new Map<string, number>();
      for (const w of wrappers) {
        byTarget.set(w._targetId, (byTarget.get(w._targetId) ?? 0) + 1);
      }
      for (const [targetId, count] of byTarget) {
        expect(count, `target ${targetId} should have exactly 1 wrapper`).toBe(1);
      }

      // attach 连接上再 newPage：显式创建 + auto-attach 回显事件并发 → 仍唯一
      const context = second.browser.contexts()[0] ?? (await second.browser.newContext());
      const page = await context.newPage();
      await settle(500);
      const sameTarget = (context.pages() as XBPageImpl[]).filter(
        (w) => w._targetId === (page as XBPageImpl)._targetId,
      );
      expect(sameTarget).toHaveLength(1);
      expect(sameTarget[0]).toBe(page);
      await page.close().catch(() => {});
    } finally {
      await second.browser.disconnect();
    }
  }, 45_000);
});
