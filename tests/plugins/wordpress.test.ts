import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/wordpress/index.ts';

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
        last: vi.fn(() => ({
          isVisible: vi.fn(() => Promise.resolve(false)),
          click: vi.fn(),
        })),
      })),
      fill: vi.fn(),
      click: vi.fn(),
      type: vi.fn(),
      url: vi.fn(() => 'https://wordpress.com/'),
      keyboard: { insertText: vi.fn(), press: vi.fn() },
    },
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(),
    ...overrides,
  };
}

const COMMANDS = ['login', 'publish', 'draft', 'update-profile', 'create-page'];

describe('wordpress plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name wordpress', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wordpress' })
    );
  });

  it('should register 5 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(5);
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

    it('should navigate to wordpress login page', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://wordpress.com/log-in',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('WordPress') })
      );
    });

    it('should save login state to storage', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.storage.set).toHaveBeenCalledWith('wordpress_login', expect.objectContaining({ loggedIn: false }));
    });

    it('should return loggedIn false when no me element visible', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(false);
      expect(result.tips[0]).toContain('登录可能未完成');
    });

    it('should return loggedIn true when me element visible', async () => {
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

    it('should navigate to home after login', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      const gotoCalls = ctx.page.goto.mock.calls;
      expect(gotoCalls.length).toBeGreaterThanOrEqual(2);
      expect(gotoCalls[1][0]).toBe('https://wordpress.com/');
    });
  });

  describe('publish command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('publish');
      await expect(handler({ title: 't', content: 'c' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to new post page', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      await handler({ title: 'Test', content: 'content' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://wordpress.com/post/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return title tags categories in data', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      const result = await handler({ title: 'My Post', content: 'c', tags: 'web', categories: 'tech' }, ctx);
      expect(result.data.title).toBe('My Post');
      expect(result.data.tags).toBe('web');
      expect(result.data.categories).toBe('tech');
    });

    it('should include title in tips', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      const result = await handler({ title: 'Test Post', content: 'c' }, ctx);
      expect(result.tips[0]).toContain('Test Post');
    });

    it('should call waitForHuman for review', async () => {
      const handler = getHandler('publish');
      const ctx = makeCtx();
      await handler({ title: 't', content: 'c' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalled();
    });
  });

  describe('draft command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('draft');
      await expect(handler({ title: 't', content: 'c' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to new post page', async () => {
      const handler = getHandler('draft');
      const ctx = makeCtx();
      await handler({ title: 'Draft', content: 'content' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://wordpress.com/post/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return saved true in data', async () => {
      const handler = getHandler('draft');
      const ctx = makeCtx();
      const result = await handler({ title: 'Draft Post', content: 'content' }, ctx);
      expect(result.data.title).toBe('Draft Post');
      expect(result.data.saved).toBe(true);
    });

    it('should include title in tips', async () => {
      const handler = getHandler('draft');
      const ctx = makeCtx();
      const result = await handler({ title: 'My Draft', content: 'content' }, ctx);
      expect(result.tips[0]).toContain('My Draft');
      expect(result.tips[0]).toContain('草稿');
    });

    it('should call waitForLoadState', async () => {
      const handler = getHandler('draft');
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

    it('should navigate to wordpress me page', async () => {
      const handler = getHandler('update-profile');
      const ctx = makeCtx();
      await handler({ url: 'https://example.com' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://wordpress.com/me',
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

  describe('create-page command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('create-page');
      await expect(handler({ title: 't', content: 'c' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to new page editor', async () => {
      const handler = getHandler('create-page');
      const ctx = makeCtx();
      await handler({ title: 'About Us', content: 'Our company' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://wordpress.com/page/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return title in data', async () => {
      const handler = getHandler('create-page');
      const ctx = makeCtx();
      const result = await handler({ title: 'About Us', content: 'Our company' }, ctx);
      expect(result.data.title).toBe('About Us');
    });

    it('should include title in tips', async () => {
      const handler = getHandler('create-page');
      const ctx = makeCtx();
      const result = await handler({ title: 'Contact', content: 'info' }, ctx);
      expect(result.tips[0]).toContain('Contact');
      expect(result.tips[0]).toContain('页面');
    });

    it('should call waitForHuman for review', async () => {
      const handler = getHandler('create-page');
      const ctx = makeCtx();
      await handler({ title: 't', content: 'c' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('page') })
      );
    });

    it('should call waitForLoadState', async () => {
      const handler = getHandler('create-page');
      const ctx = makeCtx();
      await handler({ title: 't', content: 'c' }, ctx);
      expect(ctx.page.waitForLoadState).toHaveBeenCalledWith('networkidle');
    });
  });

  it('should register login hook', () => {
    expect(mockSite.login).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should register logout hook', () => {
    expect(mockSite.logout).toHaveBeenCalledWith(expect.any(Function));
  });

  it('logout hook should delete wordpress_login storage', async () => {
    const logoutFn = mockSite.logout.mock.calls[0][0] as Function;
    const ctx = makeCtx();
    await logoutFn(ctx);
    expect(ctx.storage.delete).toHaveBeenCalledWith('wordpress_login');
  });

  it('login hook should set storage', async () => {
    const loginFn = mockSite.login.mock.calls[0][0] as Function;
    const ctx = makeCtx();
    await loginFn(ctx);
    expect(ctx.storage.set).toHaveBeenCalledWith('wordpress_login', expect.objectContaining({ at: expect.any(Number) }));
  });
});
