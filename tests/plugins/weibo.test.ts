import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/weibo/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = []) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
        fill: vi.fn(),
      })),
    })),
  };
}

describe('weibo plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name weibo', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'weibo' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://weibo.com' })
    );
  });

  it('should create site with requiresLogin true', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: true })
    );
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
  });

  it('should register search-image, post, and repost commands', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toContain('search-image');
    expect(names).toContain('post');
    expect(names).toContain('repost');
  });

  it('search-image should have description, scope, parameters, and handler', () => {
    const searchImageCall = mockSite.command.mock.calls.find(c => c[0] === 'search-image');
    const config = searchImageCall![1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
    expect(typeof config.handler).toBe('function');
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });

  // ─── search-image command ───
  describe('search-image command', () => {
    it('should have browser scope', () => {
      const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
      expect(config.scope).toBe('browser');
    });

    it('should throw when no page available', async () => {
      const handler = getHandler('search-image');
      await expect(handler({ query: 'cats' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to weibo image search URL', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([]);
      await handler({ query: '可爱猫咪', limit: 10 }, { page });
      expect(page.goto).toHaveBeenCalledWith(
        'https://s.weibo.com/weibo?q=%E5%8F%AF%E7%88%B1%E7%8C%AB%E5%92%AA&type=image',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return results with query and engine', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'Cat', thumbnailUrl: 'https://img.sinaimg.cn/cat.jpg', sourceUrl: 'https://s.weibo.com/post/1', width: 400, height: 300 },
      ]);
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.query).toBe('cats');
      expect(data.engine).toBe('weibo');
      const results = data.results as unknown[];
      expect(results).toHaveLength(1);
    });

    it('should include sourceSite in results', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'Cat', thumbnailUrl: 'https://img.sinaimg.cn/cat.jpg', sourceUrl: '', width: 100, height: 100 },
      ]);
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      const results = data.results as Array<Record<string, unknown>>;
      expect(results[0].sourceSite).toBe('weibo');
    });

    it('should include total count in data', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'Cat1', thumbnailUrl: 'https://img.sinaimg.cn/1.jpg', sourceUrl: '', width: 100, height: 100 },
        { title: 'Cat2', thumbnailUrl: 'https://img.sinaimg.cn/2.jpg', sourceUrl: '', width: 100, height: 100 },
      ]);
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.total).toBe(2);
    });

    it('should include count in tips', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'Cat', thumbnailUrl: 'https://img.sinaimg.cn/cat.jpg', sourceUrl: '', width: 100, height: 100 },
      ]);
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      const tips = result.tips as string[];
      expect(tips.some((t) => t.includes('1 张'))).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([]);
      page.goto = vi.fn(() => { throw new Error('Navigation failed'); });
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });

    it('should scroll page during search', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([]);
      await handler({ query: 'cats', limit: 10 }, { page });
      // evaluate is called for both scroll and data extraction
      expect(page.evaluate).toHaveBeenCalled();
    });
  });
});
