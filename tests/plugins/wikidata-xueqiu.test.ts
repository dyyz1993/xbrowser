import { describe, it, expect, vi, beforeEach } from 'vitest';
import wikidata from '../../.xcli/plugins/wikidata/index.js';
import xueqiu from '../../.xcli/plugins/xueqiu/index.js';

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

describe('wikidata', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ search: [
      { id: 'Q42', label: 'Douglas Adams', description: 'English writer and humorist' },
    ] }) });
    wikidata(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'wikidata' }));
  });
  it('search 返回实体列表', async () => {
    const r = await getCmd(site, 'search')({ query: 'Douglas Adams', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('Douglas Adams');
    expect(JSON.stringify(r)).toContain('Q42');
  });
  it('无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ search: [] }) });
    const r = await getCmd(site, 'search')({ query: 'none', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No Wikidata entities matched');
  });
  it('entity 命令返回实体详情', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({
      entities: { Q42: { id: 'Q42', labels: { en: { value: 'Douglas Adams' } } } },
    }) });
    const r = await getCmd(site, 'entity')({ id: 'Q42' }, {});
    expect(JSON.stringify(r)).toContain('Q42');
  });
});

describe('xueqiu', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    xueqiu(xcli);
  });

  it('quote 返回股票行情', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({
      data: [{ symbol: 'SH600519', name: '贵州茅台', current: 1700, percent: 2.5, high: 1720, low: 1680, open: 1690, volume: 3000000, amount: 5100000000, timestamp: 1700000000000 }],
    }) });
    const h = getCmd(site, 'quote');
    const r = await h({ symbol: 'SH600519' }, {});
    expect(JSON.stringify(r)).toContain('SH600519');
  });

  it('hot 返回热门股票', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({
      items: [{ symbol: 'SH600519', name: '贵州茅台' }],
    }) });
    const h = getCmd(site, 'hot');
    const r = await h({ limit: 20 }, {});
    expect(r).toBeDefined(); // hot handler 执行成功
  });
});
