import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/zhihu/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function createMockPage(evaluateResult: unknown = {}) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    evaluate: vi.fn(() => evaluateResult),
  };
}

describe('zhihu plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'zhihu',
        url: 'https://www.zhihu.com',
        requiresLogin: false,
      })
    );
  });

  it('should register 5 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(5);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['search', 'trending', 'question', 'answer', 'article']));
  });

  describe('search command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ query: 'test', type: 'all', limit: 10 }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return search results', async () => {
      const items = [{ title: 'T1', excerpt: 'E1', author: 'A1', link: '', type: 'answer' }];
      const mockPage = createMockPage(items);
      const result = await handler({ query: 'test', type: 'all', limit: 10 }, { page: mockPage });
      expect(result.data.results).toHaveLength(1);
      expect(result.data.query).toBe('test');
    });
  });

  describe('trending command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'trending');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ limit: 20 }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return trending items', async () => {
      const items = [{ rank: 1, title: 'Hot1', hotScore: '100万', link: '' }];
      const mockPage = createMockPage(items);
      const result = await handler({ limit: 20 }, { page: mockPage });
      expect(result.data.items).toHaveLength(1);
    });
  });

  describe('question command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'question');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ url: 'https://zhihu.com/question/1', limit: 5 }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return question and answers', async () => {
      const data = { title: 'Q1', detail: 'detail', answers: [{ author: 'A', content: 'C', upvotes: '10' }] };
      const mockPage = createMockPage(data);
      const result = await handler({ url: 'https://zhihu.com/question/1', limit: 5 }, { page: mockPage });
      expect(result.data.title).toBe('Q1');
      expect(result.data.answers).toHaveLength(1);
    });
  });
});
