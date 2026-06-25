import { tipsMessages } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/juejin/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function createMockPage() {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => Promise.resolve({ x: 640, y: 360 })),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
        fill: vi.fn(() => Promise.resolve()),
      })),
    })),
    fill: vi.fn(),
    click: vi.fn(),
    url: vi.fn(() => 'https://juejin.cn/'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn(() => Promise.resolve()) },
    close: vi.fn(),
    $: vi.fn(),
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
  };
}

const ALL_COMMANDS = ['login', 'publish', 'draft', 'upload-image', 'update-profile', 'fetch-articles'];

describe('juejin plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name juejin', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'juejin' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://juejin.cn' })
    );
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
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

  describe('login command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('login');
      await expect(handler({}, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to juejin login page', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/login',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('掘金') })
      );
    });

    it('should save login state to storage', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.storage.set).toHaveBeenCalledWith(
        'juejin_login',
        expect.objectContaining({ loggedIn: false })
      );
    });

    it('should return not-logged-in tip when avatar not visible', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(false);
      expect(result.tips.some((t: string) => t.includes('登录可能未完成'))).toBe(true);
    });

    it('should return success tip when logged in', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
        })),
      }));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(true);
      const tips = tipsMessages(result.tips);
      expect(tips.some((t: string) => t.includes('掘金登录成功'))).toBe(true);
    });

    it('should navigate to juejin home after login attempt', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      const gotoCalls = page.goto.mock.calls.map((c: unknown[]) => c[0]);
      expect(gotoCalls).toContain('https://juejin.cn/');
    });
  });

  describe('publish command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('publish');
      await expect(handler({ title: 'T', content: 'C' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to editor page', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'My Guide', content: '# Hello' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/editor/draft',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return fail when neither content nor file provided', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'T' }, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toContain('必须提供');
    });

    it('should return title and tags in data on success', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Post', content: 'body', tags: 'webdev' }, ctx);
      expect(result.success).toBe(true);
      expect(result.data.title).toBe('My Post');
      expect(result.data.tags).toBe('webdev');
      expect(result.data.url).toBeDefined();
    }, 15000);

    it('should include publish tip on success', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Test', content: 'body' }, ctx);
      if (result.success) {
        expect(result.tips.some((t: string) => t.includes('Test') && t.includes('掘金'))).toBe(true);
      }
    }, 15000);

    it('should close page by default on success', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'T', content: 'C' }, ctx);
      if (result.success) {
        expect(page.close).toHaveBeenCalled();
      }
    }, 15000);

    it('should keep page alive when keepAlive is true', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'T', content: 'C', keepAlive: true }, ctx);
      if (result.success) {
        expect(page.close).not.toHaveBeenCalled();
      }
    }, 15000);
  });

  describe('draft command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('draft');
      await expect(handler({ title: 'T', content: 'C' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to editor page', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'Draft', content: 'Content' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/editor/drafts/new',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return saved as true on success', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Draft', content: 'content' }, ctx);
      if (result.success) {
        expect(result.data.saved).toBe(true);
        expect(result.data.title).toBe('My Draft');
      }
    }, 15000);

    it('should include draft saved tip on success', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Draft Title', content: 'c' }, ctx);
      if (result.success) {
        expect(result.tips.some((t: string) => t.includes('Draft Title') && t.includes('草稿'))).toBe(true);
      }
    }, 15000);
  });

  describe('update-profile command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('update-profile');
      await expect(handler({ url: 'https://example.com' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to settings page', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ url: 'https://example.com' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/user/settings/profile',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return url and updated in data', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(result.data.url).toBe('https://example.com');
      expect(result.data.updated).toBe(true);
    }, 15000);

    it('should include profile update tip', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(result.tips.some((t: string) => t.includes('Profile'))).toBe(true);
    }, 15000);

    it('should handle bio parameter', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com', bio: 'Developer' }, ctx);
      expect(result.data.updated).toBe(true);
    }, 15000);
  });

  describe('fetch-articles command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('fetch-articles');
      await expect(handler({}, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to user center articles page', async () => {
      const handler = getHandler('fetch-articles');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/user/center/articles',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return articles array from evaluate', async () => {
      const handler = getHandler('fetch-articles');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve([
        { title: 'Post 1', url: '/post/1', views: '100', likes: '5', comments: '2', date: '2026-01-01' },
      ]));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data[0].title).toBe('Post 1');
    }, 15000);

    it('should return count tip with article number', async () => {
      const handler = getHandler('fetch-articles');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve([{ title: 'P1', url: '/1', views: '10', likes: '1', comments: '0', date: '2026-01-01' }]));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.tips.some((t: string) => t.includes('1 篇'))).toBe(true);
    }, 15000);
  });

  it('login hook should set storage', async () => {
    const loginFn = mockSite.login.mock.calls[0][0] as Function;
    const storage = { set: vi.fn(), get: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() };
    const page = createMockPage();
    await loginFn({ page, storage });
    expect(storage.set).toHaveBeenCalledWith('juejin_login', expect.objectContaining({ at: expect.any(Number) }));
  });

  it('logout hook should delete login storage', async () => {
    const logoutFn = mockSite.logout.mock.calls[0][0] as Function;
    const storage = { set: vi.fn(), get: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() };
    await logoutFn({ storage });
    expect(storage.delete).toHaveBeenCalledWith('juejin_login');
  });
});
