/**
 * semanticscholar plugin tests (P2-1): search via fetch JSON, payload + fail path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import semanticscholar from '../../.xcli/plugins/semanticscholar/index.js';

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

const PAPER = {
  paperId: 'abc123', title: 'Attention Is All You Need', year: 2017,
  authors: [{ name: 'Vaswani' }, { name: 'Shazeer' }], citationCount: 90000,
  externalIds: { DOI: '10.5555/3295222' },
};

describe('semanticscholar plugin', () => {
  let site: Site, xcli: Xcli;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ site, xcli } = makeMock());
    semanticscholar(xcli as never);
  });

  it('registers site and search command', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'semanticscholar' }));
    expect(site.command).toHaveBeenCalledWith('search', expect.objectContaining({ result: expect.anything() }));
  });

  it('search returns ranked paper list with authors and DOI link', async () => {
    mockFetchResponse({ data: [PAPER] });
    const handler = getCmd(site, 'search');
    const r = JSON.stringify(await handler({ query: 'transformer', limit: 20 }));
    expect(r).toContain('Attention Is All You Need');
    expect(r).toContain('Vaswani');
    expect(r).toContain('doi.org/10.5555/3295222');
  });

  it('returns fail on empty results', async () => {
    mockFetchResponse({ data: [] });
    const handler = getCmd(site, 'search');
    const r = JSON.stringify(await handler({ query: 'zzz', limit: 20 }));
    expect(r).toContain('No papers matched');
  });
});
