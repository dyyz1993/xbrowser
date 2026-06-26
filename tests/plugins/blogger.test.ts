import { firstTip } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/blogger/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function createMockLocator() {
  const item: any = {
    isVisible: vi.fn(() => Promise.resolve(false)),
    click: vi.fn(() => {
      const p = Promise.resolve();
      (p as any).catch = vi.fn(() => Promise.resolve());
      return p;
    }),
    fill: vi.fn(() => Promise.resolve()),
  };
  const first = vi.fn(() => item);
  return { first, isVisible: item.isVisible, click: item.click, fill: item.fill };
}

function createMockPage() {
  const locator = createMockLocator();
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(),
    locator: vi.fn(() => locator),
    fill: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    url: vi.fn(() => 'https://www.blogger.com/'),
    keyboard: {
      insertText: vi.fn(),
      press: vi.fn(),
    },
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
    storage: {
      set: vi.fn(),
      get: vi.fn(() => null),
      delete: vi.fn(),
      keys: vi.fn(() => []),
      clear: vi.fn(),
    },
  };
}

const ALL_COMMANDS = ['login', 'create-blog', 'publish', 'update-profile'];

describe('blogger plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name blogger', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'blogger' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://www.blogger.com' })
    );
  });

  it('should register 4 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(4);
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
      const ctx = createMockCtx();
      await expect(handler({}, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to blogger about page', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.blogger.com/about/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Google login required' })
      );
    });

    it('should save login state to storage', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.storage.set).toHaveBeenCalledWith(
        'blogger_login',
        expect.objectContaining({ loggedIn: false })
      );
    });

    it('should return loggedIn false when selector not visible', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(false);
    });

    it('should return success tip when logged in', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      let callCount = 0;
      page.locator = vi.fn(() => {
        callCount++;
        const item: any = {
          isVisible: vi.fn(() => Promise.resolve(callCount >= 2)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
        };
        const first = vi.fn(() => item);
        return { first, isVisible: item.isVisible, click: item.click, fill: item.fill };
      });
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(true);
      expect(firstTip(result.tips)).toContain('Blogger 登录成功');
    });

    it('should navigate to blogger home after waitForHuman', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      const gotoCalls = page.goto.mock.calls.map((c: unknown[]) => c[0]);
      expect(gotoCalls).toContain('https://www.blogger.com/');
    });
  });

  describe('create-blog command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('create-blog');
      const ctx = createMockCtx();
      await expect(handler({ title: 'Test', address: 'test' }, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to blog create page', async () => {
      const handler = getHandler('create-blog');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'My Blog', address: 'my-blog' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.blogger.com/blog/create',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return blog title and address in data', async () => {
      const handler = getHandler('create-blog');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Blog', address: 'my-blog' }, ctx);
      expect(result.data.title).toBe('My Blog');
      expect(result.data.address).toBe('my-blog');
    });

    it('should call waitForHuman for CAPTCHA completion', async () => {
      const handler = getHandler('create-blog');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'T', address: 'a' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ autoDetect: true })
      );
    });
  });

  describe('publish command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('publish');
      const ctx = createMockCtx();
      await expect(handler({ title: 'Test', content: 'Hello' }, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to post create page', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'SEO Guide', content: '<p>content</p>' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.blogger.com/blog/post/create/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return title and labels in data', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'SEO Guide', content: 'body', labels: 'seo,marketing' }, ctx);
      expect(result.data.title).toBe('SEO Guide');
      expect(result.data.labels).toBe('seo,marketing');
    });

    it('should include publish tip', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Post', content: 'body' }, ctx);
      expect(firstTip(result.tips)).toContain('My Post');
      expect(firstTip(result.tips)).toContain('Blogger');
    });

    it('should call waitForHuman before publish', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'T', content: 'C' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalled();
    });
  });

  describe('update-profile command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('update-profile');
      const ctx = createMockCtx();
      await expect(handler({ url: 'https://example.com' }, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to profile edit page', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ url: 'https://example.com' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.blogger.com/profile/edit',
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
      expect(firstTip(result.tips)).toContain('Profile');
    });

    it('should handle about parameter', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com', about: 'Developer' }, ctx);
      expect(result.data.updated).toBe(true);
    });
  });
});
