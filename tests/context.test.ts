import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHumanInteractionManager } = vi.hoisted(() => ({
  mockHumanInteractionManager: vi.fn(),
}));

vi.mock('../src/human-interaction.js', () => ({
  HumanInteractionManager: mockHumanInteractionManager,
}));

import {
  checkBrowserScope,
  assertPageScope,
  attachWaitForHuman,
  getWSServerFromCache,
  setWSServerCache,
} from '../src/context.js';

describe('context', () => {
  const makeCtx = (overrides: Record<string, unknown> = {}) => ({
    page: null as any,
    browser: null as any,
    browserContext: {} as any,
    ...overrides,
  });

  describe('checkBrowserScope', () => {
    it('should return null for project scope', () => {
      expect(checkBrowserScope('project', makeCtx())).toBeNull();
    });

    it('should return null for browser scope when browser exists', () => {
      expect(checkBrowserScope('browser', makeCtx({ browser: {} }))).toBeNull();
    });

    it('should return error for browser scope when browser is null', () => {
      const result = checkBrowserScope('browser', makeCtx());
      expect(result).toContain('--session');
    });

    it('should return null for page scope when page exists', () => {
      expect(checkBrowserScope('page', makeCtx({ page: {} }))).toBeNull();
    });

    it('should return error for page scope when page is null', () => {
      const result = checkBrowserScope('page', makeCtx());
      expect(result).toContain('--session');
    });

    it('should return null for element scope when page exists', () => {
      expect(checkBrowserScope('element', makeCtx({ page: {} }))).toBeNull();
    });

    it('should return error for element scope when page is null', () => {
      const result = checkBrowserScope('element', makeCtx());
      expect(result).toContain('--session');
    });

    it('should return null for unknown scope', () => {
      expect(checkBrowserScope('other' as any, makeCtx())).toBeNull();
    });
  });

  describe('assertPageScope', () => {
    it('should not throw when page exists', () => {
      const ctx = makeCtx({ page: {} });
      expect(() => assertPageScope(ctx as any)).not.toThrow();
    });

    it('should throw when page is null', () => {
      const ctx = makeCtx();
      expect(() => assertPageScope(ctx as any)).toThrow('--session');
    });
  });

  describe('attachWaitForHuman', () => {
    it('should attach waitForHuman function to context', () => {
      const ctx = makeCtx({ page: {} });
      const mockServer = {};
      const mockGetOrCreate = vi.fn().mockResolvedValue(mockServer);
      const mockManager = { waitForHuman: vi.fn().mockResolvedValue({ solved: true, method: 'manual' }) };
      mockHumanInteractionManager.mockImplementation(() => mockManager);

      attachWaitForHuman(ctx as any, mockGetOrCreate);
      expect(ctx.waitForHuman).toBeDefined();
    });

    it('should throw when waitForHuman called without page', async () => {
      const ctx = makeCtx({ page: null });
      const mockGetOrCreate = vi.fn();
      attachWaitForHuman(ctx as any, mockGetOrCreate);
      await expect(ctx.waitForHuman!()).rejects.toThrow('waitForHuman requires an active page');
    });

    it('should call HumanInteractionManager with wsServer and page', async () => {
      const mockPage = {};
      const ctx = makeCtx({ page: mockPage });
      const mockServer = {};
      const mockGetOrCreate = vi.fn().mockResolvedValue(mockServer);
      const mockWaitForHuman = vi.fn().mockResolvedValue({ solved: true, method: 'auto-detected' });
      mockHumanInteractionManager.mockImplementation(() => ({ waitForHuman: mockWaitForHuman }));

      attachWaitForHuman(ctx as any, mockGetOrCreate);
      const result = await ctx.waitForHuman!({ reason: 'captcha' });

      expect(mockGetOrCreate).toHaveBeenCalledWith(ctx.browserContext);
      expect(mockHumanInteractionManager).toHaveBeenCalledWith(mockServer, mockPage);
      expect(mockWaitForHuman).toHaveBeenCalledWith({ reason: 'captcha' });
      expect(result).toEqual({ solved: true, method: 'auto-detected' });
    });
  });

  describe('WSServer cache', () => {
    it('should cache and retrieve ws server', () => {
      const browserCtx = {} as any;
      const server = { port: 9223 } as any;
      setWSServerCache(browserCtx, server);
      expect(getWSServerFromCache(browserCtx)).toBe(server);
    });

    it('should return undefined for uncached context', () => {
      expect(getWSServerFromCache({} as any)).toBeUndefined();
    });

    it('should use WeakMap so cache is isolated per context', () => {
      const browserCtx = {} as any;
      const server = { port: 9223 } as any;
      setWSServerCache(browserCtx, server);
      expect(getWSServerFromCache(browserCtx)).toBe(server);
      const otherCtx = {} as any;
      expect(getWSServerFromCache(otherCtx)).toBeUndefined();
    });
  });
});
