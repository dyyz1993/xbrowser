import { firstTip } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/blogger/index.ts';
import { HumanWaitRequiredError } from '../../src/plugin/human-wait.js';

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
  // Blogger 页面的定位链会用到 .filter({ hasText }) —— mock 必须支持，否则链式调用炸
  const filter = vi.fn(() => self);
  const self: any = { first, isVisible: item.isVisible, click: item.click, fill: item.fill, filter };
  return self;
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

const ALL_COMMANDS = ['login', 'create-blog', 'draft', 'publish', 'update-profile'];

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
      const ctx = createMockCtx();
      await expect(handler({}, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    function loggedInPage() {
      const page = createMockPage();
      page.locator = vi.fn(() => {
        const item: any = {
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
        };
        const first = vi.fn(() => item);
        return { first, isVisible: item.isVisible, click: item.click, fill: item.fill };
      });
      return page;
    }

    it('resolves without handing off when Blogger is already logged in', async () => {
      const handler = getHandler('login');
      const page = loggedInPage();
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data).toEqual({ loggedIn: true, url: 'https://www.blogger.com/' });
      expect(firstTip(result.tips)).toContain('已是登录状态');
      expect(ctx.waitForHuman).not.toHaveBeenCalled();
      expect(page.goto).toHaveBeenCalledTimes(1);
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.blogger.com/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
      expect(ctx.storage.set).toHaveBeenCalledWith(
        'blogger_login',
        expect.objectContaining({ loggedIn: true })
      );
    });

    it('opens the login page and rejects with NEEDS_HUMAN when logged out', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      ctx.waitForHuman = vi.fn(() =>
        Promise.reject(new HumanWaitRequiredError('需要人工协助', '完成 Blogger 登录')));
      await expect(handler({}, ctx)).rejects.toBeInstanceOf(HumanWaitRequiredError);
      expect(page.goto.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        'https://www.blogger.com/',
        'https://www.blogger.com/about/',
      ]);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('Blogger') })
      );
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });

    it('refuses to store login state when a returned handoff still has no session', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await expect(handler({}, ctx)).rejects.toThrow('仍未检测到登录态');
      expect(page.goto.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        'https://www.blogger.com/',
        'https://www.blogger.com/about/',
        'https://www.blogger.com/',
      ]);
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });

    it('should return success tip when logged in', async () => {
      const handler = getHandler('login');
      const page = loggedInPage();
      let checkCount = 0;
      page.locator = vi.fn(() => {
        checkCount++;
        const item: any = {
          isVisible: vi.fn(() => Promise.resolve(checkCount >= 2)),
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
  });

  describe('create-blog command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('create-blog');
      const ctx = createMockCtx();
      await expect(handler({ title: 'Test', address: 'test' }, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should open the reading dashboard (create-blog.g is an SPA route)', async () => {
      const handler = getHandler('create-blog');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'My Blog', address: 'my-blog' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.blogger.com/dashboard/reading',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should fail when the create CTA is not visible', async () => {
      const handler = getHandler('create-blog');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Blog', address: 'my-blog' }, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe('publish command (shared publishing protocol)', () => {
    it('should be registered by registerPublishingCommands', () => {
      const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(names).toContain('publish');
      expect(names).toContain('draft');
    });

    it('should fail when neither content nor file provided', async () => {
      const handler = getHandler('publish');
      const ctx = createMockCtx(createMockPage());
      const result = await handler({ title: 'T' }, ctx);
      expect(result.success).toBe(false);
    });

    it('should declare title/file/images parameters', () => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'publish')!;
      const shape = (call[1] as { parameters: { shape: Record<string, unknown> } }).parameters.shape;
      expect(Object.keys(shape)).toEqual(expect.arrayContaining(['title', 'content', 'file', 'images']));
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
