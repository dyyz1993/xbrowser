import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(): BrowserCommandContext {
  return {
    page: {
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
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

describe('Viewport Command', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should set viewport with width and height', async () => {
    const { setViewportCommand } = await import('../../src/commands/viewport.js');
    const result = await setViewportCommand.handler(
      { width: 1920, height: 1080 },
      ctx
    );
    expect(ctx.page.setViewportSize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(result).toEqual({ success: true, data: { width: 1920, height: 1080 }, tips: [] });
  });

  it('should use provided width and height', async () => {
    const { setViewportCommand } = await import('../../src/commands/viewport.js');
    const result = await setViewportCommand.handler(
      { width: 375, height: 667 },
      ctx
    );
    expect(ctx.page.setViewportSize).toHaveBeenCalledWith({ width: 375, height: 667 });
    expect(result).toEqual({ success: true, data: { width: 375, height: 667 }, tips: [] });
  });

  it('should query current viewport size', async () => {
    const { setViewportCommand } = await import('../../src/commands/viewport.js');
    await setViewportCommand.handler({ width: 800, height: 600 }, ctx);
    expect(ctx.page.viewportSize).toHaveBeenCalled();
  });
});
