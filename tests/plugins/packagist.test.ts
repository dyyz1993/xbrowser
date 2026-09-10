/**
 * packagist plugin tests (P2-1): search via fetch JSON, payload + fail path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import packagist from '../../.xcli/plugins/packagist/index.js';

type Site = { command: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
type Xcli = { createSite: ReturnType<typeof vi.fn> };

function makeMock(): { site: Site; xcli: Xcli } {
  const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  const xcli: Xcli = { createSite: vi.fn(() => site) };
  return { site, xcli };
}

function getCmd(site: Site, name: string): (params: unknown, ctx?: unknown) => Promise<unknown> {
  const call = site.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: unknown, c?: unknown) => Promise<unknown> }).handler;
}

function mockFetchResponse(payload: unknown): void {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(payload) } as unknown as Response);
}

const RESULTS = [
  { name: 'laravel/framework', description: 'Laravel Framework', downloads: 50000000, favers: 20000 },
];

describe('packagist plugin', () => {
  let site: Site, xcli: Xcli;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ site, xcli } = makeMock());
    packagist(xcli as never);
  });

  it('registers site and search command', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'packagist' }));
    expect(site.command).toHaveBeenCalledWith('search', expect.objectContaining({ result: expect.anything() }));
  });

  it('search returns ranked package list', async () => {
    mockFetchResponse({ results: RESULTS });
    const handler = getCmd(site, 'search');
    const r = JSON.stringify(await handler({ query: 'laravel', limit: 20 }));
    expect(r).toContain('laravel/framework');
    expect(r).toContain('Laravel Framework');
    expect(r).toContain('packagist.org/packages/laravel/framework');
  });

  it('returns fail on empty results', async () => {
    mockFetchResponse({ results: [] });
    const handler = getCmd(site, 'search');
    const r = JSON.stringify(await handler({ query: 'zzz', limit: 20 }));
    expect(r).toContain('No packages matched');
  });
});
