/**
 * google-scholar plugin tests (P2-1): search scrapes gs_* markup via fetch text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import googleScholar from '../../.xcli/plugins/google-scholar/index.js';

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

function mockFetchText(html: string): void {
  global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(html) } as unknown as Response);
}

const GSC_HTML = `
<h3 class="gs_rt"><a id="x" href="https://example.org/paper1">Attention Is All You Need</a></h3>
<div class="gs_a">Vaswani et al. - NeurIPS 2017</div>
<div class="gs_rs">The transformer architecture.</div>
`;

describe('google-scholar plugin', () => {
  let site: Site, xcli: Xcli;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ site, xcli } = makeMock());
    googleScholar(xcli as never);
  });

  it('registers site and search command', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'google-scholar' }));
    expect(site.command).toHaveBeenCalledWith('search', expect.objectContaining({ result: expect.anything() }));
  });

  it('search parses gs_rt/gs_a/gs_rs triples into ranked results', async () => {
    mockFetchText(GSC_HTML);
    const handler = getCmd(site, 'search');
    const r = JSON.stringify(await handler({ query: 'transformer', limit: 20 }));
    expect(r).toContain('Attention Is All You Need');
    expect(r).toContain('Vaswani et al. - NeurIPS 2017');
    expect(r).toContain('The transformer architecture.');
    expect(r).toContain('https://example.org/paper1');
  });

  it('returns fail when page has no results', async () => {
    mockFetchText('<div class="gs_r">nothing here</div>');
    const handler = getCmd(site, 'search');
    const r = JSON.stringify(await handler({ query: 'zzz', limit: 20 }));
    expect(r).toContain('No results for');
  });
});
