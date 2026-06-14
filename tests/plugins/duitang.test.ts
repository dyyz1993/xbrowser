import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/duitang/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function makeCtx() {
  return {
    page: {
      goto: vi.fn(() => Promise.resolve()),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(() => []),
      url: vi.fn(() => 'https://www.duitang.com/search/?kw=test'),
    },
  };
}

describe('duitang plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name duitang', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'duitang', url: 'https://www.duitang.com' })
    );
  });

  it('should register 1 search-image command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
    expect(mockSite.command.mock.calls[0][0]).toBe('search-image');
  });

  it('search-image should have config fields', () => {
    const config = mockSite.command.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toHaveProperty('description');
    expect(config).toHaveProperty('scope');
    expect(config).toHaveProperty('parameters');
    expect(config).toHaveProperty('handler');
  });

  it('should throw when no page available', async () => {
    const handler = mockSite.command.mock.calls[0][1].handler;
    await expect(handler({ query: 'food' }, {})).rejects.toThrow('需要浏览器页面');
  });

  it('should navigate to search URL', async () => {
    const handler = mockSite.command.mock.calls[0][1].handler;
    const ctx = makeCtx();
    await handler({ query: 'food' }, ctx);
    expect(ctx.page.goto).toHaveBeenCalledWith(
      'https://www.duitang.com/search/?kw=food',
      expect.any(Object)
    );
  });

  it('should return results with query and engine', async () => {
    const handler = mockSite.command.mock.calls[0][1].handler;
    const ctx = makeCtx();
    const result = await handler({ query: 'food' }, ctx);
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.query).toBe('food');
    expect(data.engine).toBe('duitang');
  });

  it('should handle errors', async () => {
    const handler = mockSite.command.mock.calls[0][1].handler;
    const ctx = makeCtx();
    ctx.page.goto = vi.fn(() => { throw new Error('fail'); });
    const result = await handler({ query: 'food' }, ctx);
    expect((result as Record<string, unknown>).data).toBeNull();
  });

  it('should not register login/logout hooks', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
