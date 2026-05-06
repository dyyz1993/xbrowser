import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-installer');

vi.mock('../../src/plugin/install-sources/local.js', () => ({
  installFromLocal: vi.fn(),
}));
vi.mock('../../src/plugin/install-sources/npm.js', () => ({
  installFromNpm: vi.fn(),
}));
vi.mock('../../src/plugin/install-sources/git.js', () => ({
  installFromGit: vi.fn(),
}));
vi.mock('../../src/plugin/install-sources/url.js', () => ({
  installFromUrl: vi.fn(),
}));
vi.mock('../../src/plugin/install-sources/marketplace.js', () => ({
  installFromMarketplace: vi.fn(),
}));

import { PluginInstaller } from '../../src/plugin/installer.js';
import { installFromLocal } from '../../src/plugin/install-sources/local.js';
import { installFromNpm } from '../../src/plugin/install-sources/npm.js';
import { installFromGit } from '../../src/plugin/install-sources/git.js';
import { installFromUrl } from '../../src/plugin/install-sources/url.js';
import type { InstalledPlugin } from '../../src/plugin/installer-types.js';

function makePlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'test',
    name: 'test',
    path: '/tmp/test',
    source: 'local',
    installedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PluginInstaller', () => {
  let pluginsDir: string;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    pluginsDir = resolve(TEST_DIR, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should use provided pluginsDir', () => {
      const installer = new PluginInstaller(pluginsDir);
      expect(installer.getPluginsDir()).toBe(pluginsDir);
    });
  });

  describe('install', () => {
    it('should detect local source and call installFromLocal', async () => {
      const localPath = resolve(TEST_DIR, 'my-local-plugin');
      mkdirSync(localPath, { recursive: true });
      writeFileSync(resolve(localPath, 'index.ts'), 'export default {}');

      vi.mocked(installFromLocal).mockResolvedValueOnce(makePlugin({ source: 'local' }));

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.install(localPath);

      expect(installFromLocal).toHaveBeenCalledWith(localPath, 'my-local-plugin', resolve(pluginsDir, 'my-local-plugin'));
      expect(result.source).toBe('local');
    });

    it('should detect npm source and call installFromNpm', async () => {
      vi.mocked(installFromNpm).mockResolvedValueOnce(makePlugin({ source: 'npm' }));

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.install('some-npm-package');

      expect(installFromNpm).toHaveBeenCalled();
      expect(result.source).toBe('npm');
    });

    it('should detect git source and call installFromGit', async () => {
      vi.mocked(installFromGit).mockResolvedValueOnce(makePlugin({ source: 'git' }));

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.install('https://github.com/user/repo.git');

      expect(installFromGit).toHaveBeenCalled();
      expect(result.source).toBe('git');
    });

    it('should detect url source and call installFromUrl', async () => {
      vi.mocked(installFromUrl).mockResolvedValueOnce(makePlugin({ source: 'url' }));

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.install('https://example.com/plugin.tar.gz');

      expect(installFromUrl).toHaveBeenCalled();
      expect(result.source).toBe('url');
    });

    it('should throw when plugin already exists without force', async () => {
      const existingDir = resolve(pluginsDir, 'existing');
      mkdirSync(existingDir, { recursive: true });

      const installer = new PluginInstaller(pluginsDir);

      await expect(
        installer.install('existing')
      ).rejects.toThrow('already exists');
    });

    it('should allow overwrite with force', async () => {
      const localPath = resolve(TEST_DIR, 'my-plugin');
      mkdirSync(localPath, { recursive: true });
      writeFileSync(resolve(localPath, 'index.ts'), 'export default {}');

      const existingDir = resolve(pluginsDir, 'my-plugin');
      mkdirSync(existingDir, { recursive: true });

      vi.mocked(installFromLocal).mockResolvedValueOnce(makePlugin());

      const installer = new PluginInstaller(pluginsDir);
      await expect(
        installer.install(localPath, { force: true })
      ).resolves.toBeDefined();
    });

    it('should use custom name when provided', async () => {
      const localPath = resolve(TEST_DIR, 'my-plugin');
      mkdirSync(localPath, { recursive: true });
      writeFileSync(resolve(localPath, 'index.ts'), 'export default {}');

      vi.mocked(installFromLocal).mockResolvedValueOnce(makePlugin({ name: 'custom-name' }));

      const installer = new PluginInstaller(pluginsDir);
      await installer.install(localPath, { name: 'custom-name' });

      expect(installFromLocal).toHaveBeenCalledWith(
        localPath,
        'custom-name',
        resolve(pluginsDir, 'custom-name')
      );
    });
  });

  describe('uninstall', () => {
    it('should remove plugin directory', async () => {
      const pluginDir = resolve(pluginsDir, 'to-remove');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.ts'), 'export default {}');

      const installer = new PluginInstaller(pluginsDir);
      await installer.uninstall('to-remove');

      expect(existsSync(pluginDir)).toBe(false);
    });

    it('should throw when plugin not found', async () => {
      const installer = new PluginInstaller(pluginsDir);

      await expect(
        installer.uninstall('nonexistent')
      ).rejects.toThrow('not found');
    });
  });

  describe('list', () => {
    it('should return empty array when plugins dir does not exist', async () => {
      const installer = new PluginInstaller('/nonexistent/path');
      const result = await installer.list();

      expect(result).toEqual([]);
    });

    it('should list installed plugins with index files', async () => {
      const pluginDir = resolve(pluginsDir, 'my-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.ts'), 'export default {}');
      writeFileSync(
        resolve(pluginDir, 'package.json'),
        JSON.stringify({ name: 'my-plugin' })
      );

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('my-plugin');
      expect(result[0].path).toBe(pluginDir);
    });

    it('should skip directories without index files', async () => {
      const noIndexDir = resolve(pluginsDir, 'no-index');
      mkdirSync(noIndexDir, { recursive: true });
      writeFileSync(resolve(noIndexDir, 'readme.md'), 'hello');

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.list();

      expect(result).toEqual([]);
    });

    it('should detect npm source from package.json', async () => {
      const pluginDir = resolve(pluginsDir, 'npm-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.js'), 'module.exports = {}');
      writeFileSync(
        resolve(pluginDir, 'package.json'),
        JSON.stringify({
          name: 'npm-plugin',
          xbrowser: { id: 'npm-plugin' },
          _npmSource: { name: 'npm-plugin', version: '1.0.0' },
        })
      );

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.list();

      expect(result[0].source).toBe('npm');
    });

    it('should detect git source from package.json', async () => {
      const pluginDir = resolve(pluginsDir, 'git-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.ts'), 'export default {}');
      writeFileSync(
        resolve(pluginDir, 'package.json'),
        JSON.stringify({
          name: 'git-plugin',
          xbrowser: { id: 'git-plugin' },
          _gitSource: { url: 'https://github.com/test/test.git' },
        })
      );

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.list();

      expect(result[0].source).toBe('git');
    });

    it('should skip non-directory entries', async () => {
      writeFileSync(resolve(pluginsDir, 'random-file.txt'), 'hello');

      const installer = new PluginInstaller(pluginsDir);
      const result = await installer.list();

      expect(result).toEqual([]);
    });
  });

  describe('detectSourceType (private, tested via install)', () => {
    it('should detect git for github.com URL', async () => {
      vi.mocked(installFromGit).mockResolvedValueOnce(makePlugin({ source: 'git' }));

      const installer = new PluginInstaller(pluginsDir);
      await installer.install('https://github.com/user/repo.git');

      expect(installFromGit).toHaveBeenCalled();
    });

    it('should detect url for http URL without .git', async () => {
      vi.mocked(installFromUrl).mockResolvedValueOnce(makePlugin({ source: 'url' }));

      const installer = new PluginInstaller(pluginsDir);
      await installer.install('https://example.com/plugin.tar.gz');

      expect(installFromUrl).toHaveBeenCalled();
    });
  });

  describe('deriveName (private, tested via install)', () => {
    it('should derive name from npm scoped package', async () => {
      vi.mocked(installFromNpm).mockResolvedValueOnce(makePlugin({ name: 'scoped-plugin' }));

      const installer = new PluginInstaller(pluginsDir);
      await installer.install('@scope/scoped-plugin');

      expect(installFromNpm).toHaveBeenCalledWith(
        '@scope/scoped-plugin',
        'scoped-plugin',
        resolve(pluginsDir, 'scoped-plugin')
      );
    });

    it('should derive name from git URL', async () => {
      vi.mocked(installFromGit).mockResolvedValueOnce(makePlugin({ name: 'repo' }));

      const installer = new PluginInstaller(pluginsDir);
      await installer.install('https://github.com/user/repo.git');

      expect(installFromGit).toHaveBeenCalledWith(
        'https://github.com/user/repo.git',
        'repo',
        resolve(pluginsDir, 'repo')
      );
    });
  });
});
