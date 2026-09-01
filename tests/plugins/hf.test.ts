import { describe, it, expect, vi, beforeEach } from 'vitest';
import hf from '../../.xcli/plugins/hf/index.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };

const MODELS = [
  { modelId: 'meta-llama/Llama-3', pipeline_tag: 'text-generation', downloads: 5000000, likes: 8000, lastModified: '2026-01-15T00:00:00Z' },
];
const DATASETS = [
  { id: 'squad', downloads: 1000000, likes: 500, lastModified: '2026-01-01T00:00:00Z' },
];

describe('hf plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hf(mockXcli as any);
  });

  it('createSite 参数正确', () => {
    expect(mockXcli.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'hf', requiresLogin: false }),
    );
  });

  it('注册 models 和 datasets 命令', () => {
    expect(mockSite.command.mock.calls.some((c: unknown[]) => c[0] === 'models')).toBe(true);
    expect(mockSite.command.mock.calls.some((c: unknown[]) => c[0] === 'datasets')).toBe(true);
  });

  it('models 返回模型列表', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve(MODELS) });
    const h = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'models')![1].handler;
    const r = await h({ query: 'llama', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('Llama-3');
  });

  it('datasets 返回数据集列表', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve(DATASETS) });
    const h = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'datasets')![1].handler;
    const r = await h({ query: 'squad', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('squad');
  });

  it('models 无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    const h = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'models')![1].handler;
    const r = await h({ query: 'nonexistent', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No models matched');
  });

  it('datasets 无结果返回 fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    const h = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'datasets')![1].handler;
    const r = await h({ query: 'nonexistent', limit: 20 }, {});
    expect(JSON.stringify(r)).toContain('No datasets matched');
  });
});
