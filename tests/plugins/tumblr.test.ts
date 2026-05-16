import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/tumblr/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      waitForLoadState: vi.fn(),
      evaluate: vi.fn(() => [
        { title: 'test image', thumbnailUrl: 'https://media.tumblr.com/img.jpg', sourceUrl: 'https://tumblr.com/post/1', width: 400, height: 300 },
      ]),
      locator: vi.fn(() => ({
        first: vi.fn(() => ({
          isVisible: vi.fn(() => Promise.resolve(false)),
          click: vi.fn(),
          fill: vi.fn(),
        })),
      })),
    },
    ...overrides,
  };
}

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

  it('should create site without requiring login', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: false })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register search-image command', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['search-image']);
  });

  it('search-image should have description, scope, parameters, and handler', () => {
    const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
    expect(typeof config.handler).toBe('function');
  });

  describe('search-image command', () => {
    it('should throw when no page available', async () => {
      const handler = getHandler('search-image');
      await expect(handler({ query: 'cats' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to tumblr search URL', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      await handler({ query: 'cute cats' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.tumblr.com/search/cute%20cats',
        expect.objectContaining({ waitUntil: 'networkidle' })
      );
    });

    it('should return search results with query and engine', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      const result = await handler({ query: 'cats' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.query).toBe('cats');
      expect(data.engine).toBe('tumblr');
      expect(data.results).toBeDefined();
    });

    it('should scroll page to load more images', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      await handler({ query: 'cats' }, ctx);
      // 5 scrolls + initial wait
      expect(ctx.page.evaluate).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      ctx.page.goto = vi.fn(() => { throw new Error('Navigation failed'); });
      const result = await handler({ query: 'cats' }, ctx);
      expect((result as Record<string, unknown>).data).toBeNull();
      expect((result as Record<string, unknown>).message).toBe('Navigation failed');
    });
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
