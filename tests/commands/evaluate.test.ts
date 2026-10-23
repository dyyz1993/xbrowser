import { describe, it, expect, vi } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(evaluateResult?: unknown): BrowserCommandContext {
  return {
    page: {
      evaluate: vi.fn().mockResolvedValue(evaluateResult ?? 42),
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

describe('Evaluate Commands', () => {
  describe('eval', () => {
    it('should evaluate JS expression', async () => {
      const ctx = createMockContext('Example Page');
      const { evaluateCommand } = await import('../../src/commands/evaluate.js');
      const result = await evaluateCommand.handler(
        { expression: 'document.title' },
        ctx
      );
      expect(ctx.page.evaluate).toHaveBeenCalledWith('document.title');
      expect(result).toEqual({ success: true, data: { result: 'Example Page' }, tips: [] });
    });

    it('should evaluate numeric expression', async () => {
      const ctx = createMockContext(42);
      const { evaluateCommand } = await import('../../src/commands/evaluate.js');
      const result = await evaluateCommand.handler(
        { expression: '1 + 41' },
        ctx
      );
      expect(result).toEqual({ success: true, data: { result: 42 }, tips: [] });
    });

    it('should evaluate object expression', async () => {
      const obj = { href: 'https://example.com', port: '' };
      const ctx = createMockContext(obj);
      const { evaluateCommand } = await import('../../src/commands/evaluate.js');
      const result = await evaluateCommand.handler(
        { expression: 'window.location' },
        ctx
      );
      expect(result).toEqual({ success: true, data: { result: obj }, tips: [] });
    });

    it('should evaluate inside frame with --frame (command-level)', async () => {
      const ctx = createMockContext('in-frame-title');
      (ctx.page as unknown as Record<string, unknown>).evaluateInFrame = vi.fn().mockResolvedValue('in-frame-title');
      const { evaluateCommand } = await import('../../src/commands/evaluate.js');
      const result = await evaluateCommand.handler(
        { expression: 'document.title', frame: 'captcha.gtimg.com' },
        ctx
      );
      expect(ctx.page.evaluateInFrame).toHaveBeenCalledWith('captcha.gtimg.com', 'document.title');
      expect(ctx.page.evaluate).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { result: 'in-frame-title' }, tips: [] });
    });

    it('should fall back to global ctx.frame when command-level --frame absent', async () => {
      const ctx = createMockContext('in-frame-title');
      (ctx.page as unknown as Record<string, unknown>).evaluateInFrame = vi.fn().mockResolvedValue('in-frame-title');
      ctx.frame = 'captcha.gtimg.com';
      const { evaluateCommand } = await import('../../src/commands/evaluate.js');
      await evaluateCommand.handler({ expression: 'document.title' }, ctx);
      expect(ctx.page.evaluateInFrame).toHaveBeenCalledWith('captcha.gtimg.com', 'document.title');
    });
  });

});
