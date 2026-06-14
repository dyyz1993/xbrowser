import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/stats/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      url: vi.fn(() => 'https://data.stats.gov.cn/'),
      evaluate: vi.fn(() => Promise.resolve({
        data: [
          { _id: 'abc', _name: '地区生产总值' },
        ],
      })),
    },
    storage: {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
      delete: vi.fn(),
      clear: vi.fn(),
      keys: vi.fn(() => Promise.resolve([])),
    },
    ...overrides,
  };
}

describe('stats plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name stats', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'stats' })
    );
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(expect.arrayContaining(['indicators', 'gdp', 'retail', 'query', 'report', 'export']));
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

  describe('indicators command', () => {
    it('should throw when no page available', async () => {
      const handler = getHandler('indicators');
      await expect(handler({}, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('query command', () => {
    it('should throw when no page available', async () => {
      const handler = getHandler('query');
      await expect(handler({ indicator: '总人口' }, {})).rejects.toThrow('需要浏览器页面');
    });
  });

  describe('report command', () => {
    it('should return fail when no cached data', async () => {
      const handler = getHandler('report');
      const ctx = makeCtx();
      const result = await handler({ output: '/tmp/test.html', title: 'Test' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });
  });

  describe('export command', () => {
    it('should return fail when no cached data', async () => {
      const handler = getHandler('export');
      const ctx = makeCtx();
      const result = await handler({ format: 'json', indicator: 'all' }, ctx);
      const data = (result as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toBeNull();
    });
  });

  it('should not register login hook', () => {
    expect(mockSite.login).not.toHaveBeenCalled();
  });

  it('should not register logout hook', () => {
    expect(mockSite.logout).not.toHaveBeenCalled();
  });
});
