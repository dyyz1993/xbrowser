/**
 * issue #397 回归：humanize 展开的 __sequence 轨迹点不能串行 await 回执。
 *
 * Chromium 对 Input.dispatchMouseEvent type=mouseMoved 的 CDP 回调要等
 * 渲染合成器提交帧（重页面/后台 tab 实测 5-12s/次）。串行 await 会把
 * 28 步轨迹放大成分钟级并击穿超时。修复后语义：
 * - 中间步骤 fire-and-forget（不 await 回执，失败静默）
 * - 最后一步保持 await（落点按下/抬起语义上必须确认送达）
 * - delayMs 节奏保持（拟人节奏不受影响）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

/** 可控的假 WebSocket：捕获出站帧，按需回 ACK */
function createFakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    sent: Array<{ id: number; method: string; params: Record<string, unknown> }>;
    resolveAll: (result?: unknown) => void;
  };
  ws.sent = [];
  ws.on('message', () => {}); // bindWebSocket 注册
  (ws as unknown as { send: (data: string) => void }).send = (data: string) => {
    ws.sent.push(JSON.parse(data) as { id: number; method: string; params: Record<string, unknown> });
  };
  // resolveAll：给所有已发帧补 ACK（模拟浏览器响应）
  ws.resolveAll = (result?: unknown) => {
    const entries = ws.sent.map((f) => [f.id, { id: f.id, result: result ?? {} }] as const);
    for (const [, payload] of entries) {
      ws.emit('message', JSON.stringify(payload));
    }
  };
  return ws;
}

/** 拿到一个已"打开"且 guard 被 stub 的 CDPConnection */
async function createTestConnection(guardDecision: unknown) {
  const { CDPConnection } = await import('../../src/cdp-driver/connection.js');
  // stub 静态 guard：跳过 createRuleEngine 的真实初始化
  const mod = (await import('../../src/cdp-driver/connection.js')) as unknown as {
    CDPConnection: { __guard: unknown };
  };
  mod.CDPConnection.__guard = {
    evaluate: vi.fn(() => guardDecision),
    start: vi.fn(),
    stop: vi.fn(),
  } as never;

  const fakeWs = createFakeWs();
  const conn = new CDPConnection(fakeWs as never, 'test-session');
  // bindWebSocket 后模拟 open 事件（isOpen 依赖 ws readyState）
  Object.defineProperty(fakeWs, 'readyState', { value: 1, configurable: true });
  fakeWs.emit('open');
  openConns.push(conn as unknown as { close: () => Promise<void> });
  return { conn, fakeWs };
}

/** 打开的连接登记——afterEach 统一 close 清 keepalive interval */
const openConns: Array<{ close: () => Promise<void> }> = [];

describe('CDPConnection __sequence 派发语义（issue #397）', () => {
  afterEach(async () => {
    for (const c of openConns.splice(0)) await c.close().catch(() => undefined);
  });

  it('中间轨迹点 fire-and-forget：不等待回执，最后一步保持 await', async () => {
    const { conn, fakeWs } = await createTestConnection({
      action: 'transform',
      transformedParams: {
        __sequence: [
          { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 1 } },
          { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 2, y: 2 } },
          { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 3, y: 3 } },
        ],
      },
    });

    // 关键：前两步的 ACK 永远不来（模拟合成器推迟回调）。
    // 串行 await 版本在 100ms 时只能发出第 1 帧（卡在第 1 步等回执）；
    // fire-and-forget 版本 3 帧应全部发出（不被前帧 ACK 阻塞）。
    let settled = false;
    const promise = conn
      .send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 99, y: 99 })
      .then((r) => { settled = true; return r; });

    await new Promise((r) => setTimeout(r, 100));
    expect(fakeWs.sent).toHaveLength(3);
    expect(fakeWs.sent.map((f) => (f.params as { type?: string }).type)).toEqual([
      'mouseMoved', 'mouseMoved', 'mousePressed',
    ]);

    // 最后一步仍保持 await 语义：ACK 未到前 promise 不 settle
    expect(settled).toBe(false);

    // 补上所有 ACK，promise 以最后一步的结果 resolve
    fakeWs.resolveAll({ ok: true });
    const result = (await promise) as { ok?: boolean };
    expect(settled).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it('delayMs 节奏保持：每步之间按 delay 间隔派发', async () => {
    const { conn, fakeWs } = await createTestConnection({
      action: 'transform',
      transformedParams: {
        __sequence: [
          { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 1 }, delayMs: 30 },
          { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 2, y: 2 }, delayMs: 30 },
        ],
      },
    });

    const start = Date.now();
    // 最后一步的 ACK 在 200ms 后才来——await 语义下 promise 要等到它
    const promise = conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 9, y: 9 });
    await new Promise((r) => setTimeout(r, 120));
    const elapsed = Date.now() - start;

    expect(fakeWs.sent).toHaveLength(2);
    // 两步各 30ms delay → 至少 ~50ms（允许调度误差）
    expect(elapsed).toBeGreaterThanOrEqual(45);

    fakeWs.resolveAll({ ok: true });
    await promise;
  });

  it('中间步骤的 CDP 错误被吞掉：不让轨迹因单点失败而中断', async () => {
    const { conn, fakeWs } = await createTestConnection({
      action: 'transform',
      transformedParams: {
        __sequence: [
          { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 1 } },
          { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 2, y: 2 } },
        ],
      },
    });

    // 第一步回错误帧（session 失效等场景），第二步回成功
    const promise = conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await new Promise((r) => setTimeout(r, 50));
    fakeWs.emit('message', JSON.stringify({
      id: fakeWs.sent[0].id,
      error: { code: -32000, message: 'Session not found' },
    }));
    fakeWs.emit('message', JSON.stringify({
      id: fakeWs.sent[1].id,
      result: { ok: true },
    }));

    // 不应 reject（中间点失败静默），以最后一步结果收口
    const result = (await promise) as { ok?: boolean };
    expect(result).toEqual({ ok: true });
  });
});
