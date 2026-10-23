import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * 测试隔离：facade 会真实探测 127.0.0.1:9347（chrome-bridge）与 9355
 * （login-bridge）。本机服务在线与否会让 availableEnvironments 在 1/2
 * 间漂移——CI（无本地服务）恒为 1。统一 stub fetch 返回"服务在线"。
 */
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes(':9347/status')) {
      return { ok: true, json: async () => ({ running: true, clients: [{ id: 'ext' }] }) };
    }
    if (url.includes(':9355/cookies')) {
      return { ok: true, json: async () => ({ cookies: [] }) };
    }
    return { ok: false, json: async () => ({}) };
  }) as never;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const {
  mockDaemonPing,
  mockForwardCommandLog,
  mockForwardNetworkList,
  mockForwardSessionList,
  mockGetDaemonProcessStatus,
  mockPluginList,
  mockGetPluginLoader,
} = vi.hoisted(() => ({
  mockDaemonPing: vi.fn(),
  mockForwardCommandLog: vi.fn(),
  mockForwardNetworkList: vi.fn(),
  mockForwardSessionList: vi.fn(),
  mockGetDaemonProcessStatus: vi.fn(),
  mockPluginList: vi.fn(),
  mockGetPluginLoader: vi.fn(),
}));

vi.mock('../../src/client/daemon-client.js', () => ({
  daemonPing: mockDaemonPing,
  forwardCommandLog: mockForwardCommandLog,
  forwardNetworkList: mockForwardNetworkList,
  forwardSessionList: mockForwardSessionList,
}));

vi.mock('../../src/daemon/daemon.js', () => ({
  getDaemonProcessStatus: mockGetDaemonProcessStatus,
}));

vi.mock('../../src/plugin/installer.js', () => ({
  PluginInstaller: vi.fn().mockImplementation(() => ({ list: mockPluginList })),
}));

vi.mock('../../src/utils/plugin-singleton.js', () => ({
  getPluginLoader: mockGetPluginLoader,
}));

import { buildConsoleOverview } from '../../src/console/facade.js';

describe('console facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDaemonPing.mockResolvedValue({ ok: true, pid: 123 });
    mockGetDaemonProcessStatus.mockReturnValue({ running: true, pid: 123, port: 9224, info: {} });
    mockForwardSessionList.mockResolvedValue([{ id: 's1', name: 'work', url: 'https://example.com/page' }]);
    mockForwardCommandLog.mockResolvedValue({ session: 'work', commands: [{ id: 1 }] });
    mockForwardNetworkList.mockResolvedValue({ session: 'work', captures: [{ id: 1 }] });
    mockPluginList.mockResolvedValue([
      {
        id: 'xbrowser-plugin-gemini',
        name: 'xbrowser-plugin-gemini',
        source: 'local',
        metadata: {
          name: 'gemini',
          description: 'Gemini helper',
          version: '1.1.1',
          tags: ['ai'],
          commands: ['image', 'music'],
          sites: ['https://gemini.google.com'],
        },
      },
    ]);
    mockGetPluginLoader.mockResolvedValue({
      getCore: () => ({
        loader: {
          getSites: () => [{
            config: { name: 'gemini' },
            getAllCommands: () => [{ name: 'image' }, { name: 'music' }],
          }],
        },
      }),
    });
  });

  it('builds a readonly overview from daemon, plugin and evidence sources', async () => {
    const overview = await buildConsoleOverview({ includeEvidence: true });
    expect(overview.readonly).toBe(true);
    expect(overview.stats).toEqual({
      runningSessions: 1,
      availableEnvironments: 2,
      installedPlugins: 1,
      loadedPlugins: 1,
    });
    expect(overview.sessions[0]).toMatchObject({
      environmentId: 'daemon',
      status: 'running',
      previewUrl: 'http://127.0.0.1:9224/preview/work',
    });
    expect(overview.plugins[0]).toMatchObject({ status: 'loaded', commands: ['image', 'music'] });
    expect(overview.evidence).toMatchObject({ session: 'work' });
  });

  it('stays available when optional local services fail', async () => {
    mockForwardCommandLog.mockRejectedValue(new Error('down'));
    mockForwardNetworkList.mockRejectedValue(new Error('down'));
    const overview = await buildConsoleOverview({ includeEvidence: true });
    expect(overview.stats.runningSessions).toBe(1);
    expect(overview.evidence).toMatchObject({ session: 'work', commandLog: null, network: null });
  });
});
