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

describe('Mouse Command', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should move mouse to coordinates', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    const result = await mouseCommand.handler(
      { action: 'move', x: 100, y: 200 },
      ctx
    );
    expect(ctx.page.mouse.move).toHaveBeenCalledWith(100, 200, { steps: 1 });
    expect(result).toEqual({ success: true, data: { action: 'move', x: 100, y: 200 }, tips: [] });
  });

  it('should move mouse with custom steps', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    await mouseCommand.handler(
      { action: 'move', x: 100, y: 200, steps: 5 },
      ctx
    );
    expect(ctx.page.mouse.move).toHaveBeenCalledWith(100, 200, { steps: 5 });
  });

  it('should press mouse down with default button', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    const result = await mouseCommand.handler(
      { action: 'down', x: 0, y: 0 },
      ctx
    );
    expect(ctx.page.mouse.down).toHaveBeenCalledWith({ button: 'left' });
    expect(result).toEqual({ success: true, data: { action: 'down', x: 0, y: 0 }, tips: [] });
  });

  it('should press mouse down with right button', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    await mouseCommand.handler(
      { action: 'down', x: 0, y: 0, button: 'right' },
      ctx
    );
    expect(ctx.page.mouse.down).toHaveBeenCalledWith({ button: 'right' });
  });

  it('should release mouse up', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    await mouseCommand.handler(
      { action: 'up', x: 0, y: 0 },
      ctx
    );
    expect(ctx.page.mouse.up).toHaveBeenCalledWith({ button: 'left' });
  });

  it('should click at coordinates', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    const result = await mouseCommand.handler(
      { action: 'click', x: 150, y: 250 },
      ctx
    );
    expect(ctx.page.mouse.click).toHaveBeenCalledWith(150, 250, { button: 'left' });
    expect(result).toEqual({ success: true, data: { action: 'click', x: 150, y: 250 }, tips: [] });
  });

  it('should click with middle button', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    await mouseCommand.handler(
      { action: 'click', x: 100, y: 200, button: 'middle' },
      ctx
    );
    expect(ctx.page.mouse.click).toHaveBeenCalledWith(100, 200, { button: 'middle' });
  });

  it('should double click at coordinates', async () => {
    const { mouseCommand } = await import('../../src/commands/mouse.js');
    const result = await mouseCommand.handler(
      { action: 'dblclick', x: 100, y: 200 },
      ctx
    );
    expect(ctx.page.mouse.dblclick).toHaveBeenCalledWith(100, 200, { button: 'left' });
    expect(result).toEqual({ success: true, data: { action: 'dblclick', x: 100, y: 200 }, tips: [] });
  });
});
