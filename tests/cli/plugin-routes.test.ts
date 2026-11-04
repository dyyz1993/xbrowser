import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSearchHandler = vi.fn().mockResolvedValue({ data: { items: [] } });

const { mockOutputEnvelope, mockOutputError, mockInstallerInstall, mockInstallerInstallFromMarketplace, mockInstallerInstallWithMarketplaceFallback, mockInstallerUninstall, mockInstallerList, mockReloadPlugin, mockGetPluginContract, mockGetPluginLoader } = vi.hoisted(() => ({
  mockOutputEnvelope: vi.fn(),
  mockOutputError: vi.fn(),
  mockInstallerInstall: vi.fn(),
  mockInstallerInstallFromMarketplace: vi.fn(),
  mockInstallerInstallWithMarketplaceFallback: vi.fn(),
  mockInstallerUninstall: vi.fn(),
  mockInstallerList: vi.fn(),
  mockReloadPlugin: vi.fn(),
  mockGetPluginContract: vi.fn(),
  mockGetPluginLoader: vi.fn(() => Promise.resolve({
    getCore: () => ({
      loader: {
        getSites: () => [],
      },
    }),
    reloadPlugin: async () => undefined,
    getPluginContract: vi.fn(),
  })),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputEnvelope: mockOutputEnvelope,
  outputResult: vi.fn(),
  outputError: mockOutputError,
}));

vi.mock('../../src/plugin/installer.js', () => ({
  PluginInstaller: vi.fn().mockImplementation(() => ({
    install: mockInstallerInstall,
    installFromMarketplace: mockInstallerInstallFromMarketplace,
    installWithMarketplaceFallback: mockInstallerInstallWithMarketplaceFallback,
    uninstall: mockInstallerUninstall,
    list: mockInstallerList,
  })),
}));

vi.mock('../../src/plugin/loader.js', () => ({
  XBrowserPluginLoader: vi.fn().mockImplementation(() => ({
    reloadPlugin: mockReloadPlugin,
  })),
  setSilentPluginWarnings: vi.fn(),
}));

vi.mock('../../src/utils/plugin-singleton.js', () => ({
  getPluginLoader: mockGetPluginLoader,
}));

vi.mock('../../src/builtins/index.js', () => ({
  allBuiltins: [],
  handlePluginHelp: vi.fn(() => 'plugin help text'),
}));

vi.mock('../../src/plugin/npm-search.js', () => ({
  NPMSearcher: { search: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: vi.fn(),
  stopDaemonProcess: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
  isDaemonRunning: vi.fn(),
}));

vi.mock('../../src/plugin/builtins/shared.js', () => ({
  loadAuth: vi.fn(),
  saveAuth: vi.fn(),
  getRegistryUrl: vi.fn(),
}));

vi.mock('../../src/utils/proxy-fetch.js', () => ({
  ensureProxyFetch: vi.fn().mockResolvedValue(undefined),
}));

import { handlePlugin, handleCreate, handleDaemon } from '../../src/cli/plugin-routes.js';

function createMockSiteWithSearch(_items: Array<Record<string, unknown>> = []) {
  return {
    name: 'marketplace',
    getCommand: (name: string) => {
      if (name === 'search') {
        return { handler: mockSearchHandler };
      }
      if (name === 'info') {
        return {
          handler: vi.fn().mockResolvedValue({ data: { plugin: null } }),
        };
      }
      return null;
    },
    getAllCommands: () => [{ name: 'search' }, { name: 'info' }],
  };
}

function setupMockLoaderWithSites(sites: Record<string, unknown>[] = []) {
  mockGetPluginLoader.mockResolvedValue({
    getCore: () => ({
      loader: {
        getSites: () => sites as never[],
      },
    }),
    reloadPlugin: mockReloadPlugin,
    getPluginContract: mockGetPluginContract,
  });
}

describe('plugin-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation((msg: string) => {
      throw new Error(msg);
    });
    setupMockLoaderWithSites([]);
    mockGetPluginContract.mockReturnValue(undefined);
    mockSearchHandler.mockResolvedValue({ data: { items: [] } });
  });

  describe('handlePlugin - install', () => {
    it('should install plugin from source', async () => {
      mockInstallerInstallWithMarketplaceFallback.mockResolvedValueOnce({
        name: 'my-plugin',
        source: 'npm',
        path: '/tmp/my-plugin',
      });

      await handlePlugin(['install', 'my-plugin'], {}, 'text');

      expect(mockInstallerInstallWithMarketplaceFallback).toHaveBeenCalledWith('my-plugin', { name: undefined, force: false });
      expect(mockOutputEnvelope).toHaveBeenCalledWith(
        { success: true, data: { name: 'my-plugin', source: 'npm', path: '/tmp/my-plugin' } },
        { command: 'plugin install' },
        'text'
      );
    });

    it('should install plugin with --name and --force options', async () => {
      mockInstallerInstallWithMarketplaceFallback.mockResolvedValueOnce({
        name: 'custom-name',
        source: 'npm',
        path: '/tmp/custom-name',
      });

      await handlePlugin(['install', 'some-pkg'], { name: 'custom-name', force: true }, 'json');

      expect(mockInstallerInstallWithMarketplaceFallback).toHaveBeenCalledWith('some-pkg', {
        name: 'custom-name',
        force: true,
      });
    });

    it('should install from marketplace with --from-marketplace flag', async () => {
      mockInstallerInstallFromMarketplace.mockResolvedValueOnce({
        name: 'mp-plugin',
        source: 'marketplace',
        path: '/tmp/mp-plugin',
      });

      await handlePlugin(['install', 'mp-plugin'], { 'from-marketplace': true }, 'text');

      expect(mockInstallerInstallFromMarketplace).toHaveBeenCalledWith('mp-plugin', {
        name: undefined,
        force: false,
      });
    });

    it('should output error when no source provided for install', async () => {
      await expect(
        handlePlugin(['install'], {}, 'text')
      ).rejects.toThrow();
      expect(mockOutputError).toHaveBeenCalled();
    });
  });

  describe('handlePlugin - uninstall', () => {
    it('should uninstall a plugin by name', async () => {
      mockInstallerUninstall.mockResolvedValueOnce(undefined);
      mockInstallerList.mockResolvedValueOnce([{ name: 'my-plugin', metadata: { name: 'my-plugin' } }]);

      await handlePlugin(['uninstall', 'my-plugin'], {}, 'text');

      expect(mockInstallerUninstall).toHaveBeenCalledWith('my-plugin');
      expect(mockOutputEnvelope).toHaveBeenCalledWith({ success: true, data: { name: 'my-plugin' } }, { command: 'plugin uninstall' }, 'text');
    });

    it('should error when uninstalling a non-existent plugin', async () => {
      mockInstallerList.mockResolvedValueOnce([{ name: 'other-plugin', metadata: {} }]);

      await expect(
        handlePlugin(['uninstall', 'notexist'], {}, 'text')
      ).rejects.toThrow('not installed');
    });

    it('should output error when no name for uninstall', async () => {
      await expect(
        handlePlugin(['uninstall'], {}, 'text')
      ).rejects.toThrow();
    });
  });

  describe('handlePlugin - list', () => {
    it('should list installed plugins', async () => {
      mockInstallerList.mockResolvedValueOnce([
        { name: 'plugin-a', path: '/tmp/a' },
        { name: 'plugin-b', path: '/tmp/b' },
      ]);

      await handlePlugin(['list'], {}, 'json');

      expect(mockOutputEnvelope).toHaveBeenCalledWith(
        { success: true, data: {
          plugins: [
          { name: 'plugin-a', path: '/tmp/a', commands: undefined, version: undefined, description: undefined, hasLogin: false, loggedIn: null, requiresLoginCommands: [] },
          { name: 'plugin-b', path: '/tmp/b', commands: undefined, version: undefined, description: undefined, hasLogin: false, loggedIn: null, requiresLoginCommands: [] },
        ] } },
        { command: 'plugin list' },
        'json'
      );
    });

    it('should return empty list when no plugins installed', async () => {
      mockInstallerList.mockResolvedValueOnce([]);

      await handlePlugin(['list'], {}, 'json');

      expect(mockOutputEnvelope).toHaveBeenCalledWith({ success: true, data: { plugins: [] } }, { command: 'plugin list' }, 'json');
    });
  });

  describe('handlePlugin - reload', () => {
    it('should reload a plugin by name', async () => {
      mockReloadPlugin.mockResolvedValueOnce(undefined);

      await handlePlugin(['reload', 'my-plugin'], {}, 'text');

      expect(mockReloadPlugin).toHaveBeenCalledWith('my-plugin');
      expect(mockOutputEnvelope).toHaveBeenCalledWith({ success: true, data: { name: 'my-plugin' } }, { command: 'plugin reload' }, 'text');
    });

    it('should output error when no name for reload', async () => {
      await expect(
        handlePlugin(['reload'], {}, 'text')
      ).rejects.toThrow();
    });
  });

  describe('handlePlugin - schema', () => {
    beforeEach(() => {
      mockGetPluginLoader.mockResolvedValue({
        getCore: () => ({
          loader: {
            getSites: () => [],
          },
        }),
        reloadPlugin: vi.fn(async () => undefined),
        getPluginContract: mockGetPluginContract,
      });
    });

    it('should output plugin contract as JSON', async () => {
      const contract = {
        version: 2,
        plugin: { name: 'demo' },
        commands: [
          {
            name: 'search',
            description: 'Search',
            scope: 'page',
            requiresLogin: false,
            capabilities: ['browser.page'],
            positional: ['query'],
            form: {
              title: 'Search',
              submitLabel: 'Run',
              fields: [{ name: 'query', label: 'Query', type: 'string', widget: 'text', required: true }],
            },
          },
        ],
      };
      mockGetPluginContract.mockReturnValueOnce(contract);

      await handlePlugin(['schema', 'demo'], {}, 'json');

      expect(mockGetPluginContract).toHaveBeenCalledWith('demo', undefined);
      expect(mockOutputEnvelope).toHaveBeenCalledWith({ success: true, data: contract }, { command: 'plugin schema' }, 'json');
    });

    it('should output command contract as JSON', async () => {
      const command = {
        name: 'search',
        description: 'Search',
        scope: 'page',
        requiresLogin: false,
        capabilities: ['browser.page'],
        positional: [],
        form: { title: 'Search', submitLabel: 'Run', fields: [] },
      };
      mockGetPluginContract.mockReturnValueOnce(command);

      await handlePlugin(['schema', 'demo', 'search'], {}, 'json');

      expect(mockGetPluginContract).toHaveBeenCalledWith('demo', 'search');
      expect(mockOutputEnvelope).toHaveBeenCalledWith({ success: true, data: command }, { command: 'plugin schema' }, 'json');
    });

    it('should error when plugin contract is missing', async () => {
      mockGetPluginContract.mockReturnValueOnce(undefined);

      await expect(handlePlugin(['schema', 'missing'], {}, 'json')).rejects.toThrow('Plugin "missing" not found');
    });
  });

  describe('handlePlugin - search', () => {
    it('should search plugins via installed plugin and output JSON', async () => {
      mockSearchHandler.mockResolvedValueOnce({
        data: {
          items: [
            { name: 'found-plugin', description: 'A plugin', version: '1.0.0', slug: 'fp', source: 'marketplace' },
          ],
        },
      });
      setupMockLoaderWithSites([createMockSiteWithSearch()]);

      await handlePlugin(['search', 'test'], {}, 'json');

      expect(mockOutputEnvelope).toHaveBeenCalled();
      const callArgs = mockOutputEnvelope.mock.calls[0][0] as Record<string, unknown>;
      const resultData = callArgs.data as Record<string, unknown> | undefined;
      expect(resultData).toBeDefined();
      const results = resultData!.results as Array<Record<string, unknown>> | undefined;
      expect(results?.length).toBe(1);
      expect(results![0].name).toBe('found-plugin');
    });
  });

  describe('handlePlugin - default', () => {
    it('should show help for unknown subcommand', async () => {
      const consoleSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await handlePlugin(['unknown-sub'], {}, 'text');

      expect(consoleSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('plugin help text');
      consoleSpy.mockRestore();
    });
  });

  describe('handleCreate', () => {
    it('should output error when no name provided', () => {
      expect(() => handleCreate([], {})).toThrow();
    });
  });

  describe('handleDaemon', () => {
    it('should show usage for unknown daemon subcommand', () => {
      const consoleSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      handleDaemon(['unknown'], {}, 'text');

        expect(
          consoleSpy.mock.calls.map((c) => String(c[0])).join(''),
        ).toContain('Daemon starts automatically. No manual action needed.');
      consoleSpy.mockRestore();
    });

    it('should output daemon status', async () => {
      const { getDaemonProcessStatus } = await import('../../src/daemon/daemon.js');
      vi.mocked(getDaemonProcessStatus).mockReturnValue({
        running: true, pid: 12345, port: 9224, info: { pid: 12345, port: 9224, startedAt: new Date().toISOString() },
      });

      handleDaemon(['status'], {}, 'json');
      expect(mockOutputEnvelope).toHaveBeenCalledWith(
        { success: true, data: { running: true, pid: 12345, port: 9224 } },
        { command: 'daemon status' },
        'json'
      );
    });
  });

  describe('registry override', () => {
    it('should set XBROWSER_MARKETPLACE_URL from --registry option', async () => {
      delete process.env.XBROWSER_MARKETPLACE_URL;
      mockInstallerList.mockResolvedValueOnce([]);

      await handlePlugin(['list'], { registry: 'https://custom.registry.com' }, 'json');

      expect(process.env.XBROWSER_MARKETPLACE_URL).toBe('https://custom.registry.com');
      delete process.env.XBROWSER_MARKETPLACE_URL;
    });

    it('should not override XBROWSER_MARKETPLACE_URL if already set', async () => {
      process.env.XBROWSER_MARKETPLACE_URL = 'https://existing.com';
      mockInstallerList.mockResolvedValueOnce([]);

      await handlePlugin(['list'], { registry: 'https://custom.registry.com' }, 'json');

      expect(process.env.XBROWSER_MARKETPLACE_URL).toBe('https://existing.com');
      delete process.env.XBROWSER_MARKETPLACE_URL;
    });
  });

  describe('handlePlugin - search text mode', () => {
    it('should output text format search results from plugin', async () => {
      mockSearchHandler.mockResolvedValueOnce({
        data: {
          items: [
            { name: 'text-plugin', description: 'A text plugin', version: '1.0.0', slug: 'tp', source: 'marketplace' },
          ],
        },
      });
      setupMockLoaderWithSites([createMockSiteWithSearch()]);

      const captured: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as typeof process.stdout.write;

      await handlePlugin(['search', 'test'], {}, 'text');

      process.stdout.write = origWrite;
      const output = captured.join('');
      expect(output.includes('text-plugin')).toBe(true);
      expect(output.includes('Total:')).toBe(true);
    });

    it('should show "No plugins found" when search returns empty', async () => {
      const { NPMSearcher } = await import('../../src/plugin/npm-search.js');
      vi.mocked(NPMSearcher.search).mockResolvedValueOnce([]);

      const captured: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as typeof process.stdout.write;

      await handlePlugin(['search', 'nonexistent'], {}, 'text');

      process.stdout.write = origWrite;
      const output = captured.join('');
      expect(output.includes('No plugins found')).toBe(true);
    });

    it('should fallback to npm when plugin search returns empty', async () => {
      const { NPMSearcher } = await import('../../src/plugin/npm-search.js');
      vi.mocked(NPMSearcher.search).mockResolvedValueOnce([
        { name: 'npm-plugin', description: 'From npm', version: '2.0.0', date: '2026-01-01' },
      ]);

      await handlePlugin(['search', 'test'], {}, 'json');

      expect(NPMSearcher.search).toHaveBeenCalled();
      expect(mockOutputEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ total: 1 }) }),
        { command: 'plugin search' },
        'json'
      );
    });

    it('should pass search options to plugin search handler', async () => {
      mockSearchHandler.mockResolvedValueOnce({ data: { items: [] } });
      setupMockLoaderWithSites([createMockSiteWithSearch()]);

      await handlePlugin(['search', 'test'], { limit: 5 }, 'json');

      expect(mockSearchHandler).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 }),
        expect.anything(),
      );
    });
  });

  describe('handlePlugin - marketplace REST API fallback (#436)', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      mockFetch.mockReset();
      vi.stubGlobal('fetch', mockFetch);
      process.env.XBROWSER_MARKETPLACE_URL = 'https://mp.example.com';
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.XBROWSER_MARKETPLACE_URL;
    });

    function envelopeData(callIndex: number): Record<string, unknown> {
      const callArgs = mockOutputEnvelope.mock.calls[callIndex][0] as Record<string, unknown>;
      return (callArgs.data ?? {}) as Record<string, unknown>;
    }

    it('should fall back to marketplace REST API on search when the marketplace plugin is not loaded', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.startsWith('https://mp.example.com/api/plugins?')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                items: [{
                  name: 'MP Only',
                  slug: 'mp-only',
                  description: 'Only on marketplace',
                  version: '1.2.3',
                  downloadCount: 42,
                  tags: ['ai'],
                  siteUrls: ['https://x.example'],
                  commands: ['do'],
                }],
              },
            }),
          });
        }
        return Promise.reject(new Error('unexpected fetch: ' + url));
      });

      await handlePlugin(['search', 'mp-only'], {}, 'json');

      const searchUrl = mockFetch.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((u: string) => u.startsWith('https://mp.example.com/api/plugins?'));
      expect(searchUrl).toBe('https://mp.example.com/api/plugins?search=mp-only&limit=20');

      const data = envelopeData(0) as { results: Array<Record<string, unknown>>; total: number };
      expect(data.total).toBe(1);
      expect(data.results[0]).toMatchObject({
        name: 'mp-only',
        slug: 'mp-only',
        description: 'Only on marketplace',
        version: '1.2.3',
        downloads: 42,
        tags: ['ai'],
        sites: ['https://x.example'],
        commands: ['do'],
        source: 'marketplace',
      });
    });

    it('should fall through to npm on search when the marketplace REST API is unreachable', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.startsWith('https://mp.example.com/')) {
          return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:443'));
        }
        return Promise.reject(new Error('unexpected fetch: ' + url));
      });
      const { NPMSearcher } = await import('../../src/plugin/npm-search.js');
      vi.mocked(NPMSearcher.search).mockResolvedValueOnce([
        { name: 'npm-fallback', description: 'From npm', version: '2.0.0', date: '2026-01-01' },
      ]);

      await handlePlugin(['search', 'whatever'], {}, 'json');

      const data = envelopeData(0) as { results: Array<Record<string, unknown>>; total: number };
      expect(data.total).toBe(1);
      expect(data.results[0]).toMatchObject({ name: 'npm-fallback', source: 'npm' });
    });

    it('should fall back to marketplace REST API for info when the marketplace plugin is unavailable', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === 'https://mp.example.com/api/plugins/mp-only') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                name: 'MP Only',
                slug: 'mp-only',
                description: 'Detailed desc',
                version: '2.0.0',
                authorName: 'alice',
                downloadCount: 7,
                tags: ['t1'],
                siteUrls: ['https://s.example'],
                commands: ['do'],
              },
            }),
          });
        }
        return Promise.reject(new Error('unexpected fetch: ' + url));
      });

      await handlePlugin(['info', 'mp-only'], {}, 'json');

      expect(mockFetch.mock.calls.some((c: unknown[]) => String(c[0]) === 'https://mp.example.com/api/plugins/mp-only')).toBe(true);
      expect(mockOutputEnvelope).toHaveBeenCalledWith(
        {
          success: true,
          data: {
            source: 'marketplace',
            name: 'MP Only',
            slug: 'mp-only',
            description: 'Detailed desc',
            version: '2.0.0',
            author: 'alice',
            downloads: 7,
            tags: ['t1'],
            sites: ['https://s.example'],
            commands: ['do'],
          },
        },
        { command: 'plugin info' },
        'json',
      );
    });

    it('should fall back to npm for info when the marketplace REST API reports not found', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.startsWith('https://mp.example.com/')) {
          return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        }
        if (url.includes('registry.npmjs.org')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              'dist-tags': { latest: '3.1.0' },
              versions: {
                '3.1.0': { name: 'mp-only', description: 'npm desc', author: 'bob', keywords: ['k'], license: 'MIT' },
              },
            }),
          });
        }
        return Promise.reject(new Error('unexpected fetch: ' + url));
      });

      await handlePlugin(['info', 'mp-only'], {}, 'json');

      expect(mockOutputEnvelope).toHaveBeenCalledWith(
        { success: true, data: { source: 'npm', name: 'mp-only', version: '3.1.0', description: 'npm desc' } },
        { command: 'plugin info' },
        'json',
      );
    });
  });

  describe('handlePlugin - publish/register/login/whoami/logout', () => {
    // Marketplace publisher was removed in 216f151; these subcommands must
    // report the removal honestly instead of redirecting to a non-existent
    // `xbrowser marketplace` command.
    it('should report removal for publish', async () => {
      await expect(
        handlePlugin(['publish'], {}, 'json')
      ).rejects.toThrow('"plugin publish" is no longer available');
    });

    it('should report removal for register', async () => {
      await expect(
        handlePlugin(['register'], {}, 'text')
      ).rejects.toThrow('"plugin register" is no longer available');
    });

    it('should report removal for login', async () => {
      await expect(
        handlePlugin(['login'], {}, 'text')
      ).rejects.toThrow('"plugin login" is no longer available');
    });

    it('should report removal for whoami', async () => {
      await expect(
        handlePlugin(['whoami'], {}, 'json')
      ).rejects.toThrow('"plugin whoami" is no longer available');
    });

    it('should report removal for logout', async () => {
      await expect(
        handlePlugin(['logout'], {}, 'text')
      ).rejects.toThrow('"plugin logout" is no longer available');
    });
  });

  describe('handleDaemon - start/stop', () => {
    it('should start daemon with port option', async () => {
      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      vi.mocked(startDaemonProcess).mockResolvedValue({ pid: 1234, port: 9222, startedAt: new Date().toISOString() });

      handleDaemon(['start'], { port: 9222 }, 'json');

      await vi.waitFor(() => {
        expect(mockOutputEnvelope).toHaveBeenCalledWith(
          { success: true, data: { pid: 1234, port: 9222 } },
          { command: 'daemon start' },
          'json'
        );
      });
    });

    it('should start daemon with default CDP endpoint', async () => {
      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      vi.mocked(startDaemonProcess).mockResolvedValue({ pid: 1234, port: 9224, startedAt: new Date().toISOString() });

      handleDaemon(['start'], {}, 'json');

      await vi.waitFor(() => {
        expect(startDaemonProcess).toHaveBeenCalledWith(9224);
      });
    });

    it('should stop daemon', async () => {
      const { stopDaemonProcess } = await import('../../src/daemon/daemon.js');
      vi.mocked(stopDaemonProcess).mockResolvedValue(undefined);

      handleDaemon(['stop'], {}, 'json');

      await vi.waitFor(() => {
        expect(mockOutputEnvelope).toHaveBeenCalledWith({ success: true, data: {} }, { command: 'daemon stop' }, 'json');
      });
    });
  });
});
