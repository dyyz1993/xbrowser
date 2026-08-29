import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(): BrowserCommandContext {
  return {
    page: {
      mouse: {
        move: vi.fn().mockResolvedValue(undefined),
        down: vi.fn().mockResolvedValue(undefined),
        up: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        dblclick: vi.fn().mockResolvedValue(undefined),
        wheel: vi.fn().mockResolvedValue(undefined),
      },
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
    browser: {},
    browserContext: {
      cookies: vi.fn().mockResolvedValue([]),
      addCookies: vi.fn().mockResolvedValue(undefined),
      clearCookies: vi.fn().mockResolvedValue(undefined),
    },
    sessionId: 'test-session',
    args: [],
    options: {},
    cwd: '/tmp',
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), keys: vi.fn() },
    output: { mode: 'text', showTips: false, color: false, emoji: false },
    error: vi.fn(),
    config: {},
    site: {} as any,
    cliName: 'xbrowser',
  } as unknown as BrowserCommandContext;
}

/** Extract the deltaY series from wheel mock calls */
function wheelCalls(ctx: BrowserCommandContext): Array<[number, number]> {
  const mock = ctx.page.mouse.wheel as unknown as { mock: { calls: Array<[number, number]> } };
  return mock.mock.calls;
}

describe('Scroll Command', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should scroll down with inertia sequence (d51): multiple decaying wheel events', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'down' }, ctx);
    const calls = wheelCalls(ctx);
    // 惯性序列：多个事件，首事件为峰值（wheelPeak=180 ±15% 抖动 ≤207），
    // 非单事件一步到位
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls[0][1]).toBeLessThanOrEqual(207);
    expect(calls[0][1]).toBeGreaterThan(100);
    // 衰减：后半段 delta 总和应小于前半段（指数衰减包络）
    const half = Math.floor(calls.length / 2);
    const firstHalf = calls.slice(0, half).reduce((a, c) => a + Math.abs(c[1]), 0);
    const secondHalf = calls.slice(half).reduce((a, c) => a + Math.abs(c[1]), 0);
    expect(secondHalf).toBeLessThan(firstHalf);
    // 垂直滚动：deltaX 恒 0
    for (const [dx] of calls) expect(dx).toBe(0);
    expect(result).toEqual({ success: true, data: { direction: 'down', distance: 500 }, tips: [] });
  });

  it('should scroll up: negative deltaY sum covering distance', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'up' }, ctx);
    const calls = wheelCalls(ctx);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const sum = calls.reduce((a, c) => a + c[1], 0);
    expect(sum).toBeLessThanOrEqual(-480); // ≈ -500（末步截断容差）
    expect(result).toEqual({ success: true, data: { direction: 'up', distance: 500 }, tips: [] });
  });

  it('should scroll left: negative deltaX series', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'left' }, ctx);
    const calls = wheelCalls(ctx);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const [, dy] of calls) expect(dy).toBe(0);
    const sum = calls.reduce((a, c) => a + c[0], 0);
    expect(sum).toBeLessThanOrEqual(-480);
    expect(result).toEqual({ success: true, data: { direction: 'left', distance: 500 }, tips: [] });
  });

  it('should scroll right: positive deltaX series', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'right' }, ctx);
    const calls = wheelCalls(ctx);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const sum = calls.reduce((a, c) => a + c[0], 0);
    expect(sum).toBeGreaterThanOrEqual(480);
    expect(result).toEqual({ success: true, data: { direction: 'right', distance: 500 }, tips: [] });
  });

  it('should scroll with custom distance: series sums to ~distance', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'down', distance: 300 }, ctx);
    const calls = wheelCalls(ctx);
    const sum = calls.reduce((a, c) => a + c[1], 0);
    expect(sum).toBeGreaterThanOrEqual(290);
    expect(sum).toBeLessThanOrEqual(300);
    expect(result).toEqual({ success: true, data: { direction: 'down', distance: 300 }, tips: [] });
  });

  it('should scroll element when selector provided', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler(
      { direction: 'down', distance: 200, selector: '#container' },
      ctx
    );
    expect(ctx.page.locator).toHaveBeenCalledWith('#container');
    expect(ctx.page.mouse.wheel).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { direction: 'down', distance: 200 }, tips: [] });
  });
});
