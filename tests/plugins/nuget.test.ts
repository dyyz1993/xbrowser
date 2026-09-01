import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/nuget/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };

const NUGET_RESPONSE = { data: [
  { id: 'Newtonsoft.Json', version: '13.0.3', description: 'Popular JSON framework', authors: ['James Newton-King'], totalDownloads: 14000000000, tags: ['json'] },
] };

function createMockPage() { return {}; }
function getHandler() {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
  if (!call) throw new Error('search not registered');
  return call[1].handler;
}

describe('nuget plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve(NUGET_RESPONSE) });
    plugin(mockXcli as any);
  });

  it('createSite 参数正确', () => {
    expect(mockXcli.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nuget', requiresLogin: false }),
    );
  });

  it('注册 search 命令', () => {
    expect(mockSite.command.mock.calls.some((c: unknown[]) => c[0] === 'search')).toBe(true);
  });

  it('正常返回搜索结果', async () => {
    const h = getHandler();
    const r = await h({ query: 'json', limit: 20 }, { page: createMockPage() });
    const data = (r as any).data ?? r;
    expect(JSON.stringify(data)).toContain('Newtonsoft.Json');
  });

  it('无结果时返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: [] }) });
    const h = getHandler();
    const r = await h({ query: 'nonexistent' }, { page: createMockPage() });
    expect(JSON.stringify(r)).toContain('No packages matched');
  });
});
