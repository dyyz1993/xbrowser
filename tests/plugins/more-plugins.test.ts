import { describe, it, expect, vi, beforeEach } from 'vitest';
import rubygems from '../../.xcli/plugins/rubygems/index.js';
import semanticscholar from '../../.xcli/plugins/semanticscholar/index.js';
import stackoverflow from '../../.xcli/plugins/stackoverflow/index.js';
import weread from '../../.xcli/plugins/weread/index.js';

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

describe('rubygems', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve([
      { name: 'rails', version: '7.1.0', description: 'Ruby web framework', downloads: 500000000, authors: 'David Heinemeier Hansson' },
    ]) });
    rubygems(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'rubygems' }));
  });
  it('search 返回 gems 列表', async () => {
    const r = await getCmd(site, 'search')({ query: 'rails', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('rails');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No gems matched');
  });
});

describe('semanticscholar', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: [
      { paperId: 'p1', title: 'Attention Is All You Need', year: 2017, authors: [{ name: 'Vaswani' }], citationCount: 100000, externalIds: { DOI: '10.1234/attention' } },
    ] }) });
    semanticscholar(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'semanticscholar' }));
  });
  it('search 返回论文列表', async () => {
    const r = await getCmd(site, 'search')({ query: 'attention', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('Attention Is All You Need');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: [] }) });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No papers matched');
  });
});

describe('stackoverflow', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ items: [
      { title: 'How to use CSS flexbox', score: 500, answer_count: 3, view_count: 100000, tags: ['css','flexbox'], owner: { display_name: 'user1' }, is_answered: true, accepted_answer_id: 12345, creation_date: 1700000000, link: 'https://stackoverflow.com/q/12345' },
    ] }) });
    stackoverflow(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'stackoverflow' }));
  });
  it('search 返回问题列表', async () => {
    const r = await getCmd(site, 'search')({ query: 'flexbox', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('flexbox');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ items: [] }) });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No questions matched');
  });
});

describe('weread', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ books: [
      { bookId: 'wr123', title: '三体', author: '刘慈欣', intro: '科幻小说', cover: 'https://cover.jpg', category: '小说' },
    ] }) });
    weread(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'weread' }));
  });
  it('search 返回图书列表', async () => {
    const r = await getCmd(site, 'search')({ query: '三体', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('三体');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ books: [] }) });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('未找到');
  });
});
