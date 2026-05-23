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

});
