import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/instagram/index.ts';

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
        { title: 'img', thumbnailUrl: 'https://scontent.cdninstagram.com/img.jpg', sourceUrl: '/p/1', width: 400, height: 400 },
      ]),
      url: vi.fn(() => 'https://www.instagram.com/explore/tags/cats/'),
    },
    ...overrides,
  };
}

describe('instagram plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name instagram', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'instagram' })
    );
  });

  it('should create site requiring login', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: true })
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

    it('should navigate to Instagram tag search URL', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      await handler({ query: 'cats' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.instagram.com/explore/tags/cats/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should return search results with query and engine', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      const result = await handler({ query: 'cats' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.query).toBe('cats');
      expect(data.engine).toBe('instagram');
      expect(data.results).toBeDefined();
    });

    it('should return fail when redirected to login', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      ctx.page.url = vi.fn(() => 'https://www.instagram.com/accounts/login/');
      const result = await handler({ query: 'cats' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      ctx.page.goto = vi.fn(() => { throw new Error('Navigation failed'); });
      const result = await handler({ query: 'cats' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
