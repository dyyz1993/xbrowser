import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/npm/index.ts';

// —— mock XCLIAPI（参考 devto.test.ts 的三件套）——
const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

// API 型测试：mock 全局 fetch
function mockFetchOnce(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => payload,
    ok: true,
  })) as unknown as typeof fetch);
}

const ALL_COMMANDS = ['search', 'package', 'downloads'];

describe('npm plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ——— L1 注册 ———
  it('should create site with name npm', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'npm' })
    );
  });

  it('should create site with the npm registry url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://www.npmjs.com' })
    );
  });

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(3);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  // ——— L3 关键路径：search ———
  describe('search command', () => {
    it('should fetch the npm registry search endpoint', async () => {
      mockFetchOnce({ objects: [] });
      const handler = getHandler('search');
      await handler({ query: 'react', limit: 20 }, {});
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('registry.npmjs.org/-/v1/search')
      );
      expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
        encodeURIComponent('react')
      );
    });

    it('should map results to rank/name/version shape', async () => {
      mockFetchOnce({
        objects: [
          {
            package: { name: 'react', version: '18.0.0', description: 'UI lib' },
            downloads: { weekly: 100 },
          },
        ],
      });
      const result = await getHandler('search')({ query: 'react', limit: 20 }, {});
      expect(result.data[0]).toMatchObject({
        rank: 1,
        name: 'react',
        version: '18.0.0',
        description: 'UI lib',
        weeklyDownloads: 100,
      });
    });

    it('should fail when no results', async () => {
      mockFetchOnce({ objects: [] });
      const result = await getHandler('search')({ query: 'xxx', limit: 20 }, {});
      expect(result.success).toBe(false);
    });
  });

  // ——— L3 关键路径：package ———
  describe('package command', () => {
    it('should fetch registry + downloads endpoints', async () => {
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          calls++;
          const payload =
            calls === 1
              ? {
                  name: 'react',
                  'dist-tags': { latest: '18.0.0' },
                  versions: { '18.0.0': { license: 'MIT' } },
                  description: 'UI lib',
                  keywords: ['react'],
                  readme: 'r',
                  maintainers: [{ name: 'gaearon' }],
                }
              : { downloads: 5000 };
          return { json: async () => payload, ok: true } as Response;
        }) as unknown as typeof fetch
      );
      const result = await getHandler('package')({ name: 'react' }, {});
      expect(result.data).toMatchObject({
        name: 'react',
        version: '18.0.0',
        monthlyDownloads: 5000,
      });
    });

    it('should fail when package not found', async () => {
      mockFetchOnce({ error: 'Not found' });
      const result = await getHandler('package')({ name: 'nope' }, {});
      expect(result.success).toBe(false);
    });
  });

  // ——— L3 关键路径：downloads ———
  describe('downloads command', () => {
    it('should reject invalid period', async () => {
      const result = await getHandler('downloads')(
        { name: 'react', period: 'invalid' },
        {}
      );
      expect(result.success).toBe(false);
    });

    it('should return download stats for valid period', async () => {
      mockFetchOnce({
        package: 'react',
        downloads: 999,
        startDate: '2026-05-27',
        endDate: '2026-06-27',
      });
      const result = await getHandler('downloads')(
        { name: 'react', period: 'last-month' },
        {}
      );
      expect(result.data.downloads).toBe(999);
      expect(result.data.package).toBe('react');
    });
  });
});
