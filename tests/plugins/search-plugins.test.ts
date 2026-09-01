import { describe, it, expect, vi, beforeEach } from 'vitest';
import githubTrending from '../../.xcli/plugins/github-trending/index.js';
import packagist from '../../.xcli/plugins/packagist/index.js';
import googleScholar from '../../.xcli/plugins/google-scholar/index.js';
import pubmed from '../../.xcli/plugins/pubmed/index.js';

function makeMock() {
  const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  const mockXcli = { createSite: vi.fn(() => mockSite) };
  return { mockSite, mockXcli };
}
function getCmd(site: any, name: string) {
  const call = site.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return call[1].handler;
}

describe('github-trending', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeMock(); site = m.mockSite; xcli = m.mockXcli;
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(
      `<h2 class="h3 lh-condensed"><a href="/user/repo1">repo1</a></h2><p class="col-9 color-fg-muted">A test repo</p><span itemprop="programmingLanguage">TypeScript</span>`,
    ) });
    githubTrending(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'github-trending' }));
  });
  it('repos 返回趋势仓库', async () => {
    const r = await getCmd(site, 'repos')({ language: '', since: 'daily', limit: 25 }, {});
    expect(JSON.stringify(r)).toContain('repo1');
  });
});

describe('packagist', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeMock(); site = m.mockSite; xcli = m.mockXcli;
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ results: [
      { name: 'vendor/pkg', description: 'A test pkg', downloads: 100, favers: 5 },
    ] }) });
    packagist(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'packagist' }));
  });
  it('search 返回包列表', async () => {
    const r = await getCmd(site, 'search')({ query: 'test', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('vendor/pkg');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ results: [] }) });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No packages matched');
  });
});

describe('google-scholar', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeMock(); site = m.mockSite; xcli = m.mockXcli;
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(
      `<h3 class="gs_rt"><a href="https://example.com/p1">Test Paper</a></h3><div class="gs_rs">Snippet</div><div class="gs_a">Author - 2026</div>`,
    ) });
    googleScholar(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'google-scholar' }));
  });
  it('search 返回论文列表', async () => {
    const r = await getCmd(site, 'search')({ query: 'ml', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('Test Paper');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve('<html>empty</html>') });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No results');
  });
});

describe('pubmed', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeMock(); site = m.mockSite; xcli = m.mockXcli;
    pubmed(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'pubmed' }));
  });
  it('search 返回文献列表', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ esearchresult: { idlist: ['123'] } }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ result: {
        '123': { title: 'Cancer Research', authors: [{ name: 'Smith J' }], fulljournalname: 'Nature', pubdate: '2026-01-01', elocationid: 'doi:123' },
      } }) });
    const r = await getCmd(site, 'search')({ query: 'cancer', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('Cancer Research');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ esearchresult: { idlist: [] } }) });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No articles matched');
  });
});
