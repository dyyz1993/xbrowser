import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(evaluateResult?: unknown): BrowserCommandContext {
  return {
    page: {
      evaluate: vi.fn().mockResolvedValue(evaluateResult ?? undefined),
    },
    browser: {},
    browserContext: {
      cookies: vi.fn().mockResolvedValue([
        { name: 'session', value: 'abc123', domain: 'example.com' },
        { name: 'lang', value: 'zh', domain: 'example.com' },
      ]),
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

describe('Storage Commands', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('getCookies', () => {
    it('should return all cookies', async () => {
      const { getCookiesCommand } = await import('../../src/commands/storage.js');
      const result = await getCookiesCommand.handler({}, ctx);
      expect(ctx.browserContext.cookies).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: {
          cookies: [
            { name: 'session', value: 'abc123', domain: 'example.com' },
            { name: 'lang', value: 'zh', domain: 'example.com' },
          ],
        },
        tips: [],
      });
    });
  });

  describe('setCookie', () => {
    it('should set a cookie', async () => {
      const { setCookieCommand } = await import('../../src/commands/storage.js');
      const cookie = {
        name: 'test',
        value: 'val',
        domain: 'example.com',
        path: '/',
      };
      const result = await setCookieCommand.handler(cookie, ctx);
      expect(ctx.browserContext.addCookies).toHaveBeenCalledWith([cookie]);
      expect(result).toEqual({ success: true, data: { name: 'test' }, tips: [] });
    });

    it('should set cookie with all options', async () => {
      const { setCookieCommand } = await import('../../src/commands/storage.js');
      const cookie = {
        name: 'secure',
        value: 'data',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict' as const,
      };
      await setCookieCommand.handler(cookie, ctx);
      expect(ctx.browserContext.addCookies).toHaveBeenCalledWith([cookie]);
    });
  });

  describe('clearCookies', () => {
    it('should clear all cookies', async () => {
      const { clearCookiesCommand } = await import('../../src/commands/storage.js');
      const result = await clearCookiesCommand.handler({}, ctx);
      expect(ctx.browserContext.clearCookies).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { cleared: true }, tips: [] });
    });
  });

  describe('getLocalStorage', () => {
    it('should get value by key', async () => {
      const storeCtx = createMockContext('stored-value');
      const { getLocalStorageCommand } = await import('../../src/commands/storage.js');
      const result = await getLocalStorageCommand.handler({ key: 'myKey' }, storeCtx);
      expect(result).toEqual({ success: true, data: { key: 'myKey', value: 'stored-value' }, tips: [] });
    });

    it('should get all entries when no key specified', async () => {
      const data = { foo: 'bar', baz: 'qux' };
      const storeCtx = createMockContext(data);
      const { getLocalStorageCommand } = await import('../../src/commands/storage.js');
      const result = await getLocalStorageCommand.handler({}, storeCtx);
      expect(result).toEqual({ success: true, data: { data }, tips: [] });
    });
  });

  describe('setLocalStorage', () => {
    it('should call page.evaluate with setItem args', async () => {
      const { setLocalStorageCommand } = await import('../../src/commands/storage.js');
      const result = await setLocalStorageCommand.handler(
        { key: 'token', value: 'abc123' },
        ctx
      );
      expect(ctx.page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        { key: 'token', value: 'abc123' }
      );
      expect(result).toEqual({ success: true, data: { key: 'token' }, tips: [] });
    });
  });

  describe('clearLocalStorage', () => {
    it('should call page.evaluate with clear', async () => {
      const { clearLocalStorageCommand } = await import('../../src/commands/storage.js');
      const result = await clearLocalStorageCommand.handler({}, ctx);
      expect(ctx.page.evaluate).toHaveBeenCalledWith(expect.any(Function));
      expect(result).toEqual({ success: true, data: { cleared: true }, tips: [] });
    });
  });
});
