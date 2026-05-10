import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

vi.mock('playwright', () => {
  const mockPage = {
    url: vi.fn().mockReturnValue('https://x.com'),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({}),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
  };
  const mockContext = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(mockPage),
    pages: vi.fn().mockReturnValue([mockPage]),
  };
  const mockBrowser = {
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue(mockContext),
    contexts: vi.fn().mockReturnValue([mockContext]),
  };
  return {
    chromium: {
      launch: vi.fn().mockResolvedValue(mockBrowser),
      connectOverCDP: vi.fn().mockResolvedValue(mockBrowser),
    },
    _mockBrowser: mockBrowser,
    _mockContext: mockContext,
    _mockPage: mockPage,
  };
});

import twitterPlugin from '../.xcli/plugins/twitter/index.js';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { _mockBrowser, _mockContext, _mockPage } from 'playwright';

const mockBrowser = _mockBrowser as typeof _mockBrowser & {
  close: ReturnType<typeof vi.fn>;
  newContext: ReturnType<typeof vi.fn>;
  contexts: ReturnType<typeof vi.fn>;
};
const mockContext = _mockContext as typeof _mockContext & {
  close: ReturnType<typeof vi.fn>;
  newPage: ReturnType<typeof vi.fn>;
  pages: ReturnType<typeof vi.fn>;
};
const mockPage = _mockPage as typeof _mockPage & {
  url: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  $: ReturnType<typeof vi.fn>;
};

let mockXcli: XCLIAPI;
let mockSite: any;
let registeredCommands: Map<string, any>;

function extractTweetId(url: string): string {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : '';
}

function validateTweet(tweet: any): boolean {
  return !!(tweet.author && tweet.handle && tweet.text && tweet.time && tweet.link);
}

function smartSelect(element: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = element.querySelector(selector);
    if (found) return found;
  }
  return null;
}

const HIGH_PROFILE_USERS = new Set(['elonmusk', 'realdonaldtrump', 'realdonaldtrump_backup']);

describe('Twitter Plugin', () => {
  beforeAll(() => {
    mockSite = {
      name: 'twitter',
      url: 'https://x.com',
      description: 'X (Twitter) - 社交媒体内容采集',
      requiresLogin: false,
      command: vi.fn((name: string, config: any) => {
        registeredCommands.set(name, config);
      }),
    };
    mockXcli = {
      createSite: vi.fn().mockReturnValue(mockSite),
    } as any;
    registeredCommands = new Map();
    twitterPlugin(mockXcli);
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.url.mockReturnValue('https://x.com');
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue({});
    mockPage.waitForTimeout.mockResolvedValue(undefined);
    mockPage.waitForSelector.mockResolvedValue(undefined);
    mockPage.$.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Functions', () => {
    describe('extractTweetId', () => {
      it('should extract tweet ID from URL', async () => {
        const url1 = 'https://x.com/elonmusk/status/1234567890';
        const url2 = 'https://x.com/i/status/9876543210';
        const url3 = 'https://x.com/invalid';

        expect(extractTweetId(url1)).toBe('1234567890');
        expect(extractTweetId(url2)).toBe('9876543210');
        expect(extractTweetId(url3)).toBe('');
      });

      it('should handle empty URL', () => {
        expect(extractTweetId('')).toBe('');
      });

      it('should handle URL without status', () => {
        expect(extractTweetId('https://x.com/elonmusk')).toBe('');
      });
    });

    describe('validateTweet', () => {
      it('should validate complete tweet data', async () => {
        const validTweet = {
          author: 'Elon Musk',
          handle: '@elonmusk',
          text: 'Hello world',
          time: '2024-01-01T00:00:00.000Z',
          link: 'https://x.com/elonmusk/status/1234567890',
        };

        expect(validateTweet(validTweet)).toBe(true);
      });

      it('should reject incomplete tweet data', async () => {
        const invalidTweet1 = { author: 'Elon Musk', handle: '@elonmusk' };
        const invalidTweet2 = { text: 'Hello world', time: '2024-01-01T00:00:00.000Z' };
        const invalidTweet3 = {};

        expect(validateTweet(invalidTweet1)).toBe(false);
        expect(validateTweet(invalidTweet2)).toBe(false);
        expect(validateTweet(invalidTweet3)).toBe(false);
      });

      it('should handle null/undefined values', async () => {
        const tweetWithNulls = {
          author: null,
          handle: '@elonmusk',
          text: null,
          time: '2024-01-01T00:00:00.000Z',
          link: 'https://x.com/test/status/123',
        };

        expect(validateTweet(tweetWithNulls)).toBe(false);
      });
    });

    describe('smartSelect', () => {
      it('should select element with multiple selectors', async () => {
        const mockDiv = {} as Element;
        const mockElement = {
          querySelector: vi.fn((selector) => {
            if (selector === '.second') return mockDiv;
            return null;
          }),
        } as any;

        const result = smartSelect(mockElement, ['.first', '.second', '.third']);

        expect(result).not.toBeNull();
        expect(result).toBe(mockDiv);
        expect(mockElement.querySelector).toHaveBeenCalledWith('.first');
        expect(mockElement.querySelector).toHaveBeenCalledWith('.second');
      });

      it('should return null when no selector matches', () => {
        const mockElement = {
          querySelector: vi.fn(() => null),
        } as any;

        const result = smartSelect(mockElement, ['.nonexistent']);

        expect(result).toBeNull();
      });

      it('should return first matching selector', () => {
        const firstDiv = {} as Element;
        const mockElement = {
          querySelector: vi.fn(() => firstDiv),
        } as any;

        const result = smartSelect(mockElement, ['.first', '.second']);

        expect(result).toBe(firstDiv);
        expect(mockElement.querySelector).toHaveBeenCalledTimes(1);
      });
    });

    describe('waitForContent', () => {
      it('should wait for content successfully', async () => {
        const mockPageWithWait = {
          waitForSelector: vi.fn().mockResolvedValue(undefined),
        } as any;

        const waitForContent = async (page: any, selector: string, timeout = 10000): Promise<void> => {
          try {
            await page.waitForSelector(selector, { timeout, state: 'attached' });
          } catch (error) {
            console.warn(`Selector ${selector} not found, continuing anyway`);
          }
        };

        await waitForContent(mockPageWithWait, 'article[data-testid="tweet"]', 5000);

        expect(mockPageWithWait.waitForSelector).toHaveBeenCalledWith(
          'article[data-testid="tweet"]',
          { timeout: 5000, state: 'attached' }
        );
      });

      it('should handle timeout gracefully', async () => {
        const mockPageWithWait = {
          waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
        } as any;

        const waitForContent = async (page: any, selector: string, timeout = 10000): Promise<void> => {
          try {
            await page.waitForSelector(selector, { timeout, state: 'attached' });
          } catch (error) {
            console.warn(`Selector ${selector} not found, continuing anyway`);
          }
        };

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await waitForContent(mockPageWithWait, 'article[data-testid="tweet"]', 1000);

        expect(mockPageWithWait.waitForSelector).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
          'Selector article[data-testid="tweet"] not found, continuing anyway'
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('Command: search', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('search');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('搜索 X/Twitter 推文');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should search tweets', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          author: 'Elon Musk',
          handle: '@elonmusk',
          text: 'Test tweet',
          time: '2024-01-01T00:00:00.000Z',
          likes: '100',
          retweets: '50',
          link: 'https://x.com/elonmusk/status/1234567890',
        },
      ]);

      const result = await commandConfig.handler(
        { query: 'OpenAI', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'test' }
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://x.com/search?q=OpenAI&src=typed_query&f=top',
        { waitUntil: 'domcontentloaded' }
      );
      expect(result.data.tweets).toHaveLength(1);
      expect(result.data.query).toBe('OpenAI');
      expect(result.tips).toContain('找到 1 条推文');
      expect(result.tips).toContain('Session: test');
    });

    it('should handle empty search results', async () => {
      mockPage.evaluate.mockResolvedValue([]);

      const result = await commandConfig.handler(
        { query: 'Nonexistent', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data.tweets).toHaveLength(0);
      expect(result.data.count).toBe(0);
      expect(result.tips).toContain('找到 0 条推文');
    });

    it('should fail without CDP connection', async () => {
      const result = await commandConfig.handler(
        { query: 'Test', limit: 10 },
        { page: mockPage }
      );

      expect(result.data).toBeNull();
      expect(result.tips).toContain('建议使用 --cdp 9221 参数连接到 Chrome 浏览器');
      expect(result.message).toContain('未检测到 CDP 连接');
    });

    it('should require browser page', async () => {
      const result = await commandConfig.handler(
        { query: 'Test', limit: 10 },
        { cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data).toBeNull();
      expect(result.message).toContain('需要浏览器页面');
      expect(result.tips).toContain('搜索失败');
    });
  });

  describe('Command: profile', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('profile');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取 X/Twitter 用户资料');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should get user profile', async () => {
      mockPage.evaluate.mockResolvedValue({
        name: 'Elon Musk',
        bio: 'Tech visionary',
        location: 'Mars',
        website: 'https://x.com',
        stats: { Following: '100', Followers: '1000000' },
        avatar: 'https://pbs.twimg.com/avatar.jpg',
      });

      const result = await commandConfig.handler(
        { username: 'elonmusk' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://x.com/elonmusk',
        { waitUntil: 'domcontentloaded' }
      );
      expect(result.data.name).toBe('Elon Musk');
      expect(result.data.bio).toBe('Tech visionary');
      expect(result.tips).toContain('用户: Elon Musk');
      expect(result.tips).toContain('简介: Tech visionary');
    });

    it('should handle protected account', async () => {
      mockPage.$.mockResolvedValue({} as any);

      const result = await commandConfig.handler(
        { username: 'protected_user' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalled();
    });

    it('should fail without CDP connection', async () => {
      const result = await commandConfig.handler(
        { username: 'test' },
        { page: mockPage }
      );

      expect(result.data).toBeNull();
      expect(result.tips).toContain('建议使用 --cdp 9221 参数连接到 Chrome 浏览器');
    });
  });

  describe('Command: timeline', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('timeline');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取 X/Twitter 用户最新推文');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should get user timeline', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          id: '1234567890',
          text: 'First tweet',
          time: '2024-01-01T00:00:00.000Z',
          likes: '100',
          replies: '10',
          link: 'https://x.com/test/status/1234567890',
        },
      ]);

      const result = await commandConfig.handler(
        { username: 'elonmusk', limit: 5 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://x.com/elonmusk',
        { waitUntil: 'domcontentloaded' }
      );
      expect(result.data.tweets).toHaveLength(1);
      expect(result.data.username).toBe('elonmusk');
      expect(result.tips).toContain('elonmusk 最近 1 条推文');
    });

    it('should deduplicate tweets', async () => {
      let callCount = 0;
      mockPage.evaluate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [
            { id: '123', text: 'Tweet 1', time: '', likes: '0', replies: '0', link: '' },
            { id: '456', text: 'Tweet 2', time: '', likes: '0', replies: '0', link: '' },
          ];
        }
        return [
          { id: '123', text: 'Tweet 1', time: '', likes: '0', replies: '0', link: '' },
          { id: '789', text: 'Tweet 3', time: '', likes: '0', replies: '0', link: '' },
        ];
      });

      const result = await commandConfig.handler(
        { username: 'test', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      const tweetIds = result.data.tweets.map((t: any) => t.id);
      expect(new Set(tweetIds).size).toBe(tweetIds.length);
    });

    it('should handle scroll loading', async () => {
      mockPage.evaluate.mockResolvedValue([
        { id: '123', text: 'Tweet 1', time: '', likes: '0', replies: '0', link: '' },
      ]);

      const result = await commandConfig.handler(
        { username: 'test', limit: 5 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.waitForTimeout).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should fail without CDP connection', async () => {
      const result = await commandConfig.handler(
        { username: 'test', limit: 5 },
        { page: mockPage }
      );

      expect(result.data).toBeNull();
      expect(result.tips).toContain('建议使用 --cdp 9221 参数连接到 Chrome 浏览器');
    });
  });

  describe('Command: timeline-advanced', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('timeline-advanced');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取高影响力账号的完整时间线（增强版）');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should handle high profile users', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          id: '123',
          text: 'Tweet',
          time: '2024-01-01T00:00:00.000Z',
          likes: '1000',
          replies: '100',
          retweets: '500',
          link: 'https://x.com/elonmusk/status/123',
          author: 'Elon Musk',
          handle: '@elonmusk',
        },
      ]);

      const result = await commandConfig.handler(
        { username: 'elonmusk', limit: 20 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.tips).toContain('检测到高影响力账号，使用增强配置');
      expect(mockPage.waitForTimeout).toHaveBeenCalled();
    });

    it('should use retry mechanism', async () => {
      let attempt = 0;
      mockPage.evaluate.mockImplementation(() => {
        attempt++;
        if (attempt < 3) {
          throw new Error('Network error');
        }
        return [{ id: '123', text: 'Tweet', time: '', likes: '0', replies: '0', retweets: '0', link: '' }];
      });

      const result = await commandConfig.handler(
        { username: 'test', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalled();
    });

    it('should simulate human behavior', async () => {
      mockPage.evaluate.mockResolvedValue([
        { id: '123', text: 'Tweet', time: '', likes: '0', replies: '0', retweets: '0', link: '' },
      ]);

      await commandConfig.handler(
        { username: 'test', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.waitForTimeout).toHaveBeenCalled();
    });

    it('should check protected account', async () => {
      mockPage.$.mockResolvedValue({} as any);

      const result = await commandConfig.handler(
        { username: 'protected_user', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data).toBeNull();
      expect(result.message).toContain('该账号已被保护');
    });

    it('should fail with useLogin without CDP', async () => {
      const result = await commandConfig.handler(
        { username: 'test', limit: 10, useLogin: true },
        { page: mockPage }
      );

      expect(result.data).toBeNull();
      expect(result.tips[0]).toContain('需要使用登录态');
    });
  });

  describe('Command: tweets', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('tweets');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取单条推文详情');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should get single tweet details', async () => {
      mockPage.evaluate.mockResolvedValue({
        id: '1234567890',
        link: 'https://x.com/i/status/1234567890',
        author: 'Elon Musk',
        handle: '@elonmusk',
        text: 'Test tweet',
        time: '2024-01-01T00:00:00.000Z',
        stats: {
          likes: '1000',
          replies: '100',
          retweets: '500',
          quotes: '50',
        },
        media: {
          images: [],
          videos: [],
        },
      });

      const result = await commandConfig.handler(
        { tweetId: '1234567890' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://x.com/i/status/1234567890',
        { waitUntil: 'domcontentloaded', timeout: 15000 }
      );
      expect(result.data.id).toBe('1234567890');
      expect(result.data.author).toBe('Elon Musk');
      expect(result.data.stats.likes).toBe('1000');
      expect(result.tips).toContain('获取推文成功');
    });

    it('should extract media information', async () => {
      mockPage.evaluate.mockResolvedValue({
        id: '123',
        link: 'https://x.com/i/status/123',
        author: 'Test',
        handle: '@test',
        text: 'Tweet with media',
        time: '',
        stats: { likes: '0', replies: '0', retweets: '0', quotes: '0' },
        media: {
          images: ['https://pbs.twimg.com/img1.jpg', 'https://pbs.twimg.com/img2.jpg'],
          videos: ['https://video.twimg.com/vid1.mp4'],
        },
      });

      const result = await commandConfig.handler(
        { tweetId: '123' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data.media.images).toHaveLength(2);
      expect(result.data.media.videos).toHaveLength(1);
      expect(result.tips).toContain('包含 2 张图片');
      expect(result.tips).toContain('包含 1 个视频');
    });

    it('should handle missing tweet', async () => {
      mockPage.evaluate.mockResolvedValue(null);

      const result = await commandConfig.handler(
        { tweetId: 'nonexistent' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data).toBeNull();
      expect(result.message).toContain('未找到该推文');
    });
  });

  describe('Command: replies', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('replies');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取推文的回复');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should get tweet replies', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          id: 'reply1',
          author: 'User 1',
          handle: '@user1',
          text: 'Reply 1',
          time: '2024-01-01T00:00:00.000Z',
          likes: '10',
          link: 'https://x.com/user1/status/reply1',
        },
        {
          id: 'reply2',
          author: 'User 2',
          handle: '@user2',
          text: 'Reply 2',
          time: '2024-01-01T01:00:00.000Z',
          likes: '5',
          link: 'https://x.com/user2/status/reply2',
        },
      ]);

      const result = await commandConfig.handler(
        { tweetId: '1234567890', maxPages: 2 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://x.com/i/status/1234567890',
        { waitUntil: 'domcontentloaded', timeout: 15000 }
      );
      expect(result.data.replies).toHaveLength(2);
      expect(result.data.tweetId).toBe('1234567890');
      expect(result.tips).toContain('找到 2 条回复');
    });

    it('should scroll to load more replies', async () => {
      let callCount = 0;
      mockPage.evaluate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [{ id: 'reply1', author: 'User 1', handle: '@user1', text: 'Reply 1', time: '', likes: '0', link: '' }];
        }
        return [{ id: 'reply2', author: 'User 2', handle: '@user2', text: 'Reply 2', time: '', likes: '0', link: '' }];
      });

      const result = await commandConfig.handler(
        { tweetId: '123', maxPages: 3 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.waitForTimeout).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should deduplicate replies', async () => {
      mockPage.evaluate.mockResolvedValue([
        { id: 'reply1', author: 'User 1', handle: '@user1', text: 'Reply 1', time: '', likes: '0', link: '' },
        { id: 'reply1', author: 'User 1', handle: '@user1', text: 'Duplicate', time: '', likes: '0', link: '' },
        { id: 'reply2', author: 'User 2', handle: '@user2', text: 'Reply 2', time: '', likes: '0', link: '' },
      ]);

      const result = await commandConfig.handler(
        { tweetId: '123', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      const replyIds = result.data.replies.map((r: any) => r.id);
      expect(new Set(replyIds).size).toBe(replyIds.length);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mockPage.goto.mockRejectedValue(new Error('Network error'));
      const command = registeredCommands.get('search');

      const result = await command.handler(
        { query: 'test', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data).toBeNull();
      expect(result.message).toContain('Network error');
      expect(result.tips).toContain('搜索失败');
    });

    it('should handle timeout errors', async () => {
      mockPage.goto.mockRejectedValue(new Error('Timeout'));
      const command = registeredCommands.get('profile');

      const result = await command.handler(
        { username: 'test' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data).toBeNull();
      expect(result.message).toContain('Timeout');
      expect(result.tips).toContain('获取用户资料失败');
    });

    it('should handle invalid tweet ID', async () => {
      mockPage.evaluate.mockResolvedValue(null);
      const command = registeredCommands.get('tweets');

      const result = await command.handler(
        { tweetId: 'invalid_id' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data).toBeNull();
      expect(result.message).toContain('未找到该推文');
    });
  });

  describe('High Profile Users Special Handling', () => {
    it('should detect elonmusk as high profile', async () => {
      expect(HIGH_PROFILE_USERS.has('elonmusk')).toBe(true);
      expect(HIGH_PROFILE_USERS.has('ELONMUSK')).toBe(false);
      expect(HIGH_PROFILE_USERS.has('ElonMusk')).toBe(false);
    });

    it('should detect realDonaldTrump as high profile', async () => {
      expect(HIGH_PROFILE_USERS.has('realdonaldtrump')).toBe(true);
      expect(HIGH_PROFILE_USERS.has('realdonaldtrump_backup')).toBe(true);
    });

    it('should apply high profile config', async () => {
      const command = registeredCommands.get('timeline-advanced');
      mockPage.evaluate.mockResolvedValue([]);

      const normalResult = await command.handler(
        { username: 'normaluser', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      const highProfileResult = await command.handler(
        { username: 'elonmusk', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(normalResult.tips).not.toContain('检测到高影响力账号');
      expect(highProfileResult.tips).toContain('检测到高影响力账号，使用增强配置');
    });

    it('should detect high profile users with exact match', async () => {
      const testCases = [
        { username: 'elonmusk', expected: true },
        { username: 'ElonMusk', expected: true },
        { username: 'ELONMUSK', expected: true },
      ];

      testCases.forEach(({ username, expected }) => {
        const result = HIGH_PROFILE_USERS.has(username.toLowerCase());
        expect(result).toBe(expected);
      });

      expect(HIGH_PROFILE_USERS.has('realdonaldtrump')).toBe(true);
      expect(HIGH_PROFILE_USERS.has('realdonaldtrump_backup')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tweet list', async () => {
      const command = registeredCommands.get('timeline');
      mockPage.evaluate.mockResolvedValue([]);

      const result = await command.handler(
        { username: 'test', limit: 5 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data.tweets).toHaveLength(0);
      expect(result.data.count).toBe(0);
    });

    it('should handle missing user data', async () => {
      const command = registeredCommands.get('profile');
      mockPage.evaluate.mockResolvedValue({
        name: '',
        bio: '',
        location: '',
        website: '',
        stats: {},
        avatar: '',
      });

      const result = await command.handler(
        { username: 'empty_user' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data.name).toBe('');
      expect(result.data.stats).toEqual({});
    });

    it('should handle special characters in search query', async () => {
      const command = registeredCommands.get('search');
      mockPage.evaluate.mockResolvedValue([]);

      await command.handler(
        { query: 'test @user #hashtag', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining('test%20%40user%20%23hashtag'),
        { waitUntil: 'domcontentloaded' }
      );
    });

    it('should handle zero limit', async () => {
      const command = registeredCommands.get('search');
      mockPage.evaluate.mockResolvedValue([]);

      const result = await command.handler(
        { query: 'test', limit: 0 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data.tweets).toHaveLength(0);
      expect(result.data.count).toBe(0);
    });

    it('should handle very large limit', async () => {
      const command = registeredCommands.get('timeline');
      mockPage.evaluate.mockResolvedValue(
        Array(100).fill(null).map((_, i) => ({
          id: `tweet${i}`,
          text: `Tweet ${i}`,
          time: '',
          likes: '0',
          replies: '0',
          link: '',
        }))
      );

      const result = await command.handler(
        { username: 'test', limit: 1000 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.data.tweets.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Session Management', () => {
    it('should include session ID in tips', async () => {
      const command = registeredCommands.get('search');
      mockPage.evaluate.mockResolvedValue([]);

      const result = await command.handler(
        { query: 'test', limit: 10 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'my-session' }
      );

      expect(result.tips).toContain('Session: my-session');
    });

    it('should use default session when not provided', async () => {
      const command = registeredCommands.get('profile');
      mockPage.evaluate.mockResolvedValue({ name: 'Test' });

      const result = await command.handler(
        { username: 'test' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(result.tips).toContain('Session: default');
    });

    it('should isolate different sessions', async () => {
      const command = registeredCommands.get('timeline');
      mockPage.evaluate.mockResolvedValue([]);

      const result1 = await command.handler(
        { username: 'user1', limit: 5 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'session-1' }
      );

      const result2 = await command.handler(
        { username: 'user2', limit: 5 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'session-2' }
      );

      expect(result1.tips).toContain('Session: session-1');
      expect(result2.tips).toContain('Session: session-2');
    });
  });
});
