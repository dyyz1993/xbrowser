import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/reddit/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = []) {
  return {
    url: vi.fn(() => 'https://www.reddit.com'),
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
      nth: vi.fn(() => ({
        waitFor: vi.fn(() => Promise.resolve()),
        click: vi.fn(() => Promise.resolve()),
      })),
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
  };
}

const ALL_COMMANDS = ['search-image', 'post', 'comment', 'vote', 'subscribe'];

describe('reddit plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name reddit', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'reddit' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.reddit.com' }));
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

  // ─── search-image command ───
  describe('search-image command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search-image');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('search-image');
      const ctx = createMockCtx(undefined);
      await expect(handler({ query: 'cats', limit: 10, timeout: 20000 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return results from evaluate', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'img1', thumbnailUrl: 'https://redd.it/1.jpg', sourceUrl: 'https://reddit.com/1', width: 200, height: 200 },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ query: 'cats', limit: 10, timeout: 20000 }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.engine).toBe('reddit');
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
      await expect(handler({ title: 'Hello' }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return fail on error', async () => {
      const handler = getHandler('post');
      const page = createMockPage();
      page.goto = vi.fn(() => Promise.reject(new Error('navigate failed')));
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Hello' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
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
      await expect(handler({ postUrl: 'https://reddit.com/1', text: 'Nice!' }, ctx)).rejects.toThrow('需要浏览器页面');
    });
  });

  // ─── vote command ───
  describe('vote command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'vote');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('vote');
      const ctx = createMockCtx(undefined);
      await expect(handler({ postUrl: 'https://reddit.com/1', direction: 'up' }, ctx)).rejects.toThrow('需要浏览器页面');
    });
  });

  // ─── subscribe command ───
  describe('subscribe command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'subscribe');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('subscribe');
      const ctx = createMockCtx(undefined);
      await expect(handler({ subreddit: 'AskReddit' }, ctx)).rejects.toThrow('需要浏览器页面');
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
