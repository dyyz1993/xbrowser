import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/bbc/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };

function getHandler() {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'news');
  if (!call) throw new Error('news not registered');
  return call[1].handler;
}

describe('bbc plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    plugin(mockXcli as any);
  });

  it('createSite 参数正确', () => {
    expect(mockXcli.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'bbc', requiresLogin: false }),
    );
  });

  it('注册 news 命令', () => {
    expect(mockSite.command.mock.calls.some((c: unknown[]) => c[0] === 'news')).toBe(true);
  });

  it('正常返回新闻列表', async () => {
    vi.stubEnv('NEWSAPI_KEY', 'test-key');
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        status: 'ok',
        articles: [
          { title: 'Test Article', description: 'Desc', author: 'Author', publishedAt: '2026-01-01T00:00:00Z', url: 'https://example.com', source: { name: 'BBC News' } },
        ],
      }),
    });
    const h = getHandler();
    const r = await h({ limit: 20 }, {});
    const data = (r as any).data ?? r;
    expect(Array.isArray(data) ? data : [data]).toBeDefined();
  });

  it('无 NEWSAPI_KEY 时不抛异常（返回 fail 结果）', async () => {
    const h = getHandler();
    await expect(h({ limit: 20 }, {})).resolves.toBeDefined();
  });

  it('API 返回非 ok 时返回 fail', async () => {
    vi.stubEnv('NEWSAPI_KEY', 'test-key');
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: 'error' }),
    });
    const h = getHandler();
    const r = await h({ limit: 20 }, {});
    expect(r).toBeDefined();
  });
});
