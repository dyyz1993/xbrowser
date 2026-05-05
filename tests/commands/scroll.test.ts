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

describe('Scroll Command', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should scroll down with default distance', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'down' }, ctx);
    expect(ctx.page.mouse.wheel).toHaveBeenCalledWith(0, 500);
    expect(result).toEqual({ success: true, data: { direction: 'down', distance: 500 }, tips: [] });
  });

  it('should scroll up with default distance', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'up' }, ctx);
    expect(ctx.page.mouse.wheel).toHaveBeenCalledWith(0, -500);
    expect(result).toEqual({ success: true, data: { direction: 'up', distance: 500 }, tips: [] });
  });

  it('should scroll left', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'left' }, ctx);
    expect(ctx.page.mouse.wheel).toHaveBeenCalledWith(-500, 0);
    expect(result).toEqual({ success: true, data: { direction: 'left', distance: 500 }, tips: [] });
  });

  it('should scroll right', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'right' }, ctx);
    expect(ctx.page.mouse.wheel).toHaveBeenCalledWith(500, 0);
    expect(result).toEqual({ success: true, data: { direction: 'right', distance: 500 }, tips: [] });
  });

  it('should scroll with custom distance', async () => {
    const { scrollCommand } = await import('../../src/commands/scroll.js');
    const result = await scrollCommand.handler({ direction: 'down', distance: 300 }, ctx);
    expect(ctx.page.mouse.wheel).toHaveBeenCalledWith(0, 300);
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
