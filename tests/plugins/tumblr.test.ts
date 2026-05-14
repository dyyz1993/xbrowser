import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/tumblr/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      waitForLoadState: vi.fn(),
      evaluate: vi.fn(),
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
      url: vi.fn(() => 'https://www.tumblr.com/dashboard'),
      keyboard: { insertText: vi.fn(), press: vi.fn() },
    },
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(),
    ...overrides,
  };
}

const COMMANDS = ['login', 'publish', 'update-profile', 'reblog'];

describe('tumblr plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name tumblr', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'tumblr' })
    );
  });

  it('should register 4 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(4);
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

  describe('login command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('login');
      await expect(handler({}, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to tumblr login page', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.tumblr.com/login',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('Tumblr') })
      );
    });

    it('should save login state to storage', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.storage.set).toHaveBeenCalledWith('tumblr_login', expect.objectContaining({ loggedIn: false }));
    });

    it('should return loggedIn false when no avatar visible', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(false);
      expect(result.tips[0]).toContain('登录可能未完成');
    });

    it('should return loggedIn true when avatar visible', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      ctx.page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(),
        })),
      }));
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(true);
      expect(result.tips[0]).toContain('登录成功');
    });

    it('should fill email when provided', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      ctx.page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(),
          fill: vi.fn(),
        })),
      }));
      await handler({ email: 'user@example.com' }, ctx);
      expect(ctx.page.locator).toHaveBeenCalled();
    });
  });

  describe('publish command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('publish');
      await expect(handler({ title: 't', content: 'c' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to new text post page', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      await handler({ title: 'SEO Tips', content: 'Great content' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.tumblr.com/new/text',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return title and tags in data', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      const result = await handler({ title: 'My Post', content: 'content', tags: 'seo,marketing' }, ctx);
      expect(result.data.title).toBe('My Post');
      expect(result.data.tags).toBe('seo,marketing');
    });

    it('should include title in tips', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      const result = await handler({ title: 'Test Post', content: 'content' }, ctx);
      expect(result.tips[0]).toContain('Test Post');
    });

    it('should call waitForHuman for review', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      await handler({ title: 't', content: 'c' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('publish') })
      );
    });

    it('should call waitForLoadState', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      await handler({ title: 't', content: 'c' }, ctx);
      expect(ctx.page.waitForLoadState).toHaveBeenCalledWith('networkidle');
    });
  });

  describe('update-profile command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('update-profile');
      await expect(handler({ url: 'https://example.com' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to blog settings page', async () => {
      const handler = getHandler('update-profile');
      const ctx = makeCtx();
      await handler({ url: 'https://example.com' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.tumblr.com/settings/blog',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return updated data', async () => {
      const handler = getHandler('update-profile');
      const ctx = makeCtx();
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(result.data.url).toBe('https://example.com');
      expect(result.data.updated).toBe(true);
    });

    it('should include profile update tip', async () => {
      const handler = getHandler('update-profile');
      const ctx = makeCtx();
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(result.tips[0]).toContain('外链');
    });
  });

  describe('reblog command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('reblog');
      await expect(handler({ postUrl: 'https://tumblr.com/post/1', comment: 'nice' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to post URL', async () => {
      const handler = getHandler('reblog');
      const ctx = makeCtx();
      await handler({ postUrl: 'https://example.tumblr.com/post/123', comment: 'Great!' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://example.tumblr.com/post/123',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return postUrl in data', async () => {
      const handler = getHandler('reblog');
      const ctx = makeCtx();
      const result = await handler({ postUrl: 'https://example.tumblr.com/post/123', comment: 'nice' }, ctx);
      expect(result.data.postUrl).toBe('https://example.tumblr.com/post/123');
    });

    it('should include reblog tip', async () => {
      const handler = getHandler('reblog');
      const ctx = makeCtx();
      const result = await handler({ postUrl: 'https://tumblr.com/post/1', comment: 'nice' }, ctx);
      expect(result.tips[0]).toContain('Reblog');
    });

    it('should call waitForHuman for review', async () => {
      const handler = getHandler('reblog');
      const ctx = makeCtx();
      await handler({ postUrl: 'https://tumblr.com/post/1', comment: 'nice' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('reblog') })
      );
    });
  });

  it('should register login hook', () => {
    expect(mockSite.login).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should register logout hook', () => {
    expect(mockSite.logout).toHaveBeenCalledWith(expect.any(Function));
  });

  it('logout hook should delete tumblr_login storage', async () => {
    const logoutFn = mockSite.logout.mock.calls[0][0] as Function;
    const ctx = makeCtx();
    await logoutFn(ctx);
    expect(ctx.storage.delete).toHaveBeenCalledWith('tumblr_login');
  });

  it('login hook should set storage', async () => {
    const loginFn = mockSite.login.mock.calls[0][0] as Function;
    const ctx = makeCtx();
    await loginFn(ctx);
    expect(ctx.storage.set).toHaveBeenCalledWith('tumblr_login', expect.objectContaining({ at: expect.any(Number) }));
  });
});
