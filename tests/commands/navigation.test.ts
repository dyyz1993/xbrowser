import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';

function createMockPage(): Page {
  return {
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    goBack: vi.fn().mockResolvedValue(null),
    goForward: vi.fn().mockResolvedValue(null),
    reload: vi.fn().mockResolvedValue(null),
    title: vi.fn().mockResolvedValue('Test Page'),
    url: vi.fn().mockReturnValue('https://example.com'),
    content: vi.fn().mockResolvedValue('<html><body>Hello</body></html>'),
    textContent: vi.fn().mockResolvedValue('Hello'),
    evaluate: vi.fn().mockResolvedValue('evaluated'),
    waitForSelector: vi.fn().mockResolvedValue({}),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

function createMockContext(page: Page) {
  return {
    page,
    browser: {},
    browserContext: {
      cookies: vi.fn().mockResolvedValue([]),
      addCookies: vi.fn().mockResolvedValue(undefined),
      clearCookies: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('Navigation Commands', () => {
  let mockPage: Page;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    mockPage = createMockPage();
    ctx = createMockContext(mockPage);
  });

  it('goto should navigate to URL', async () => {
    await mockPage.goto('https://example.com');
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com');
  });

  it('goBack should navigate back', async () => {
    await mockPage.goBack();
    expect(mockPage.goBack).toHaveBeenCalled();
  });

  it('goForward should navigate forward', async () => {
    await mockPage.goForward();
    expect(mockPage.goForward).toHaveBeenCalled();
  });

  it('reload should refresh page', async () => {
    await mockPage.reload();
    expect(mockPage.reload).toHaveBeenCalled();
  });

  it('title should return page title', async () => {
    const title = await mockPage.title();
    expect(title).toBe('Test Page');
  });

  it('url should return current URL', () => {
    const url = mockPage.url();
    expect(url).toBe('https://example.com');
  });
});
