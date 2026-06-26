import { firstTip } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/quora/index.ts';

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
      url: vi.fn(() => 'https://www.quora.com/'),
      keyboard: { insertText: vi.fn(), press: vi.fn() },
    },
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(),
    ...overrides,
  };
}

const COMMANDS = ['login', 'answer', 'publish-article', 'update-profile'];

describe('quora plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name quora', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'quora' })
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

    it('should navigate to quora login page', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.quora.com/login',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should call waitForHuman', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('Quora login') })
      );
    });

    it('should save login state to storage', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      expect(ctx.storage.set).toHaveBeenCalledWith('quora_login', expect.objectContaining({ loggedIn: false }));
    });

    it('should return loggedIn false when no profile element visible', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(false);
    });

    it('should return loggedIn true when profile element visible', async () => {
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
      expect(firstTip(result.tips)).toContain('登录成功');
    });

    it('should navigate to home after login', async () => {
      const handler = getHandler('login');
      const ctx = makeCtx();
      await handler({}, ctx);
      const gotoCalls = ctx.page.goto.mock.calls;
      expect(gotoCalls.length).toBeGreaterThanOrEqual(2);
      expect(gotoCalls[1][0]).toBe('https://www.quora.com/');
    });
  });

  describe('answer command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('answer');
      await expect(handler({ questionUrl: 'https://quora.com/q', content: 'test' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to question URL', async () => {
      const handler = getHandler('answer');
      const ctx = makeCtx();
      await handler({ questionUrl: 'https://www.quora.com/What-is-X', content: 'My answer' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.quora.com/What-is-X',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return answered data with questionUrl', async () => {
      const handler = getHandler('answer');
      const ctx = makeCtx();
      const result = await handler({ questionUrl: 'https://www.quora.com/What-is-X', content: 'My answer' }, ctx);
      expect(result.data.questionUrl).toBe('https://www.quora.com/What-is-X');
      expect(result.data.answered).toBe(true);
    });

    it('should include questionUrl in tips', async () => {
      const handler = getHandler('answer');
      const ctx = makeCtx();
      const result = await handler({ questionUrl: 'https://www.quora.com/What-is-X', content: 'answer' }, ctx);
      expect(firstTip(result.tips)).toContain('https://www.quora.com/What-is-X');
    });

    it('should call waitForHuman for review', async () => {
      const handler = getHandler('answer');
      const ctx = makeCtx();
      await handler({ questionUrl: 'https://quora.com/q', content: 'test' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalled();
    });
  });

  describe('publish-article command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('publish-article');
      await expect(handler({ title: 't', content: 'c' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to quora content page', async () => {
      const handler = getHandler('publish-article');
      const ctx = makeCtx();
      await handler({ title: 'My Guide', content: 'Check this out' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.quora.com/content',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return title and url in data', async () => {
      const handler = getHandler('publish-article');
      const ctx = makeCtx();
      const result = await handler({ title: 'My Guide', content: 'content' }, ctx);
      expect(result.data.title).toBe('My Guide');
    });

    it('should include title in tips', async () => {
      const handler = getHandler('publish-article');
      const ctx = makeCtx();
      const result = await handler({ title: 'Test Article', content: 'content' }, ctx);
      expect(firstTip(result.tips)).toContain('Test Article');
    });

    it('should call waitForHuman for review', async () => {
      const handler = getHandler('publish-article');
      const ctx = makeCtx();
      await handler({ title: 't', content: 'c' }, ctx);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('article') })
      );
    });
  });

  describe('update-profile command', () => {
    it('should throw when no page in ctx', async () => {
      const handler = getHandler('update-profile');
      await expect(handler({ url: 'https://example.com' }, { storage: { set: vi.fn() } }))
        .rejects.toThrow('需要浏览器页面上下文');
    });

    it('should navigate to quora settings page', async () => {
      const handler = getHandler('update-profile');
      const ctx = makeCtx();
      await handler({ url: 'https://example.com' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.quora.com/settings',
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
      expect(firstTip(result.tips)).toContain('外链');
    });

    it('should call waitForLoadState', async () => {
      const handler = getHandler('update-profile');
      const ctx = makeCtx();
      await handler({ url: 'https://example.com' }, ctx);
      expect(ctx.page.waitForLoadState).toHaveBeenCalled();
    });
  });

  it('should register login hook', () => {
    expect(mockSite.login).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should register logout hook', () => {
    expect(mockSite.logout).toHaveBeenCalledWith(expect.any(Function));
  });

  it('logout hook should delete login storage', async () => {
    const logoutFn = mockSite.logout.mock.calls[0][0] as Function;
    const ctx = makeCtx();
    await logoutFn(ctx);
    expect(ctx.storage.delete).toHaveBeenCalledWith('quora_login');
  });

  it('login hook should set storage', async () => {
    const loginFn = mockSite.login.mock.calls[0][0] as Function;
    const ctx = makeCtx();
    await loginFn(ctx);
    expect(ctx.storage.set).toHaveBeenCalledWith('quora_login', expect.objectContaining({ at: expect.any(Number) }));
  });
});
