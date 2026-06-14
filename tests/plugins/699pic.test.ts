import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/699pic/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(): (...args: unknown[]) => Promise<unknown> {
  return mockSite.command.mock.calls[0][1].handler;
}

function makeCtx() {
  return {
    page: {
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(() => []),
    },
  };
}

describe('699pic plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name 699pic', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: '699pic' })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register search-image command', () => {
    expect(mockSite.command.mock.calls[0][0]).toBe('search-image');
  });

  it('search-image should have description, scope, parameters, and handler', () => {
    const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
  });

  it('should throw when no page available', async () => {
    const handler = getHandler();
    await expect(handler({ query: 'test' }, {})).rejects.toThrow('需要浏览器页面');
  });

  it('should navigate to search URL', async () => {
    const handler = getHandler();
    const ctx = makeCtx();
    await handler({ query: 'nature' }, ctx);
    expect(ctx.page.goto).toHaveBeenCalledWith(
      expect.stringContaining('https://www.699pic.com/search/?kw=nature'),
      expect.any(Object)
    );
  });

  it('should return results with query and engine', async () => {
    const handler = getHandler();
    const ctx = makeCtx();
    const result = await handler({ query: 'nature' }, ctx);
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.query).toBe('nature');
    expect(data.engine).toBe('699pic');
  });

  it('should handle errors gracefully', async () => {
    const handler = getHandler();
    const ctx = makeCtx();
    ctx.page.goto = vi.fn(() => { throw new Error('fail'); });
    const result = await handler({ query: 'nature' }, ctx);
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data).toBeNull();
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });
});
