import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/medium/index.ts';

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
      last: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
      })),
    })),
    fill: vi.fn(),
    click: vi.fn(),
    url: vi.fn(() => 'https://medium.com/'),
    keyboard: { insertText: vi.fn(), press: vi.fn(), type: vi.fn() },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn(() => Promise.resolve()) },
    close: vi.fn(),
    waitForSelector: vi.fn(() => Promise.resolve()),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
  };
}

const ALL_COMMANDS = ['login', 'publish', 'draft', 'import', 'update-profile'];

describe('medium plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name medium', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'medium' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://medium.com' })
    );
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

  describe('login command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('login');
      await expect(handler({}, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to medium signin page', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://medium.com/m/signin',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('Medium') })
      );
    });

    it('should save login state to storage', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.storage.set).toHaveBeenCalledWith(
        'medium_login',
        expect.objectContaining({ loggedIn: false })
      );
    });

    it('should return not-logged-in tip when avatar not visible', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(false);
      expect(result.tips[0]).toContain('登录可能未完成');
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
      expect(result.tips[0]).toContain('Medium 登录成功');
    });

    it('should navigate to medium home after login attempt', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      const gotoCalls = page.goto.mock.calls.map((c: unknown[]) => c[0]);
      expect(gotoCalls).toContain('https://medium.com/');
    });
  });

  describe('publish command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('publish');
      await expect(handler({ title: 'T', content: 'C' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to new story page', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'My Guide', content: '# Hello' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://medium.com/new-story',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman for CAPTCHA review', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'T', content: 'C' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('CAPTCHA') })
      );
    });

    it('should return title and url in data', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Guide', content: 'body' }, ctx);
      expect(result.data.title).toBe('My Guide');
      expect(result.data.url).toBeDefined();
    });

    it('should include publish tip', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Test Post', content: 'body' }, ctx);
      expect(result.tips[0]).toContain('Test Post');
    });

    it('should close page by default', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'T', content: 'C' }, ctx);
      expect(page.close).toHaveBeenCalled();
    });

    it('should keep page alive when keepAlive is true', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'T', content: 'C', keepAlive: true }, ctx);
      expect(page.close).not.toHaveBeenCalled();
    });
  });

  describe('draft command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('draft');
      await expect(handler({ title: 'T', content: 'C' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to new story page', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'Draft', content: 'Content' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://medium.com/new-story',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return saved as true', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Draft', content: 'content' }, ctx);
      expect(result.data.saved).toBe(true);
      expect(result.data.title).toBe('My Draft');
    });

    it('should include draft saved tip', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Draft Title', content: 'c' }, ctx);
      expect(result.tips[0]).toContain('Draft Title');
      expect(result.tips[0]).toContain('草稿');
    });
  });

  describe('import command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('import');
      await expect(handler({ url: 'https://example.com/article' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to import page', async () => {
      const handler = getHandler('import');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ url: 'https://example.com/article' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://medium.com/p/import',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman for review', async () => {
      const handler = getHandler('import');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ url: 'https://example.com/article' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('imported') })
      );
    });

    it('should return imported data', async () => {
      const handler = getHandler('import');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com/article' }, ctx);
      expect(result.data.importedFrom).toBe('https://example.com/article');
    });

    it('should include import tip', async () => {
      const handler = getHandler('import');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com/article' }, ctx);
      expect(result.tips[0]).toContain('https://example.com/article');
    });
  });

  describe('update-profile command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('update-profile');
      await expect(handler({ url: 'https://example.com' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to settings page', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ url: 'https://example.com' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://medium.com/me/settings',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return url and updated in data', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(result.data.url).toBe('https://example.com');
      expect(result.data.updated).toBe(true);
    });

    it('should include profile update tip', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(result.tips[0]).toContain('Profile');
    });

    it('should handle bio parameter', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com', bio: 'Developer' }, ctx);
      expect(result.data.updated).toBe(true);
    });
  });

  it('login hook should set storage', async () => {
    const loginFn = mockSite.login.mock.calls[0][0] as Function;
    const storage = { set: vi.fn(), get: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() };
    const page = createMockPage();
    await loginFn({ page, storage });
    expect(storage.set).toHaveBeenCalledWith('medium_login', expect.objectContaining({ at: expect.any(Number) }));
  });

  it('logout hook should delete login storage', async () => {
    const logoutFn = mockSite.logout.mock.calls[0][0] as Function;
    const storage = { set: vi.fn(), get: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() };
    await logoutFn({ storage });
    expect(storage.delete).toHaveBeenCalledWith('medium_login');
  });
});
