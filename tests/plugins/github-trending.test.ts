/**
 * github-trending plugin tests (P2-1): repos scrape trending markup via fetch text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import githubTrending from '../../.xcli/plugins/github-trending/index.js';

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

const TRENDING_HTML = `
<h2 class="h3 lh-condensed"><a href="/facebook/react">facebook / react</a></h2>
<p class="col-9 color-fg-muted">A declarative UI library</p>
<span itemprop="programmingLanguage">JavaScript</span>
`;

describe('github-trending plugin', () => {
  let site: Site, xcli: Xcli;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ site, xcli } = makeMock());
    githubTrending(xcli as never);
  });

  it('registers site and repos command', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'github-trending' }));
    expect(site.command).toHaveBeenCalledWith('repos', expect.objectContaining({ result: expect.anything() }));
  });

  it('repos parses trending entries into ranked results', async () => {
    mockFetchText(TRENDING_HTML);
    const handler = getCmd(site, 'repos');
    const r = JSON.stringify(await handler({ since: 'daily', limit: 25 }));
    expect(r).toContain('facebook');
    expect(r).toContain('react');
    expect(r).toContain('A declarative UI library');
    expect(r).toContain('JavaScript');
  });

  it('returns fail when trending page has no entries', async () => {
    mockFetchText('<div>empty page</div>');
    const handler = getCmd(site, 'repos');
    const r = JSON.stringify(await handler({ since: 'weekly', limit: 10 }));
    expect(r).toContain('No trending repos found');
  });
});
