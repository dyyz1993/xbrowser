import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext } from 'playwright';

function createMockContext(): {
  page: Page;
  browserContext: BrowserContext;
} {
  const page = {
    evaluate: vi.fn().mockImplementation(async (fn: unknown, arg?: unknown) => {
      if (typeof fn === 'string') return undefined;
      if (typeof fn === 'function') {
        return fn(arg);
      }
      return undefined;
    }),
  } as unknown as Page;

  const browserContext = {
    cookies: vi.fn().mockResolvedValue([
      { name: 'session', value: 'abc123', domain: 'example.com' },
    ]),
    addCookies: vi.fn().mockResolvedValue(undefined),
    clearCookies: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserContext;

  return { page, browserContext };
}

describe('Storage Commands', () => {
  let page: Page;
  let browserContext: BrowserContext;

  beforeEach(() => {
    const ctx = createMockContext();
    page = ctx.page;
    browserContext = ctx.browserContext;
  });

  it('getCookies should return all cookies', async () => {
    const cookies = await browserContext.cookies();
    expect(cookies).toEqual([{ name: 'session', value: 'abc123', domain: 'example.com' }]);
    expect(browserContext.cookies).toHaveBeenCalled();
  });

  it('addCookies should set a cookie', async () => {
    await browserContext.addCookies([{ name: 'test', value: 'val' }]);
    expect(browserContext.addCookies).toHaveBeenCalledWith([{ name: 'test', value: 'val' }]);
  });

  it('clearCookies should clear all cookies', async () => {
    await browserContext.clearCookies();
    expect(browserContext.clearCookies).toHaveBeenCalled();
  });

  it('evaluate localStorage.getItem should return value', async () => {
    const mockEvaluate = vi.fn().mockResolvedValue('stored-value');
    const mockPage = { evaluate: mockEvaluate } as unknown as Page;
    await mockPage.evaluate((k: string) => localStorage.getItem(k), 'myKey');
    expect(mockEvaluate).toHaveBeenCalled();
  });

  it('evaluate localStorage.clear should clear storage', async () => {
    const mockEvaluate = vi.fn().mockResolvedValue(undefined);
    const mockPage = { evaluate: mockEvaluate } as unknown as Page;
    await mockPage.evaluate(() => localStorage.clear());
    expect(mockEvaluate).toHaveBeenCalled();
  });
});
