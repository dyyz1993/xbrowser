import { tipsMessages } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/bing/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = []) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
        fill: vi.fn(),
      })),
    })),
  };
}

const ALL_COMMANDS = ['search-image', 'webmaster-config', 'push-url'];

describe('bing plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name bing', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'bing' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://www.bing.com' })
    );
  });

  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: false })
    );
  });

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(3);
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

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });

  // ─── search-image command ───
  describe('search-image command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search-image');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should throw when no page available', async () => {
      const handler = getHandler('search-image');
      await expect(handler({ query: 'cats' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to bing images search URL', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([]);
      await handler({ query: 'cute cats', limit: 10 }, { page });
      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('https://www.bing.com/images/search?q=cute%20cats'),
        expect.any(Object)
      );
    });

    it('should return results with query and engine', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'Cat', thumbnailUrl: 'https://t.com/img.jpg', sourceUrl: '', originalUrl: 'https://t.com/img.jpg', width: 400, height: 300, format: 'jpg', fileSize: '' },
      ]);
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.query).toBe('cats');
      expect(data.engine).toBe('bing-images');
      const results = data.results as unknown[];
      expect(results).toHaveLength(1);
    });

    it('should append size filter to URL', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([]);
      await handler({ query: 'cats', limit: 10, size: 'large' }, { page });
      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('imagesize-large'),
        expect.any(Object)
      );
    });

    it('should append type filter to URL', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([]);
      await handler({ query: 'cats', limit: 10, type: 'photo' }, { page });
      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('photo-photo'),
        expect.any(Object)
      );
    });

    it('should include count in tips', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([
        { title: 'Cat', thumbnailUrl: 'https://t.com/img.jpg', sourceUrl: '', originalUrl: '', width: 100, height: 100, format: 'jpg', fileSize: '' },
      ]);
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      const tips = tipsMessages(result.tips);
      expect(tips.some((t) => t.includes('1 张'))).toBe(true);
    });

    it('should return fail on navigation error', async () => {
      const handler = getHandler('search-image');
      const page = createMockPage([]);
      page.goto = vi.fn(() => { throw new Error('Navigation failed'); });
      const result = await handler({ query: 'cats', limit: 10 }, { page }) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── webmaster-config command ───
  describe('webmaster-config command', () => {
    it('should have cli scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'webmaster-config');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('cli');
    });

    it('should save config to storage', async () => {
      const handler = getHandler('webmaster-config');
      const storage = { set: vi.fn() };
      const result = await handler({ host: 'xbrowser.dev', key: 'mykey123' }, { storage }) as Record<string, unknown>;
      expect(storage.set).toHaveBeenCalledWith('bing_webmaster', { host: 'xbrowser.dev', key: 'mykey123' });
      const data = result.data as Record<string, unknown>;
      expect(data.saved).toBe(true);
    });
  });

  // ─── push-url command ───
  describe('push-url command', () => {
    it('should have cli scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'push-url');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('cli');
    });

    it('should return fail when no host or key provided', async () => {
      const handler = getHandler('push-url');
      const storage = { get: vi.fn(() => Promise.resolve(null)) };
      const result = await handler({ urls: ['https://xbrowser.dev/'] }, { storage }) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toContain('host');
    });
  });
});
