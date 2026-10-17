import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/confluence/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
const originalFetch = globalThis.fetch;

function handlerOf(name: string): (params: unknown, ctx?: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('confluence plugin', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as never); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('registers pages and search commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'confluence' }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual(['pages', 'search']);
  });

  it('fails without authorization header', async () => {
    const result = await handlerOf('pages')({}, {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('Authorization');
  });

  it('lists pages with auth header', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ results: [{ id: '123', title: 'Doc', space: { key: 'DEV' } }] }),
    })) as unknown as typeof fetch;
    const result = await handlerOf('pages')({ space: 'DEV', limit: 5 }, { authorization: 'Bearer test' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: '123', title: 'Doc', space: 'DEV', url: 'https://xxx.atlassian.net/wiki/pages/viewpage.action?pageId=123', rank: 1 }]);
  });

  it('searches content', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ results: [{ id: '456', title: 'Found', type: 'page', excerpt: 'matching content', _links: { webui: '/pages/viewpage.action?pageId=456' } }] }),
    })) as unknown as typeof fetch;
    const result = await handlerOf('search')({ query: 'test', limit: 5 }, { authorization: 'Bearer test' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: '456', title: 'Found', type: 'page', url: 'https://xxx.atlassian.net/wiki/pages/viewpage.action?pageId=456', excerpt: 'matching content', rank: 1 }]);
  });
});
