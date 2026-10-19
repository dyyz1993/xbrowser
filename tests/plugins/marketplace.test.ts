import { describe, expect, it, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/marketplace/index.ts';

type Site = {
  command: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
};

function makeMock(): { site: Site; xcli: { createSite: ReturnType<typeof vi.fn> } } {
  const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  return { site, xcli: { createSite: vi.fn(() => site) } };
}

function getHandler(site: Site, name: string): (params: unknown, ctx?: unknown) => Promise<unknown> {
  const call = site.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`Command not registered: ${name}`);
  return (call[1] as { handler: (params: unknown, ctx?: unknown) => Promise<unknown> }).handler;
}

function createContext(storage = {}) {
  return {
    cwd: '/repo',
    config: {},
    storage: {
      get: vi.fn(async (key: string) => (storage as Record<string, unknown>)[key] ?? null),
      set: vi.fn(async () => undefined),
    },
  };
}

describe('marketplace plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('registers the official publisher commands', () => {
    const { site, xcli } = makeMock();
    plugin(xcli as never);
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'marketplace' }));
    expect(site.command.mock.calls.map(call => call[0])).toEqual(['login', 'status', 'publish']);
  });

  it('rejects publishing without a saved token', async () => {
    const { site, xcli } = makeMock();
    plugin(xcli as never);
    const result = await getHandler(site, 'publish')({ directory: '.' }, createContext());
    expect(JSON.stringify(result)).toContain('未登录 Marketplace');
  });

  it('verifies and stores a token during login', async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        text: async () =>
          JSON.stringify({ success: true, data: { username: 'developer' } }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { site, xcli } = makeMock();
    plugin(xcli as never);
    const ctx = createContext();
    const result = await getHandler(site, 'login')({ token: 'token' }, ctx);
    expect(JSON.stringify(result)).toContain('"loggedIn":true');
    expect(ctx.storage.set).toHaveBeenCalledWith('marketplace_token', {
      token: 'token',
      baseUrl: 'https://xbrowser.dev',
      savedAt: expect.any(Number),
    });
    vi.unstubAllGlobals();
  });

  it('reports status through the verification API', async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        text: async () =>
          JSON.stringify({ success: true, data: { username: 'developer' } }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { site, xcli } = makeMock();
    plugin(xcli as never);
    const result = await getHandler(site, 'status')(
      {},
      createContext({ marketplace_token: { token: 'token', baseUrl: 'https://xbrowser.dev' } }),
    );
    expect(JSON.stringify(result)).toContain('"username":"developer"');
    vi.unstubAllGlobals();
  });
});
