import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/baidu/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function createMockPage(evaluateResult: unknown = []) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => evaluateResult),
    click: vi.fn(() => Promise.resolve()),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
      })),
    })),
  };
}

describe('baidu plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'baidu',
        url: 'https://www.baidu.com',
      })
    );
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['search', 'hotsearch', 'suggest', 'news', 'seo-rank']));
  });

  it('should register login and logout', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  describe('search command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ query: 'test', pages: 1 }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return search results', async () => {
      const mockPage = createMockPage([
        { title: 'Test', url: 'http://t.com', snippet: 's', source: 'src', page: 1, position: 1 },
      ]);
      const result = await handler({ query: 'test', pages: 1, limit: 10 }, { page: mockPage });
      expect(result.data).toHaveLength(1);
      expect(mockPage.goto).toHaveBeenCalled();
    });

    it('should limit results when limit param provided', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        title: `T${i}`, url: '', snippet: '', source: '', page: 1, position: i + 1,
      }));
      const mockPage = createMockPage(items);
      const result = await handler({ query: 'test', pages: 1, limit: 5 }, { page: mockPage });
      expect(result.data).toHaveLength(5);
    });
  });

  describe('hotsearch command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'hotsearch');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ category: 'hot' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return hot search items', async () => {
      const mockPage = createMockPage([
        { rank: 1, title: 'Hot1', url: '', heat: '100', tag: '' },
      ]);
      const result = await handler({ category: 'hot' }, { page: mockPage });
      expect(result.data).toHaveLength(1);
      expect(result.tips).toBeDefined();
    });
  });

  describe('suggest command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'suggest');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ query: 'test' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should parse suggestion text', async () => {
      const mockPage = createMockPage('s:["编程入门","编程语言"]');
      const result = await handler({ query: '编程' }, { page: mockPage });
      expect(result.data).toHaveLength(2);
    });
  });

  describe('news command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'news');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ query: 'AI', limit: 10 }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return news items', async () => {
      const mockPage = createMockPage([
        { title: 'News1', url: '', source: 'src', time: '2024-01-01', snippet: 's' },
      ]);
      const result = await handler({ query: 'AI', limit: 10 }, { page: mockPage });
      expect(result.data).toHaveLength(1);
    });
  });
});
