import { describe, it, expect, vi, beforeEach } from 'vitest';
import smzdm from '../../.xcli/plugins/smzdm/index.js';
import tieba from '../../.xcli/plugins/tieba/index.js';
import ths from '../../.xcli/plugins/ths/index.js';

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
function makePage(evalResult: unknown) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    evaluate: vi.fn(() => Promise.resolve(evalResult)),
  };
}

describe('smzdm', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    smzdm(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'smzdm' }));
  });
  it('hot 命令返回好价列表', async () => {
    const h = getCmd(site, 'hot');
    const mockP = makePage(JSON.stringify([
      { title: '测试好价', price: '¥99', mall: '京东' },
    ]));
    const r = await h({ filter: 'all', limit: 30 }, { page: mockP });
    expect(r).toBeDefined();
  });
  it('无 page 时抛错', async () => {
    const h = getCmd(site, 'hot');
    await expect(h({ filter: 'all' }, {})).rejects.toThrow('需要浏览器页面');
  });
});

describe('tieba', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    tieba(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'tieba' }));
  });
  it('hot 命令返回热帖列表', async () => {
    const h = getCmd(site, 'hot');
    const mockP = makePage(JSON.stringify([
      { rank: 1, title: '测试热帖', url: '/p/12345' },
    ]));
    const r = await h({ limit: 20 }, { page: mockP });
    expect(r).toBeDefined();
  });
  it('指定贴吧名返回帖子', async () => {
    const h = getCmd(site, 'hot');
    const mockP = makePage(JSON.stringify([
      { rank: 1, title: '崩坏3rd 测试帖', url: '/p/67890' },
    ]));
    const r = await h({ name: '崩坏3rd', limit: 20 }, { page: mockP });
    expect(r).toBeDefined();
  });
  it('无 page 时抛错', async () => {
    const h = getCmd(site, 'hot');
    await expect(h({ limit: 20 }, {})).rejects.toThrow('需要浏览器页面');
  });
});

describe('ths', () => {
  let site: any, xcli: any;
  beforeEach(() => {
    vi.clearAllMocks();
    ({ mockSite: site, mockXcli: xcli } = makeMock());
    ths(xcli);
  });
  it('createSite 参数正确', () => {
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'ths' }));
  });
  it('hot-rank 命令返回热股列表', async () => {
    const h = getCmd(site, 'hot-rank');
    const mockP = makePage(JSON.stringify([
      { name: '测试股票', tags: 'AI,芯片', rank: 1 },
    ]));
    const r = await h({ limit: 20 }, { page: mockP });
    expect(r).toBeDefined();
  });
  it('无 page 时抛错', async () => {
    const h = getCmd(site, 'hot-rank');
    await expect(h({ limit: 20 }, {})).rejects.toThrow('需要浏览器页面');
  });
});
