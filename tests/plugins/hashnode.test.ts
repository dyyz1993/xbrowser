import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/hashnode/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function createMockLocator() {
  const item: any = {
    isVisible: vi.fn(() => Promise.resolve(false)),
    click: vi.fn(() => Promise.resolve()),
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
    url: vi.fn(() => 'https://hashnode.com/'),
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

const ALL_COMMANDS = ['login', 'publish', 'draft', 'update-profile'];

describe('hashnode plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name hashnode', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'hashnode' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://hashnode.com' })
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

    it('should navigate to hashnode signin page', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://hashnode.com/signin',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('Hashnode') })
      );
    });

    it('should save login state to storage', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(ctx.storage.set).toHaveBeenCalledWith(
        'hashnode_login',
        expect.objectContaining({ loggedIn: false })
      );
    });

    it('should return not-logged-in tip when selector not visible', async () => {
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
      let callCount = 0;
      page.locator = vi.fn(() => {
        callCount++;
        const item: any = {
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
        };
        const first = vi.fn(() => item);
        return { first, isVisible: item.isVisible, click: item.click, fill: item.fill };
      });
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(true);
      expect(result.tips[0]).toContain('Hashnode 登录成功');
    });

    it('should navigate to hashnode home after login attempt', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      const gotoCalls = page.goto.mock.calls.map((c: unknown[]) => c[0]);
      expect(gotoCalls).toContain('https://hashnode.com/');
    });
  });

  describe('publish command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('publish');
      const ctx = createMockCtx();
      await expect(handler({ title: 'T', content: 'C' }, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to draft page', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'My Guide', content: '# Hello' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://hashnode.com/draft',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return title and tags in data', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Guide', content: 'body', tags: 'js,webdev' }, ctx);
      expect(result.data.title).toBe('My Guide');
      expect(result.data.tags).toBe('js,webdev');
    });

    it('should include publish tip with title', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Test Post', content: 'body' }, ctx);
      expect(result.tips[0]).toContain('Test Post');
      expect(result.tips[0]).toContain('Hashnode');
    });

    it('should call waitForHuman before publish', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'T', content: 'C' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ autoDetect: true })
      );
    });

    it('should handle tags by splitting and pressing enter for each', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      let callCount = 0;
      page.locator = vi.fn(() => {
        callCount++;
        const item: any = {
          isVisible: vi.fn(() => Promise.resolve(callCount >= 3)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
        };
        const first = vi.fn(() => item);
        return { first, isVisible: item.isVisible, click: item.click, fill: item.fill };
      });
      const ctx = createMockCtx(page);
      await handler({ title: 'T', content: 'C', tags: 'js,webdev,react' }, ctx);
      expect(page.keyboard.press).toHaveBeenCalledTimes(3);
    });
  });

  describe('draft command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('draft');
      const ctx = createMockCtx();
      await expect(handler({ title: 'T', content: 'C' }, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to draft page', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'Draft', content: 'Content' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://hashnode.com/draft',
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

  describe('update-profile command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('update-profile');
      const ctx = createMockCtx();
      await expect(handler({ url: 'https://example.com' }, ctx)).rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to settings page', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ url: 'https://example.com' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://hashnode.com/settings',
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
});
