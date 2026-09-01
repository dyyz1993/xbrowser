import { describe, it, expect, vi, beforeEach } from 'vitest';
import douban from '../../.xcli/plugins/douban/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };
const mockPage = {
  goto: vi.fn(),
  waitForTimeout: vi.fn(),
  evaluate: vi.fn(() => Promise.resolve(JSON.stringify([
    { title: '星际穿越', rating: '9.4', url: 'https://movie.douban.com/subject/1889243/' },
  ]))),
};

describe('douban plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    douban(mockXcli as any);
  });

  it('createSite 参数正确', () => {
    expect(mockXcli.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'douban', url: 'https://www.douban.com' }),
    );
  });

  it('注册 search 命令', () => {
    expect(mockSite.command.mock.calls.some((c: unknown[]) => c[0] === 'search')).toBe(true);
  });

  it('search 返回搜索结果', async () => {
    const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
    const h = call![1].handler;
    const mockP = { goto: vi.fn(), waitForTimeout: vi.fn(), evaluate: vi.fn(() => Promise.resolve(JSON.stringify([
      { title: 'Interstellar', rating: '9.4', url: 'https://movie.douban.com/subject/1889243/' },
    ]))) };
    const r = await h({ type: 'movie', keyword: 'interstellar', limit: 20 }, { page: mockP });
    expect(r).toBeDefined();
  });
});
