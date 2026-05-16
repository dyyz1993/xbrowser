import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../.xcli/plugins/twitter/index.ts';

const responseHandlers: Array<(resp: any) => void> = [];

function createMockPage() {
  responseHandlers.length = 0;
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
    waitForResponse: vi.fn().mockResolvedValue(null),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'response') responseHandlers.push(handler);
    }),
    off: vi.fn((event: string, handler: any) => {
      if (event === 'response') {
        const idx = responseHandlers.indexOf(handler);
        if (idx >= 0) responseHandlers.splice(idx, 1);
      }
    }),
  };
}

function emitResponse(resp: any) {
  for (const h of [...responseHandlers]) h(resp);
}

let mockSite: ReturnType<typeof createMockSite>['site'];
let mockXCLI: any;
let commands: Map<string, any>;
let loginHandler: any;
let logoutHandler: any;

function createMockSite() {
  const cmds = new Map<string, any>();
  let loginFn: any;
  let logoutFn: any;
  const site = {
    command: vi.fn((name: string, config: any) => { cmds.set(name, config); }),
    login: vi.fn((fn: any) => { loginFn = fn; }),
    logout: vi.fn((fn: any) => { logoutFn = fn; }),
  };
  return { site, cmds, getLogin: () => loginFn, getLogout: () => logoutFn };
}

beforeEach(() => {
  vi.clearAllMocks();
  const m = createMockSite();
  mockSite = m.site;
  mockXCLI = { createSite: vi.fn(() => mockSite) };
  commands = m.cmds;
  plugin(mockXCLI);
  loginHandler = m.getLogin();
  logoutHandler = m.getLogout();
});

function makeTweetEntry(id: string, text: string, extra: Record<string, any> = {}) {
  return {
    content: {
      itemContent: {
        tweet_results: {
          result: {
            rest_id: id,
            legacy: {
              full_text: text,
              favorite_count: '0',
              retweet_count: '0',
              reply_count: '0',
              lang: 'en',
              ...extra,
            },
          },
        },
      },
    },
  };
}

describe('Twitter Plugin', () => {
  describe('Plugin Registration', () => {
    it('should register twitter site with correct config', () => {
      expect(mockXCLI.createSite).toHaveBeenCalledWith({
        name: 'twitter',
        url: 'https://x.com',
        description: 'X (Twitter) - 社交媒体内容采集（XHR 拦截模式，数据更丰富）',
        requiresLogin: true,
      });
    });

    it('should register 6 commands', () => {
      expect(mockSite.command).toHaveBeenCalledTimes(6);
    });

    it('should register expected command names', () => {
      const names = Array.from(commands.keys());
      expect(names).toEqual(['search', 'profile', 'timeline', 'replies', 'liked', 'search-image']);
    });

    it('should register login and logout handlers', () => {
      expect(mockSite.login).toHaveBeenCalledTimes(1);
      expect(mockSite.logout).toHaveBeenCalledTimes(1);
    });

    it('all commands should have scope browser', () => {
      for (const [, cfg] of commands) {
        expect(cfg.scope).toBe('browser');
      }
    });
  });

  describe('Command: search', () => {
    it('should navigate to search URL with encoded query', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('search')!.handler;

      await handler({ query: 'OpenAI test', limit: 10 }, { page, sessionId: 's1' });

      expect(page.goto).toHaveBeenCalledWith(
        'https://x.com/search?q=OpenAI%20test&src=typed_query&f=top',
        { waitUntil: 'domcontentloaded' },
      );
    });

    it('should return tweets from DOM scraping', async () => {
      const page = createMockPage();
      const mockTweets = [
        { author: 'User1', text: 'Hello', time: '2024-01-01T00:00:00Z', likes: '5', retweets: '1', replies: '2', link: '' },
      ];
      page.evaluate.mockResolvedValue(mockTweets);
      const handler = commands.get('search')!.handler;

      const result = await handler({ query: 'test', limit: 10 }, { page, sessionId: 's1' });

      expect(result.data.query).toBe('test');
      expect(result.data.count).toBe(1);
      expect(result.data.tweets).toEqual(mockTweets);
    });

    it('should pass limit to evaluate', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('search')!.handler;

      await handler({ query: 'x', limit: 5 }, { page, sessionId: 's1' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 5);
    });

    it('should include session ID in tips', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('search')!.handler;

      const result = await handler({ query: 'x', limit: 10 }, { page, sessionId: 'my-session' });

      expect(result.tips).toContain('Session: my-session');
    });

    it('should throw when no page provided', async () => {
      const handler = commands.get('search')!.handler;
      await expect(handler({ query: 'x', limit: 10 }, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('Command: profile', () => {
    it('should navigate to user profile URL', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue({ name: 'TestUser', bio: '', source: 'dom' });
      const handler = commands.get('profile')!.handler;

      await handler({ username: 'elonmusk' }, { page, sessionId: 's1' });

      expect(page.goto).toHaveBeenCalledWith(
        'https://x.com/elonmusk',
        { waitUntil: 'domcontentloaded' },
      );
    });

    it('should capture UserByScreenName API response', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue({ name: 'Dom', bio: '', source: 'dom' });
      const profilePayload = {
        data: {
          user: {
            result: {
              rest_id: '123',
              legacy: {
                name: 'Elon Musk',
                screen_name: 'elonmusk',
                description: 'Mars',
                location: '',
                url: '',
                followers_count: 100,
                friends_count: 50,
                statuses_count: 1000,
                listed_count: 10,
                media_count: 5,
                created_at: '2009-01-01',
                profile_image_url_https: 'https://img.normal.jpg',
                profile_banner_url: 'https://banner.jpg',
                verified: true,
                fast_followers_count: 0,
                normal_followers_count: 100,
                favourites_count: 500,
                wants_to_be_notified: false,
              },
              has_custom_timelines: true,
              is_blue_verified: true,
            },
          },
        },
      };
      page.waitForTimeout.mockImplementation(async () => {
        emitResponse({
          url: () => 'https://x.com/i/api/graphql/UserByScreenName?variables=...',
          text: async () => JSON.stringify(profilePayload),
        });
      });
      const handler = commands.get('profile')!.handler;

      const result = await handler({ username: 'elonmusk' }, { page, sessionId: 's1' });

      expect(result.data.name).toBe('Elon Musk');
      expect(result.data.screenName).toBe('elonmusk');
      expect(result.data.followersCount).toBe(100);
      expect(result.data.verified).toBe(true);
    });

    it('should fall back to DOM when no API data', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue({ name: 'DomUser', bio: 'Hello', source: 'dom' });
      const handler = commands.get('profile')!.handler;

      const result = await handler({ username: 'testuser' }, { page, sessionId: 's1' });

      expect(result.data.name).toBe('DomUser');
      expect(result.data.source).toBe('dom');
    });

    it('should include username in tips', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue({ name: 'TestUser', bio: '' });
      const handler = commands.get('profile')!.handler;

      const result = await handler({ username: 'testuser' }, { page, sessionId: 's1' });

      expect(result.tips).toEqual(expect.arrayContaining([expect.stringContaining('用户: TestUser')]));
    });

    it('should throw when no page provided', async () => {
      const handler = commands.get('profile')!.handler;
      await expect(handler({ username: 'x' }, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('Command: timeline', () => {
    it('should navigate to user timeline URL', async () => {
      const page = createMockPage();
      page.waitForResponse.mockResolvedValue(null);
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('timeline')!.handler;

      await handler({ username: 'elonmusk', limit: 5 }, { page, sessionId: 's1' });

      expect(page.goto).toHaveBeenCalledWith(
        'https://x.com/elonmusk',
        { waitUntil: 'domcontentloaded' },
      );
    });

    it('should capture UserTweets API response', async () => {
      const page = createMockPage();
      const timelinePayload = {
        data: {
          user: {
            result: {
              timeline_v2: {
                timeline: {
                  instructions: [{
                    entries: [makeTweetEntry('111', 'Hello world', {
                      favorite_count: '10',
                      retweet_count: '5',
                      extended_entities: { media: [{ media_url_https: 'https://img.jpg' }] },
                    })],
                  }],
                },
              },
            },
          },
        },
      };
      page.waitForResponse.mockResolvedValue({
        url: () => 'https://x.com/i/api/graphql/UserTweets',
        status: () => 200,
        text: async () => JSON.stringify(timelinePayload),
      });
      page.evaluate.mockResolvedValue(undefined);
      const handler = commands.get('timeline')!.handler;

      const result = await handler({ username: 'elonmusk', limit: 5 }, { page, sessionId: 's1' });

      expect(result.data.source).toBe('api');
      expect(result.data.username).toBe('elonmusk');
      expect(result.data.tweets).toHaveLength(1);
      expect(result.data.tweets[0].text).toBe('Hello world');
    });

    it('should fall back to DOM scraping when no API response', async () => {
      const page = createMockPage();
      page.waitForResponse.mockResolvedValue(null);
      let evalCallCount = 0;
      page.evaluate.mockImplementation(() => {
        evalCallCount++;
        if (evalCallCount <= 3) return Promise.resolve(undefined);
        return Promise.resolve([
          { text: 'DOM tweet', time: '2024-01-01', likes: '3' },
        ]);
      });
      const handler = commands.get('timeline')!.handler;

      const result = await handler({ username: 'test', limit: 5 }, { page, sessionId: 's1' });

      expect(result.data.source).toBe('dom(api fallback)');
      expect(result.data.tweets).toHaveLength(1);
      expect(result.data.tweets[0].text).toBe('DOM tweet');
    });

    it('should scroll the page', async () => {
      const page = createMockPage();
      page.waitForResponse.mockResolvedValue(null);
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('timeline')!.handler;

      await handler({ username: 'test', limit: 5 }, { page, sessionId: 's1' });

      expect(page.evaluate).toHaveBeenCalled();
    });

    it('should throw when no page provided', async () => {
      const handler = commands.get('timeline')!.handler;
      await expect(handler({ username: 'x', limit: 5 }, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('Command: replies', () => {
    it('should navigate to tweet status URL', async () => {
      const page = createMockPage();
      const handler = commands.get('replies')!.handler;

      await handler({ id: '123456', limit: 5 }, { page, sessionId: 's1' });

      expect(page.goto).toHaveBeenCalledWith(
        'https://x.com/i/status/123456',
        { waitUntil: 'domcontentloaded' },
      );
    });

    it('should capture TweetDetail API response', async () => {
      const page = createMockPage();
      const repliesPayload = {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [{
              entries: [
                makeTweetEntry('r1', 'Reply text', { user_id_str: 'u1', created_at: '2024-01-01', favorite_count: '5', retweet_count: '1', reply_count: '0' }),
                makeTweetEntry('r2', 'Reply 2', { user_id_str: 'u2', created_at: '2024-01-02', favorite_count: '2', retweet_count: '0', reply_count: '3', lang: 'zh' }),
              ],
            }],
          },
        },
      };
      page.waitForTimeout.mockImplementation(async () => {
        emitResponse({
          url: () => 'https://x.com/i/api/graphql/TweetDetail?variables=...',
          text: async () => JSON.stringify(repliesPayload),
        });
      });
      const handler = commands.get('replies')!.handler;

      const result = await handler({ id: '123456', limit: 5 }, { page, sessionId: 's1' });

      expect(result.data.tweetId).toBe('123456');
      expect(result.data.replies).toHaveLength(2);
      expect(result.data.replies[0].text).toBe('Reply text');
      expect(result.data.replies[1].id).toBe('r2');
    });

    it('should return empty replies when no API data captured', async () => {
      const page = createMockPage();
      const handler = commands.get('replies')!.handler;

      const result = await handler({ id: '999', limit: 5 }, { page, sessionId: 's1' });

      expect(result.data.tweetId).toBe('999');
      expect(result.data.count).toBe(0);
      expect(result.data.replies).toEqual([]);
    });

    it('should include reply count in tips', async () => {
      const page = createMockPage();
      const repliesPayload = {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [{
              entries: [makeTweetEntry('r1', 'R', { user_id_str: 'u1', created_at: '' })],
            }],
          },
        },
      };
      page.waitForTimeout.mockImplementation(async () => {
        emitResponse({
          url: () => 'TweetDetail',
          text: async () => JSON.stringify(repliesPayload),
        });
      });
      const handler = commands.get('replies')!.handler;

      const result = await handler({ id: '123', limit: 5 }, { page, sessionId: 's1' });

      expect(result.tips).toContain('找到 1 条回复');
    });

    it('should throw when no page provided', async () => {
      const handler = commands.get('replies')!.handler;
      await expect(handler({ id: 'x', limit: 5 }, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('Command: liked', () => {
    it('should navigate to user likes URL', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('liked')!.handler;

      await handler({ username: 'elonmusk', limit: 5 }, { page, sessionId: 's1' });

      expect(page.goto).toHaveBeenCalledWith(
        'https://x.com/elonmusk/likes',
        { waitUntil: 'domcontentloaded' },
      );
    });

    it('should return liked tweets from DOM', async () => {
      const page = createMockPage();
      const mockLiked = [
        { author: 'Author1', text: 'Liked tweet', time: '2024-01-01T00:00:00Z', likes: '10' },
        { author: 'Author2', text: 'Another liked', time: '2024-01-02T00:00:00Z', likes: '5' },
      ];
      page.evaluate.mockResolvedValue(mockLiked);
      const handler = commands.get('liked')!.handler;

      const result = await handler({ username: 'test', limit: 5 }, { page, sessionId: 's1' });

      expect(result.data.username).toBe('test');
      expect(result.data.count).toBe(2);
      expect(result.data.tweets).toEqual(mockLiked);
    });

    it('should pass limit to evaluate', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('liked')!.handler;

      await handler({ username: 'test', limit: 3 }, { page, sessionId: 's1' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 3);
    });

    it('should scroll the page', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('liked')!.handler;

      await handler({ username: 'test', limit: 5 }, { page, sessionId: 's1' });

      expect(page.evaluate).toHaveBeenCalled();
    });

    it('should throw when no page provided', async () => {
      const handler = commands.get('liked')!.handler;
      await expect(handler({ username: 'x', limit: 5 }, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('Error Handling', () => {
    it('should throw when page is missing (getPage guard)', async () => {
      const handler = commands.get('search')!.handler;
      await expect(handler({ query: 'x', limit: 10 }, {})).rejects.toThrow(
        '需要浏览器页面，请使用 --cdp 参数连接',
      );
    });

    it('should include cdp tip when no cdpEndpoint provided', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('search')!.handler;

      const result = await handler({ query: 'x', limit: 10 }, { page, sessionId: 's1' });

      expect(result.tips).toContain('建议使用 --cdp 9221 连接到已登录的浏览器');
    });

    it('should not include cdp tip when cdpEndpoint is provided', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue([]);
      const handler = commands.get('search')!.handler;

      const result = await handler(
        { query: 'x', limit: 10 },
        { page, sessionId: 's1', cdpEndpoint: 'ws://localhost:9222' },
      );

      expect(result.tips).not.toContain('建议使用 --cdp 9221 连接到已登录的浏览器');
    });
  });

  describe('Login/Logout', () => {
    it('login should log warning and navigate if page available', async () => {
      const page = createMockPage();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
      await loginHandler({ page });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--cdp'));
      expect(page.goto).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('login should log warning without page', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
      await loginHandler({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--cdp'));
      consoleSpy.mockRestore();
    });

    it('logout should log warning', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
      await logoutHandler();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('手动退出'));
      consoleSpy.mockRestore();
    });
  });
});
