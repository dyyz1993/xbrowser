import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/twitter/index.ts';

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

describe('twitter plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'twitter',
        url: 'https://x.com',
        requiresLogin: false,
      })
    );
  });

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(3);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['search', 'profile', 'timeline']));
  });

  describe('search command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ query: 'OpenAI', limit: 10 }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return tweet search results', async () => {
      const tweets = [{ author: 'User', handle: '@user', text: 'Hello', time: '2024-01-01', likes: '10', retweets: '2', link: '' }];
      const mockPage = createMockPage(tweets);
      const result = await handler({ query: 'OpenAI', limit: 10 }, { page: mockPage });
      expect(result.data.tweets).toHaveLength(1);
      expect(result.data.query).toBe('OpenAI');
    });

    it('should navigate to search URL', async () => {
      const mockPage = createMockPage([]);
      await handler({ query: 'test', limit: 5 }, { page: mockPage });
      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining('x.com/search'),
        expect.anything()
      );
    });
  });

  describe('profile command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'profile');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ username: 'elonmusk' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return profile data', async () => {
      const data = { name: 'Elon Musk', bio: 'Mars', location: 'Mars', website: '', stats: {}, avatar: '' };
      const mockPage = createMockPage(data);
      const result = await handler({ username: 'elonmusk' }, { page: mockPage });
      expect(result.data.name).toBe('Elon Musk');
    });
  });

  describe('timeline command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'timeline');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ username: 'elonmusk', limit: 5 }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should return timeline tweets', async () => {
      const tweets = [{ text: 'Hello', time: '2024-01-01', likes: '10', replies: '2', link: '' }];
      const mockPage = createMockPage(tweets);
      const result = await handler({ username: 'elonmusk', limit: 5 }, { page: mockPage });
      expect(result.data.tweets).toHaveLength(1);
      expect(result.data.username).toBe('elonmusk');
    });

    it('should scroll page for loading', async () => {
      const mockPage = createMockPage([]);
      await handler({ username: 'test', limit: 5 }, { page: mockPage });
      expect(mockPage.evaluate).toHaveBeenCalledTimes(4);
    });
  });
});
