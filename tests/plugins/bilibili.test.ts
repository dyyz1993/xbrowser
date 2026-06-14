import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/bilibili/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = []) {
  return {
    url: vi.fn(() => 'https://www.bilibili.com'),
    goto: vi.fn(() => Promise.resolve()),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForLoadState: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
        fill: vi.fn(() => Promise.resolve()),
        count: vi.fn(() => Promise.resolve(0)),
        waitFor: vi.fn(() => Promise.resolve()),
      })),
      count: vi.fn(() => Promise.resolve(0)),
    })),
    keyboard: { type: vi.fn(() => Promise.resolve()), press: vi.fn(() => Promise.resolve()) },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn() },
    close: vi.fn(),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    cdpEndpoint: 'http://localhost:9221',
    sessionId: 'test-session',
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
  };
}

const ALL_COMMANDS = ['search', 'post', 'comment', 'like', 'search-image'];

describe('bilibili plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name bilibili', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'bilibili' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.bilibili.com' }));
  });

  it('should create site with requiresLogin true', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: true }));
  });

  it('should register 5 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(5);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
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

  it('should register login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  // ─── search command ───
  describe('search command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('search');
      const ctx = createMockCtx(undefined);
      await expect(handler({ query: 'test', limit: 10 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return videos from evaluate', async () => {
      const handler = getHandler('search');
      const page = createMockPage([
        { title: 'Video 1', author: 'UP1', playCount: '1万', duration: '10:00', link: 'https://b23.tv/1', cover: 'https://img.example.com/1.jpg' },
        { title: 'Video 2', author: 'UP2', playCount: '2万', duration: '20:00', link: 'https://b23.tv/2', cover: 'https://img.example.com/2.jpg' },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ query: 'AI', limit: 10 }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.query).toBe('AI');
      expect((data.videos as unknown[])).toHaveLength(2);
      expect(page.goto).toHaveBeenCalled();
    });

    it('should return fail on error', async () => {
      const handler = getHandler('search');
      const page = createMockPage();
      page.goto = vi.fn(() => Promise.reject(new Error('navigate failed')));
      const ctx = createMockCtx(page);
      const result = await handler({ query: 'test', limit: 10 }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── post command ───
  describe('post command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'post');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('post');
      const ctx = createMockCtx(undefined);
      await expect(handler({ text: 'hello' }, ctx)).rejects.toThrow('需要浏览器页面');
    });
  });

  // ─── comment command ───
  describe('comment command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'comment');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('comment');
      const ctx = createMockCtx(undefined);
      await expect(handler({ url: 'https://b23.tv/1', text: 'nice' }, ctx)).rejects.toThrow('需要浏览器页面');
    });
  });

  // ─── like command ───
  describe('like command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'like');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('like');
      const ctx = createMockCtx(undefined);
      await expect(handler({ url: 'https://b23.tv/1' }, ctx)).rejects.toThrow('需要浏览器页面');
    });
  });

  // ─── search-image command ───
  describe('search-image command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search-image');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('search-image');
      const ctx = createMockCtx(undefined);
      await expect(handler({ query: 'test', limit: 10, timeout: 20000 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return results from evaluate', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'img1', thumbnailUrl: 'https://img.example.com/1.jpg', sourceUrl: 'https://b23.tv/1', width: 320, height: 180 },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ query: 'cats', limit: 10, timeout: 20000 }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
    });
  });

  // ─── login/logout hooks ───
  it('login hook should be registered', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
  });

  it('logout hook should be registered', () => {
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });
});
