import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/58pic/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search-image');
  if (!call) throw new Error('Command "search-image" not found');
  return call[1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(() => []),
    },
    ...overrides,
  };
}

describe('58pic plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name 58pic', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: '58pic' })
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
      const handler = getHandler();
      await expect(handler({ query: 'test' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to 58pic search URL', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      await handler({ query: 'design' }, ctx);
      expect(ctx.page.goto).toHaveBeenCalledWith(
        'https://www.58pic.com/search/0/design.html',
        expect.any(Object)
      );
    });

    it('should return search results with query and engine', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      const result = await handler({ query: 'design' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.query).toBe('design');
      expect(data.engine).toBe('58pic');
      expect(data.results).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      const handler = getHandler();
      const ctx = makeCtx();
      ctx.page.goto = vi.fn(() => { throw new Error('Navigation failed'); });
      const result = await handler({ query: 'design' }, ctx);
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
