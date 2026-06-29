import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../.xcli/plugins/shared/anti-bot-detect.js', () => ({
  detectAntiBot: vi.fn(() => Promise.resolve({ detected: false })),
}));
import plugin from '../../.xcli/plugins/pinterest/index.ts';

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
      evaluate: vi.fn(() => [
        { title: 'pin', thumbnailUrl: 'https://i.pinimg.com/img.jpg', sourceUrl: 'https://www.pinterest.com/pin/1', originalUrl: 'https://i.pinimg.com/img.jpg', width: 400, height: 400, format: 'jpg', sourceSite: 'pinterest' },
      ]),
      url: vi.fn(() => 'https://www.pinterest.com/search/pins/?q=cats'),
    },
    ...overrides,
  };
}

describe('pinterest plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name pinterest', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'pinterest' })
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

    it('should navigate to Pinterest search URL', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      await handler({ query: 'cats' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.pinterest.com/search/pins/?q=cats',
        expect.objectContaining({ waitUntil: 'networkidle' })
      );
    });

    it('should return search results with query and engine', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      const result = await handler({ query: 'cats' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.query).toBe('cats');
      expect(data.engine).toBe('pinterest');
      expect(data.results).toBeDefined();
    });

    it('should return fail when redirected to login', async () => {
      const handler = getHandler('search-image');
      const ctx = makeCtx();
      ctx.page.url = vi.fn(() => 'https://www.pinterest.com/login');
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
