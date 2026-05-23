import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOutputResult, mockOutputError, mockInstallerInstall, mockInstallerInstallFromMarketplace, mockInstallerInstallWithMarketplaceFallback, mockInstallerUninstall, mockInstallerList, mockReloadPlugin, mockGetPluginLoader } = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockInstallerInstall: vi.fn(),
  mockInstallerInstallFromMarketplace: vi.fn(),
  mockInstallerInstallWithMarketplaceFallback: vi.fn(),
  mockInstallerUninstall: vi.fn(),
  mockInstallerList: vi.fn(),
  mockReloadPlugin: vi.fn(),
  mockGetPluginLoader: vi.fn().mockResolvedValue({
    getCore: () => ({
      loader: {
        getSites: () => [],
      },
    }),
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

vi.mock('../../src/plugin/marketplace-search.js', () => ({
  MarketplaceSearcher: { search: vi.fn().mockResolvedValue([]) },
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

import { handlePlugin, handleCreate, handleDaemon } from '../../src/cli/plugin-routes.js';

describe('plugin-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation((msg: string) => {
      throw new Error(msg);
    });
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
        { plugins: [{ name: 'plugin-a', path: '/tmp/a' }, { name: 'plugin-b', path: '/tmp/b' }] },
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

  describe('handlePlugin - search', () => {
    it('should search plugins and output JSON', async () => {
      const { MarketplaceSearcher } = await import('../../src/plugin/marketplace-search.js');
      vi.mocked(MarketplaceSearcher.search).mockResolvedValueOnce([
        { name: 'found-plugin', description: 'A plugin', version: '1.0.0', slug: 'fp' },
      ]);

      await handlePlugin(['search', 'test'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalled();
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
    it('should output text format search results', async () => {
      const { MarketplaceSearcher } = await import('../../src/plugin/marketplace-search.js');
      vi.mocked(MarketplaceSearcher.search).mockResolvedValueOnce([
        { name: 'text-plugin', description: 'A text plugin', version: '1.0.0', slug: 'tp' },
      ]);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await handlePlugin(['search', 'test'], {}, 'text');

      console.log = origLog;
      expect(logs.some(l => l.includes('text-plugin'))).toBe(true);
      expect(logs.some(l => l.includes('Total:'))).toBe(true);
    });

    it('should show "No plugins found" when search returns empty', async () => {
      const { MarketplaceSearcher } = await import('../../src/plugin/marketplace-search.js');
      const { NPMSearcher } = await import('../../src/plugin/npm-search.js');
      vi.mocked(MarketplaceSearcher.search).mockResolvedValueOnce([]);
      vi.mocked(NPMSearcher.search).mockResolvedValueOnce([]);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await handlePlugin(['search', 'nonexistent'], {}, 'text');

      console.log = origLog;
      expect(logs.some(l => l.includes('No plugins found'))).toBe(true);
    });

    it('should fallback to npm when marketplace returns empty', async () => {
      const { MarketplaceSearcher } = await import('../../src/plugin/marketplace-search.js');
      const { NPMSearcher } = await import('../../src/plugin/npm-search.js');
      vi.mocked(MarketplaceSearcher.search).mockResolvedValueOnce([]);
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

    it('should pass limit option to search', async () => {
      const { MarketplaceSearcher } = await import('../../src/plugin/marketplace-search.js');
      vi.mocked(MarketplaceSearcher.search).mockResolvedValueOnce([]);

      await handlePlugin(['search', 'test'], { limit: 5 }, 'json');

      expect(MarketplaceSearcher.search).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 })
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
