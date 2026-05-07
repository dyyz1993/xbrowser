import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOutputResult, mockOutputError, mockInstallerInstall, mockInstallerInstallFromMarketplace, mockInstallerUninstall, mockInstallerList, mockReloadPlugin } = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockInstallerInstall: vi.fn(),
  mockInstallerInstallFromMarketplace: vi.fn(),
  mockInstallerUninstall: vi.fn(),
  mockInstallerList: vi.fn(),
  mockReloadPlugin: vi.fn(),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/plugin/installer.js', () => ({
  PluginInstaller: vi.fn().mockImplementation(() => ({
    install: mockInstallerInstall,
    installFromMarketplace: mockInstallerInstallFromMarketplace,
    uninstall: mockInstallerUninstall,
    list: mockInstallerList,
  })),
}));

vi.mock('../../src/plugin/loader.js', () => ({
  XBrowserPluginLoader: vi.fn().mockImplementation(() => ({
    reloadPlugin: mockReloadPlugin,
  })),
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
  DaemonManager: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    status: vi.fn(),
  })),
}));

vi.mock('../../src/cli/publish-routes.js', () => ({
  handlePublish: vi.fn(),
  handlePluginLogin: vi.fn(),
  handlePluginWhoami: vi.fn(),
  handlePluginLogout: vi.fn(),
  handleRegister: vi.fn(),
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
      mockInstallerInstall.mockResolvedValueOnce({
        name: 'my-plugin',
        source: 'npm',
        path: '/tmp/my-plugin',
      });

      await handlePlugin(['install', 'my-plugin'], {}, 'text');

      expect(mockInstallerInstall).toHaveBeenCalledWith('my-plugin', { name: undefined, force: false });
      expect(mockOutputResult).toHaveBeenCalledWith(
        { ok: true, name: 'my-plugin', source: 'npm', path: '/tmp/my-plugin' },
        'text'
      );
    });

    it('should install plugin with --name and --force options', async () => {
      mockInstallerInstall.mockResolvedValueOnce({
        name: 'custom-name',
        source: 'npm',
        path: '/tmp/custom-name',
      });

      await handlePlugin(['install', 'some-pkg'], { name: 'custom-name', force: true }, 'json');

      expect(mockInstallerInstall).toHaveBeenCalledWith('some-pkg', {
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

    it('should output daemon status', () => {
      handleDaemon(['status'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalled();
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
});
