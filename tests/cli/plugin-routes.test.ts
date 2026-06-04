import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearchHandler = vi.fn().mockResolvedValue({ data: { items: [] } });

const { mockOutputResult, mockOutputError, mockInstallerInstall, mockInstallerInstallFromMarketplace, mockInstallerInstallWithMarketplaceFallback, mockInstallerUninstall, mockInstallerList, mockReloadPlugin, mockGetPluginContract, mockGetPluginLoader } = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockInstallerInstall: vi.fn(),
  mockInstallerInstallFromMarketplace: vi.fn(),
  mockInstallerInstallWithMarketplaceFallback: vi.fn(),
  mockInstallerUninstall: vi.fn(),
  mockInstallerList: vi.fn(),
  mockReloadPlugin: vi.fn(),
  mockGetPluginContract: vi.fn(),
  mockGetPluginLoader: vi.fn().mockResolvedValue({
    getCore: () => ({
      loader: {
        getSites: () => [],
      },
    }),
    getPluginContract: vi.fn(),
  }),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
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

function createMockSiteWithSearch(items: Array<Record<string, unknown>> = []) {
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

function setupMockLoaderWithSites(sites: unknown[] = []) {
  mockGetPluginLoader.mockResolvedValue({
    getCore: () => ({
      loader: {
        getSites: () => sites,
      },
    }),
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
      expect(mockOutputResult).toHaveBeenCalledWith(
        { ok: true, name: 'my-plugin', source: 'npm', path: '/tmp/my-plugin' },
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

      await handlePlugin(['uninstall', 'my-plugin'], {}, 'text');

      expect(mockInstallerUninstall).toHaveBeenCalledWith('my-plugin');
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, name: 'my-plugin' }, 'text');
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

      expect(mockOutputResult).toHaveBeenCalledWith(
        { plugins: [
          { name: 'plugin-a', path: '/tmp/a', commands: undefined, version: undefined, description: undefined, hasLogin: false, loggedIn: null, requiresLoginCommands: [] },
          { name: 'plugin-b', path: '/tmp/b', commands: undefined, version: undefined, description: undefined, hasLogin: false, loggedIn: null, requiresLoginCommands: [] },
        ] },
        'json'
      );
    });

    it('should return empty list when no plugins installed', async () => {
      mockInstallerList.mockResolvedValueOnce([]);

      await handlePlugin(['list'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith({ plugins: [] }, 'json');
    });
  });

  describe('handlePlugin - reload', () => {
    it('should reload a plugin by name', async () => {
      mockReloadPlugin.mockResolvedValueOnce(undefined);

      await handlePlugin(['reload', 'my-plugin'], {}, 'text');

      expect(mockReloadPlugin).toHaveBeenCalledWith('my-plugin');
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, name: 'my-plugin' }, 'text');
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
      expect(mockOutputResult).toHaveBeenCalledWith(contract, 'json');
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
      expect(mockOutputResult).toHaveBeenCalledWith(command, 'json');
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

      expect(mockOutputResult).toHaveBeenCalled();
      const callArgs = mockOutputResult.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.results.length).toBe(1);
      expect(callArgs.results[0].name).toBe('found-plugin');
    });
  });

  describe('handlePlugin - default', () => {
    it('should show help for unknown subcommand', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handlePlugin(['unknown-sub'], {}, 'text');

      expect(consoleSpy).toHaveBeenCalledWith('plugin help text');
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
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      handleDaemon(['unknown'], {}, 'text');

        expect(consoleSpy).toHaveBeenCalledWith(
          'Usage: xbrowser daemon <start|stop|status> [--port <port>]'
        );
      consoleSpy.mockRestore();
    });

    it('should output daemon status', async () => {
      const { getDaemonProcessStatus } = await import('../../src/daemon/daemon.js');
      vi.mocked(getDaemonProcessStatus).mockReturnValue({
        running: true, pid: 12345, port: 9224, info: { pid: 12345, port: 9224, startedAt: new Date().toISOString() },
      });

      handleDaemon(['status'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        { running: true, pid: 12345, port: 9224 },
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

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await handlePlugin(['search', 'test'], {}, 'text');

      console.log = origLog;
      expect(logs.some(l => l.includes('text-plugin'))).toBe(true);
      expect(logs.some(l => l.includes('Total:'))).toBe(true);
    });

    it('should show "No plugins found" when search returns empty', async () => {
      const { NPMSearcher } = await import('../../src/plugin/npm-search.js');
      vi.mocked(NPMSearcher.search).mockResolvedValueOnce([]);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await handlePlugin(['search', 'nonexistent'], {}, 'text');

      console.log = origLog;
      expect(logs.some(l => l.includes('No plugins found'))).toBe(true);
    });

    it('should fallback to npm when plugin search returns empty', async () => {
      const { NPMSearcher } = await import('../../src/plugin/npm-search.js');
      vi.mocked(NPMSearcher.search).mockResolvedValueOnce([
        { name: 'npm-plugin', description: 'From npm', version: '2.0.0' },
      ]);

      await handlePlugin(['search', 'test'], {}, 'json');

      expect(NPMSearcher.search).toHaveBeenCalled();
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ total: 1 }),
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

  describe('handlePlugin - publish/register/login/whoami/logout', () => {
    it('should output redirect error for publish', async () => {
      await expect(
        handlePlugin(['publish'], {}, 'json')
      ).rejects.toThrow('"publish" has moved to the marketplace plugin');
    });

    it('should output redirect error for register', async () => {
      await expect(
        handlePlugin(['register'], {}, 'text')
      ).rejects.toThrow('"register" has moved to the marketplace plugin');
    });

    it('should output redirect error for login', async () => {
      await expect(
        handlePlugin(['login'], {}, 'text')
      ).rejects.toThrow('"login" has moved to the marketplace plugin');
    });

    it('should output redirect error for whoami', async () => {
      await expect(
        handlePlugin(['whoami'], {}, 'json')
      ).rejects.toThrow('"whoami" has moved to the marketplace plugin');
    });

    it('should output redirect error for logout', async () => {
      await expect(
        handlePlugin(['logout'], {}, 'text')
      ).rejects.toThrow('"logout" has moved to the marketplace plugin');
    });
  });

  describe('handleDaemon - start/stop', () => {
    it('should start daemon with port option', async () => {
      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      vi.mocked(startDaemonProcess).mockResolvedValue({ pid: 1234, port: 9222, startedAt: new Date().toISOString() });

      handleDaemon(['start'], { port: 9222 }, 'json');

      await vi.waitFor(() => {
        expect(mockOutputResult).toHaveBeenCalledWith(
          { ok: true, pid: 1234, port: 9222 },
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
        expect(mockOutputResult).toHaveBeenCalledWith({ ok: true }, 'json');
      });
    });
  });
});
