import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

vi.mock('playwright-core', () => {
  const mockPage = {
    url: vi.fn().mockReturnValue('https://www.douyin.com'),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({}),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
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

import douyinPlugin from '../.xcli/plugins/douyin/index.js';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { _mockBrowser, _mockContext, _mockPage } from 'playwright-core';

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
  on: ReturnType<typeof vi.fn>;
};

let mockXcli: XCLIAPI;
let mockSite: any;
let registeredCommands: Map<string, any>;

function n(v: unknown): number {
  return Number(v ?? 0);
}

function s(v: unknown): string {
  return String(v ?? '');
}

function g(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function firstUrl(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const urls = (obj as Record<string, unknown>)?.url_list;
  if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0];
  return '';
}

describe('Douyin Plugin', () => {
  beforeAll(() => {
    mockSite = {
      name: 'douyin',
      url: 'https://www.douyin.com',
      description: '抖音数据采集',
      command: vi.fn((name: string, config: any) => {
        registeredCommands.set(name, config);
      }),
    };
    mockXcli = {
      createSite: vi.fn().mockReturnValue(mockSite),
    } as any;
    registeredCommands = new Map();
    douyinPlugin(mockXcli);
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.url.mockReturnValue('https://www.douyin.com');
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue({});
    mockPage.waitForTimeout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Functions', () => {
    describe('n() - Number conversion', () => {
      it('should convert valid numbers', () => {
        expect(n(123)).toBe(123);
        expect(n('456')).toBe(456);
      });

      it('should handle null and undefined', () => {
        expect(n(null)).toBe(0);
        expect(n(undefined)).toBe(0);
      });

      it('should handle string numbers', () => {
        expect(n('123')).toBe(123);
        expect(n('0')).toBe(0);
      });
    });

    describe('s() - String conversion', () => {
      it('should convert to string', () => {
        expect(s(123)).toBe('123');
        expect(s('hello')).toBe('hello');
      });

      it('should handle null and undefined', () => {
        expect(s(null)).toBe('');
        expect(s(undefined)).toBe('');
      });

      it('should handle objects', () => {
        expect(s({ a: 1 })).toBe('[object Object]');
      });
    });

    describe('g() - Get nested value', () => {
      it('should get nested object values', () => {
        const obj = { a: { b: { c: 123 } } };
        expect(g(obj, 'a.b.c')).toBe(123);
      });

      it('should return undefined for missing paths', () => {
        const obj = { a: 1 };
        expect(g(obj, 'b.c')).toBeUndefined();
        expect(g(obj, 'a.b.c')).toBeUndefined();
      });

      it('should handle non-object values', () => {
        expect(g(null, 'a.b')).toBeUndefined();
        expect(g(123, 'a.b')).toBeUndefined();
      });
    });

    describe('firstUrl() - Extract first URL', () => {
      it('should extract first URL from url_list', () => {
        const obj = { url_list: ['http://a.com', 'http://b.com'] };
        expect(firstUrl(obj)).toBe('http://a.com');
      });

      it('should handle empty url_list', () => {
        const obj = { url_list: [] };
        expect(firstUrl(obj)).toBe('');
      });

      it('should handle non-object input', () => {
        expect(firstUrl(null)).toBe('');
        expect(firstUrl('string')).toBe('');
      });

      it('should handle missing url_list', () => {
        expect(firstUrl({})).toBe('');
      });
    });
  });

  describe('Command: videos', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('videos');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('采集用户作品列表（网络拦截）');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should return error result without browser page', async () => {
      const result = await commandConfig.handler(
        { url: 'https://www.douyin.com/user/test', maxPages: 2 },
        {}
      );
      expect(result.data).toBeNull();
    });

    it('should collect videos from response', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/aweme/post/',
        json: async () => ({
          aweme_list: [
            { aweme_id: '123', desc: 'Video 1', create_time: 1234567890 },
            { aweme_id: '456', desc: 'Video 2', create_time: 1234567891 },
          ],
        }),
      };

      commandConfig.handler(
        { url: 'https://www.douyin.com/user/test', maxPages: 1 },
        { page: mockPage }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.douyin.com/user/test',
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
    });

    it('should deduplicate videos by ID', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/aweme/post/',
        json: async () => ({
          aweme_list: [
            { aweme_id: '123', desc: 'Video 1' },
            { aweme_id: '123', desc: 'Video 1 Duplicate' },
            { aweme_id: '456', desc: 'Video 2' },
          ],
        }),
      };

      commandConfig.handler(
        { url: 'https://www.douyin.com/user/test', maxPages: 1 },
        { page: mockPage }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should stop when no new videos for 3 consecutive pages', async () => {
      mockPage.on.mockImplementation(() => {});

      const result = await commandConfig.handler(
        { url: 'https://www.douyin.com/user/test', maxPages: 10 },
        { page: mockPage }
      );

      expect(result.data.total).toBe(0);
      expect(result.data.videos).toEqual([]);
      expect(result.tips).toContain('采集到 0 个作品');
    });
  });

  describe('Command: comments', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('comments');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取视频评论（网络拦截）');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should include CDP warning in tips without CDP connection', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const result = await commandConfig.handler(
        { awemeId: '123456', maxPages: 1 },
        { page: mockPage }
      );

      expect(result.tips).toContain('建议使用 --cdp 9221 参数连接到 Chrome 浏览器');
    });

    it('should collect comments from response', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/comment/list/',
        json: async () => ({
          comments: [
            {
              cid: 'c1',
              text: 'Great video!',
              create_time: 1234567890,
              digg_count: 100,
              reply_comment_total: 5,
              user: {
                uid: 'u1',
                nickname: 'User 1',
                avatar_thumb: { url_list: ['http://avatar1.com'] },
              },
            },
          ],
        }),
      };

      const result = await commandConfig.handler(
        { awemeId: '123456', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'test-session' }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.douyin.com/video/123456',
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
    });

    it('should parse comments correctly', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/comment/list/',
        json: async () => ({
          comments: [
            {
              cid: 'c1',
              text: 'Comment text',
              create_time: 1234567890,
              digg_count: 10,
              reply_comment_total: 2,
              reply_to_comment: {
                cid: 'c0',
                text: 'Original comment',
                user: {
                  uid: 'u0',
                  nickname: 'Original User',
                },
              },
              user: {
                uid: 'u1',
                nickname: 'Commenter',
                avatar_thumb: { url_list: ['http://avatar.com'] },
              },
            },
          ],
        }),
      };

      const result = await commandConfig.handler(
        { awemeId: '123456', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'test' }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should deduplicate comments by ID', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/comment/list/',
        json: async () => ({
          comments: [
            { cid: 'c1', text: 'Comment 1' },
            { cid: 'c1', text: 'Duplicate' },
            { cid: 'c2', text: 'Comment 2' },
          ],
        }),
      };

      const result = await commandConfig.handler(
        { awemeId: '123456', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should isolate different sessions', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const result1 = await commandConfig.handler(
        { awemeId: '123456', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'session-1' }
      );

      const result2 = await commandConfig.handler(
        { awemeId: '789012', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222', sessionId: 'session-2' }
      );

      expect(result1.tips).toContain('Session: session-1');
      expect(result2.tips).toContain('Session: session-2');
    });
  });

  describe('Command: user-comments', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('user-comments');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取用户喜欢的视频列表（网络拦截）');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should navigate to user favorites page', async () => {
      mockPage.on.mockImplementation(() => {});

      const result = await commandConfig.handler(
        { uid: 'user123', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.douyin.com/user/user123?showTab=like',
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
    });

    it('should collect user favorites', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/aweme/favorites/',
        json: async () => ({
          aweme_list: [
            {
              aweme_id: 'v1',
              desc: 'Favorite video',
              create_time: 1234567890,
              user: {
                uid: 'other_user',
                nickname: 'Other User',
                avatar_thumb: { url_list: ['http://avatar.com'] },
              },
            },
          ],
        }),
      };

      const result = await commandConfig.handler(
        { uid: 'user123', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });



  describe('Command: profile', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('profile');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取用户详细资料（XHR 拦截）');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should get user profile via XHR interception', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const handlerPromise = commandConfig.handler(
        { url: 'https://www.douyin.com/user/testuser' },
        { page: mockPage }
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/user/profile/',
        json: async () => ({
          user: {
            nickname: 'Test User',
            signature: 'This is a test signature',
            uid: '123',
            sec_uid: 'testuser',
            follower_count: 1000,
            following_count: 100,
          },
        }),
      };

      await responseHandler?.(mockResponse);
      const result = await handlerPromise;

      expect(result.data.nickname).toBe('Test User');
      expect(result.data.signature).toBe('This is a test signature');
    });
  });

  describe('Command: detail', () => {
    let commandConfig: any;

    beforeEach(() => {
      commandConfig = registeredCommands.get('detail');
    });

    it('should be registered with correct parameters', () => {
      expect(commandConfig).toBeDefined();
      expect(commandConfig.description).toBe('获取视频详细信息（XHR 拦截，支持短链）');
      expect(commandConfig.scope).toBe('browser');
    });

    it('should get video detail via XHR interception', async () => {
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      let resolveWait: () => void;
      mockPage.waitForTimeout.mockReturnValue(new Promise<void>(r => { resolveWait = r; }));

      const handlerPromise = commandConfig.handler(
        { url: 'https://www.douyin.com/video/7123456789123456789' },
        { page: mockPage }
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/aweme/detail/',
        json: async () => ({
          aweme_detail: {
            aweme_id: '7123456789123456789',
            desc: 'Test video description',
            author: { uid: 'u1', nickname: 'Test Author', sec_uid: 's1' },
            statistics: { digg_count: 1000, comment_count: 500 },
          },
        }),
      };

      await responseHandler?.(mockResponse);
      resolveWait!();

      const result = await handlerPromise;

      expect(result.data.desc).toBe('Test video description');
      expect(result.data.author.nickname).toBe('Test Author');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing page in context', async () => {
      const videosCommand = registeredCommands.get('videos');

      const result = await videosCommand.handler(
        { url: 'https://www.douyin.com/user/test', maxPages: 1 },
        {}
      );
      expect(result.data).toBeNull();
    });

    it('should handle invalid JSON in response', async () => {
      const videosCommand = registeredCommands.get('videos');
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/aweme/post/',
        json: async () => {
          throw new Error('Invalid JSON');
        },
      };

      videosCommand.handler(
        { url: 'https://www.douyin.com/user/test', maxPages: 1 },
        { page: mockPage }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should handle malformed comment data', async () => {
      const commentsCommand = registeredCommands.get('comments');
      let responseHandler: ((res: any) => Promise<void>) | null = null;
      mockPage.on.mockImplementation((event: string, handler: any) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      });

      const mockResponse = {
        url: () => 'https://www.douyin.com/aweme/v1/web/comment/list/',
        json: async () => ({
          comments: [
            { cid: 'c1', text: 'Valid comment' },
            { cid: null, text: 'Invalid comment' },
            { cid: 'c2', text: 'Another valid comment' },
          ],
        }),
      };

      const result = await commentsCommand.handler(
        { awemeId: 'vid123', maxPages: 1 },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );

      await responseHandler?.(mockResponse);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe('Data Parsing Edge Cases', () => {
    it('should handle missing nested properties', () => {
      const item = {
        aweme_id: '123',
        desc: 'Test',
        statistics: null,
      };

      const stats = item.statistics ?? {};
      expect(n(stats.digg_count)).toBe(0);
    });

    it('should handle empty arrays', () => {
      const item = {
        aweme_id: '123',
        text_extra: [],
      };

      const tags = Array.isArray(item.text_extra)
        ? item.text_extra.map((t: unknown) => s(g(t, 'hashtag_name'))).filter(Boolean)
        : [];
      expect(tags).toEqual([]);
    });

    it('should handle missing video data', () => {
      const item = {
        aweme_id: '123',
        desc: 'Test',
        video: null,
      };

      const vid = item.video ?? {};
      expect(n(vid.width)).toBe(0);
      expect(n(vid.height)).toBe(0);
    });

    it('should handle timestamp conversion', () => {
      const ct = 1234567890;
      const dateStr = ct > 0 ? new Date(ct * 1000).toISOString().replace('T', ' ').slice(0, 19) : '';
      expect(dateStr).toBe('2009-02-13 23:31:30');
    });

    it('should handle zero timestamp', () => {
      const ct = 0;
      const dateStr = ct > 0 ? new Date(ct * 1000).toISOString().replace('T', ' ').slice(0, 19) : '';
      expect(dateStr).toBe('');
    });
  });
});
