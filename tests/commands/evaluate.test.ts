import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  });

  describe('evaluateFn', () => {
    it('should evaluate function with arguments', async () => {
      const ctx = createMockContext(3);
      const { evaluateFnCommand } = await import('../../src/commands/evaluate.js');
      const result = await evaluateFnCommand.handler(
        { fn: 'return args[0] + args[1]', args: [1, 2] },
        ctx
      );
      expect(ctx.page.evaluate).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { result: 3 }, tips: [] });
    });

    it('should evaluate function without arguments', async () => {
      const ctx = createMockContext('hello');
      const { evaluateFnCommand } = await import('../../src/commands/evaluate.js');
      const result = await evaluateFnCommand.handler(
        { fn: 'return "hello"' },
        ctx
      );
      expect(ctx.page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        { fnBody: 'return "hello"', fnArgs: [] }
      );
      expect(result).toEqual({ success: true, data: { result: 'hello' }, tips: [] });
    });

    it('should pass arguments correctly', async () => {
      const ctx = createMockContext([1, 2, 3]);
      const { evaluateFnCommand } = await import('../../src/commands/evaluate.js');
      await evaluateFnCommand.handler(
        { fn: 'return args', args: [1, 2, 3] },
        ctx
      );
      const callArgs = (ctx.page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1]).toEqual({ fnBody: 'return args', fnArgs: [1, 2, 3] });
    });
  });
});
