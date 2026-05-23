import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(overrides?: Record<string, unknown>): BrowserCommandContext {
  const page = {
    evaluate: vi.fn().mockResolvedValue(true),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    frames: vi.fn().mockReturnValue([]),
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
        screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
      }),
    }),
    url: vi.fn().mockReturnValue('https://example.com'),
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    ...overrides,
  };

  return {
    page,
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

describe('Wait Commands', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('wait', () => {
    it('should wait for selector with defaults', async () => {
      const { waitCommand } = await import('../../src/commands/wait.js');
      const result = await waitCommand.handler({ selector: '#content', timeout: 100 }, ctx);
      expect(ctx.page.evaluate).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { selector: '#content', found: true }, tips: [] });
    });

    it('should wait with custom state and timeout', async () => {
      const { waitCommand } = await import('../../src/commands/wait.js');
      await waitCommand.handler(
        { selector: '#modal', state: 'hidden', timeout: 100 },
        ctx
      );
      expect(ctx.page.evaluate).toHaveBeenCalled();
    });

    it('should wait for attached state', async () => {
      const { waitCommand } = await import('../../src/commands/wait.js');
      const result = await waitCommand.handler(
        { selector: '#elem', state: 'attached', timeout: 100 },
        ctx
      );
      expect(result).toEqual({ success: true, data: { selector: '#elem', found: true }, tips: [] });
    });

    it('should wait for detached state', async () => {
      const { waitCommand } = await import('../../src/commands/wait.js');
      const result = await waitCommand.handler(
        { selector: '.loader', state: 'detached', timeout: 100 },
        ctx
      );
      expect(result).toEqual({ success: true, data: { selector: '.loader', found: true }, tips: [] });
    });
  });
});
