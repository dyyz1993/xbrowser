import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/xiaohongshu/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function makeResponse(url: string, body: unknown) {
  return {
    url: () => url,
    json: () => Promise.resolve(body),
  };
}

function makePageCtx(overrides: Record<string, unknown> = {}) {
  const responseHandlers: Array<(response: unknown) => Promise<void>> = [];
  const page = {
    goto: vi.fn(),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => Promise.resolve(null)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
        fill: vi.fn(),
      })),
    })),
    fill: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    url: vi.fn(() => 'https://www.xiaohongshu.com/explore'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    on: vi.fn((event: string, handler: (r: unknown) => Promise<void>) => {
      if (event === 'response') responseHandlers.push(handler);
    }),
    off: vi.fn((event: string, handler: (r: unknown) => Promise<void>) => {
      const idx = responseHandlers.indexOf(handler);
      if (idx >= 0) responseHandlers.splice(idx, 1);
    }),
    _fireResponse: async (response: unknown) => {
      await Promise.all(responseHandlers.map(h => h(response)));
    },
  };
  const ctx = {
    page,
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(async () => ({ solved: false })),
    sessionId: 'test-session',
    ...overrides,
  };
  return ctx;
}

function makePageCtxWithAutoFire(responses: Array<{ url: string; body: unknown }>) {
  const responseHandlers: Array<(response: unknown) => Promise<void>> = [];
  let fireIndex = 0;
  const page = {
    goto: vi.fn(async () => {
      if (fireIndex < responses.length) {
        const r = responses[fireIndex++];
        await Promise.all(responseHandlers.map(h => h(makeResponse(r.url, r.body))));
      }
    }),
    waitForTimeout: vi.fn(async () => {
      if (fireIndex < responses.length) {
        const r = responses[fireIndex++];
        await Promise.all(responseHandlers.map(h => h(makeResponse(r.url, r.body))));
      }
    }),
    waitForLoadState: vi.fn(async () => {}),
    evaluate: vi.fn(async () => null),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
        fill: vi.fn(),
      })),
    })),
    fill: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    url: vi.fn(() => 'https://www.xiaohongshu.com/explore'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    on: vi.fn((event: string, handler: (r: unknown) => Promise<void>) => {
      if (event === 'response') responseHandlers.push(handler);
    }),
    off: vi.fn(),
  };
  const ctx = {
    page,
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(async () => ({ solved: false })),
    sessionId: 'test-session',
  };
  return ctx;
}

async function runWithFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const p = fn();
    await vi.runAllTimersAsync();
    return await p;
  } finally {
    vi.useRealTimers();
  }
}

const COMMANDS = ['detail', 'notes', 'profile', 'search', 'comments', 'feed', 'resolve-url'];

describe('xiaohongshu plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create site with name xiaohongshu', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'xiaohongshu' })
    );
  });

  it('should register 7 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(7);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(COMMANDS);
  });

  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  describe('detail command', () => {
    it('should return error when no page in ctx', async () => {
      const handler = getHandler('detail');
      const result = await handler({ noteId: '123' }, { storage: { set: vi.fn() } });
      expect(result.data).toBeNull();
      expect(result.message).toBeTruthy();
    });

    it('should navigate to note explore page', async () => {
      const handler = getHandler('detail');
      const ctx = makePageCtx();
      await runWithFakeTimers(() => handler({ noteId: '67abc123' }, ctx));
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.xiaohongshu.com/explore/67abc123',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return null data when no API response intercepted', async () => {
      const handler = getHandler('detail');
      const ctx = makePageCtx();
      const result = await runWithFakeTimers(() => handler({ noteId: '67abc123' }, ctx));
      expect(result.data).toBeNull();
      expect(result.tips.join('\n')).toContain('未获取到笔记数据');
    });

    it('should parse note data from intercepted API response', async () => {
      const handler = getHandler('detail');
      const ctx = makePageCtx();
      let responseHandler: ((r: unknown) => Promise<void>) | null = null;
      ctx.page.on = vi.fn((_event: string, h: (r: unknown) => Promise<void>) => { responseHandler = h; });
      ctx.page.off = vi.fn();

      const apiResponse = makeResponse('/api/sns/web/v1/feed', {
        success: true,
        data: {
          items: [{
            note_card: {
              note_id: '67abc123', type: 'normal', title: 'Test Note', desc: 'Test description',
              cover: { url_default: 'https://img.xhs.com/cover.jpg' },
              image_list: [], video: null, tag_list: [{ name: 'test' }],
              user: { user_id: 'u1', nickname: 'Tester' },
              interact_info: { liked_count: '10', collected_count: '5', comment_count: '2', share_count: '1' },
              time: 1700000000000, last_update_time: 1700000000000,
            },
          }],
        },
      });

      vi.useFakeTimers();
      const resultP = handler({ noteId: '67abc123' }, ctx);
      await vi.advanceTimersByTimeAsync(100);
      await responseHandler!(apiResponse);
      await vi.runAllTimersAsync();
      const result = await resultP;
      vi.useRealTimers();

      expect(result.data).not.toBeNull();
      expect(result.data.noteId).toBe('67abc123');
      expect(result.data.title).toBe('Test Note');
      expect(result.data.author.nickname).toBe('Tester');
      expect(result.data.statistics.likedCount).toBe('10');
      expect(result.data.tags).toEqual(['test']);
    });

    it('should handle error gracefully', async () => {
      const handler = getHandler('detail');
      const ctx = makePageCtx();
      ctx.page.goto = vi.fn(() => { throw new Error('timeout'); });
      const result = await handler({ noteId: '67abc123' }, ctx);
      expect(result.data).toBeNull();
      expect(result.message).toContain('timeout');
    });

    it('should dispose interceptor after completion', async () => {
      const handler = getHandler('detail');
      const ctx = makePageCtx();
      await runWithFakeTimers(() => handler({ noteId: '67abc123' }, ctx));
      expect(ctx.page.off).toHaveBeenCalled();
    });
  });

  describe('notes command', () => {
    it('should return error when no page in ctx', async () => {
      const handler = getHandler('notes');
      const result = await handler({ userId: 'u1' }, { storage: { set: vi.fn() } });
      expect(result.data).toBeNull();
    });

    it('should navigate to user profile page', async () => {
      const handler = getHandler('notes');
      const ctx = makePageCtx();
      await runWithFakeTimers(() => handler({ userId: '5abc', maxPages: 1 }, ctx));
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.xiaohongshu.com/user/profile/5abc',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return empty notes when no API response', async () => {
      const handler = getHandler('notes');
      const ctx = makePageCtx();
      const result = await runWithFakeTimers(() => handler({ userId: '5abc', maxPages: 1 }, ctx));
      expect(result.data.total).toBe(0);
      expect(result.data.notes).toEqual([]);
    });

    it('should parse notes from intercepted API response', async () => {
      const handler = getHandler('notes');
      const ctx = makePageCtxWithAutoFire([{
        url: '/api/sns/web/v1/user_posted',
        body: {
          success: true,
          data: {
            notes: [
              { note_id: 'n1', note_card: { note_id: 'n1', type: 'normal', title: 'Note 1', desc: '', user: {}, interact_info: {}, time: 0, last_update_time: 0 } },
              { note_id: 'n2', note_card: { note_id: 'n2', type: 'video', title: 'Note 2', desc: '', user: {}, interact_info: {}, time: 0, last_update_time: 0 } },
            ],
          },
        },
      }]);

      const result = await handler({ userId: '5abc', maxPages: 1 }, ctx);
      expect(result.data.total).toBe(2);
      expect(result.data.notes[0].noteId).toBe('n1');
      expect(result.data.notes[1].noteId).toBe('n2');
    });
  });

  describe('profile command', () => {
    it('should return error when no page in ctx', async () => {
      const handler = getHandler('profile');
      const result = await handler({ userId: 'u1' }, { storage: { set: vi.fn() } });
      expect(result.data).toBeNull();
    });

    it('should navigate to user profile page', async () => {
      const handler = getHandler('profile');
      const ctx = makePageCtx();
      await runWithFakeTimers(() => handler({ userId: '5def' }, ctx));
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.xiaohongshu.com/user/profile/5def',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should parse user from intercepted API response', async () => {
      const handler = getHandler('profile');
      const responseHandlers: Array<(response: unknown) => Promise<void>> = [];
      const ctx = makePageCtx();
      ctx.page.on = vi.fn((_e: string, h: (r: unknown) => Promise<void>) => { responseHandlers.push(h); });
      ctx.page.off = vi.fn();

      const apiResponse = makeResponse('/api/sns/web/v1/user/otherinfo', {
        success: true,
        data: {
          user: {
            user_id: '5def', nickname: 'TestUser', red_id: '12345',
            image: 'https://img.xhs.com/avatar.jpg', desc: 'Hello',
            gender: '1', ip_location: 'Shanghai', tag: [],
            notes: 10, fans: 100, follows: 50, interaction: 200,
          },
        },
      });

      vi.useFakeTimers();
      const resultP = handler({ userId: '5def' }, ctx);
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all(responseHandlers.map(h => h(apiResponse)));
      await vi.runAllTimersAsync();
      const result = await resultP;
      vi.useRealTimers();

      expect(result.data).not.toBeNull();
      expect(result.data.userId).toBe('5def');
      expect(result.data.nickname).toBe('TestUser');
      expect(result.data.statistics.notes).toBe(10);
      expect(result.data.statistics.fans).toBe(100);
    });

    it('should fall back to DOM extraction when no API response', async () => {
      const handler = getHandler('profile');
      const ctx = makePageCtx();
      let evalCallCount = 0;
      ctx.page.evaluate = vi.fn(async () => {
        evalCallCount++;
        if (evalCallCount <= 2) return null;
        return { nickname: 'DOM User', desc: 'from dom', avatar: 'https://img.xhs.com/dom.jpg', stats: {} };
      });

      const result = await runWithFakeTimers(() => handler({ userId: '5def' }, ctx));
      expect(result.data).not.toBeNull();
      expect(result.data.nickname).toBe('DOM User');
      expect(result.data.userId).toBe('5def');
    });
  });

  describe('search command', () => {
    it('should return error when no page in ctx', async () => {
      const handler = getHandler('search');
      const result = await handler({ keyword: 'test' }, { storage: { set: vi.fn() } });
      expect(result.data).toBeNull();
    });

    it('should navigate to search results page', async () => {
      const handler = getHandler('search');
      const ctx = makePageCtx();
      await runWithFakeTimers(() => handler({ keyword: '美食推荐', maxPages: 1 }, ctx));
      expect(ctx.page.goto).toHaveBeenCalledWith(
        expect.stringContaining('keyword=' + encodeURIComponent('美食推荐')),
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return empty notes when no API response', async () => {
      const handler = getHandler('search');
      const ctx = makePageCtx();
      const result = await runWithFakeTimers(() => handler({ keyword: 'test', maxPages: 1 }, ctx));
      expect(result.data.total).toBe(0);
      expect(result.data.keyword).toBe('test');
    });

    it('should parse search results from intercepted API', async () => {
      const handler = getHandler('search');
      const ctx = makePageCtxWithAutoFire([{
        url: '/api/sns/web/v1/search/notes',
        body: {
          success: true,
          data: {
            items: [
              { id: 's1', note_card: { note_id: 's1', type: 'normal', display_title: 'Result 1', user: {}, interact_info: {} } },
            ],
          },
        },
      }]);

      const result = await handler({ keyword: 'test', maxPages: 1 }, ctx);
      expect(result.data.total).toBe(1);
      expect(result.data.notes[0].noteId).toBe('s1');
    });
  });

  describe('comments command', () => {
    it('should return error when no page in ctx', async () => {
      const handler = getHandler('comments');
      const result = await handler({ noteId: '123' }, { storage: { set: vi.fn() } });
      expect(result.data).toBeNull();
    });

    it('should navigate to note page', async () => {
      const handler = getHandler('comments');
      const ctx = makePageCtx();
      await runWithFakeTimers(() => handler({ noteId: '67abc', maxPages: 1 }, ctx));
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.xiaohongshu.com/explore/67abc',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return empty comments when no API response', async () => {
      const handler = getHandler('comments');
      const ctx = makePageCtx();
      const result = await runWithFakeTimers(() => handler({ noteId: '67abc', maxPages: 1 }, ctx));
      expect(result.data.total).toBe(0);
      expect(result.data.comments).toEqual([]);
    });

    it('should parse comments from intercepted API', async () => {
      const handler = getHandler('comments');
      const ctx = makePageCtxWithAutoFire([{
        url: '/api/sns/web/v2/comment/page',
        body: {
          success: true,
          data: {
            comments: [
              {
                id: 'c1', content: 'Nice post!',
                user_info: { user_id: 'u2', nickname: 'Commenter', image: '' },
                like_count: 3, sub_comment_count: 0,
                ip_location: 'Beijing', create_time: 1700000000000,
              },
            ],
          },
        },
      }]);

      const result = await handler({ noteId: '67abc', maxPages: 1 }, ctx);
      expect(result.data.total).toBe(1);
      expect(result.data.comments[0].content).toBe('Nice post!');
      expect(result.data.comments[0].author.nickname).toBe('Commenter');
      expect(result.data.comments[0].likedCount).toBe(3);
    });
  });

  describe('feed command', () => {
    it('should return error when no page in ctx', async () => {
      const handler = getHandler('feed');
      const result = await handler({}, { storage: { set: vi.fn() } });
      expect(result.data).toBeNull();
    });

    it('should navigate to explore page', async () => {
      const handler = getHandler('feed');
      const ctx = makePageCtx();
      await runWithFakeTimers(() => handler({ maxPages: 1 }, ctx));
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.xiaohongshu.com/explore',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return empty notes when no API response', async () => {
      const handler = getHandler('feed');
      const ctx = makePageCtx();
      const result = await runWithFakeTimers(() => handler({ maxPages: 1 }, ctx));
      expect(result.data.total).toBe(0);
    });

    it('should parse feed items from intercepted API', async () => {
      const handler = getHandler('feed');
      const ctx = makePageCtxWithAutoFire([{
        url: '/api/sns/web/v1/homefeed',
        body: {
          success: true,
          data: {
            items: [
              { id: 'f1', note_card: { note_id: 'f1', type: 'normal', display_title: 'Feed 1', user: {}, interact_info: {} } },
              { id: 'f2', note_card: { note_id: 'f2', type: 'video', display_title: 'Feed 2', user: {}, interact_info: {} } },
            ],
          },
        },
      }]);

      const result = await handler({ maxPages: 1 }, ctx);
      expect(result.data.total).toBe(2);
      expect(result.tips.join('\n')).toContain('2 条推荐');
    });
  });

  describe('resolve-url command', () => {
    it('should return error when no page in ctx', async () => {
      const handler = getHandler('resolve-url');
      const result = await handler({ url: 'https://xhslink.com/abc' }, { storage: { set: vi.fn() } });
      expect(result.data).toBeNull();
    });

    it('should navigate to short URL', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.url = vi.fn(() => 'https://www.xiaohongshu.com/explore/67xyz');
      await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://xhslink.com/abc',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should extract noteId from resolved URL', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.url = vi.fn(() => 'https://www.xiaohongshu.com/explore/67xyz789');
      const result = await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(result.data.noteId).toBe('67xyz789');
      expect(result.data.finalUrl).toBe('https://www.xiaohongshu.com/explore/67xyz789');
    });

    it('should extract userId from resolved URL', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.url = vi.fn(() => 'https://www.xiaohongshu.com/user/profile/5abc');
      const result = await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(result.data.userId).toBe('5abc');
    });

    it('should return empty noteId and userId for non-matching URL', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.url = vi.fn(() => 'https://www.xiaohongshu.com/some/other/page');
      const result = await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(result.data.noteId).toBe('');
      expect(result.data.userId).toBe('');
    });

    it('should include originalUrl in data', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.url = vi.fn(() => 'https://www.xiaohongshu.com/explore/123');
      const result = await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(result.data.originalUrl).toBe('https://xhslink.com/abc');
    });

    it('should include final URL in tips', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.url = vi.fn(() => 'https://www.xiaohongshu.com/explore/123');
      const result = await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(result.tips.join('\n')).toContain('最终 URL');
    });

    it('should include noteId in tips when present', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.url = vi.fn(() => 'https://www.xiaohongshu.com/explore/67xyz');
      const result = await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(result.tips.join('\n')).toContain('笔记 ID');
    });

    it('should handle error gracefully', async () => {
      const handler = getHandler('resolve-url');
      const ctx = makePageCtx();
      ctx.page.goto = vi.fn(() => { throw new Error('net error'); });
      const result = await handler({ url: 'https://xhslink.com/abc' }, ctx);
      expect(result.data).toBeNull();
      expect(result.message).toContain('net error');
    });
  });
});
