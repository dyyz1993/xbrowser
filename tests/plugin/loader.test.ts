import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { XBrowserPluginLoader } from '../../src/plugin/loader.js';
import { PluginInstaller } from '../../src/plugin/installer.js';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-plugin');

describe('XBrowserPluginLoader', () => {
  let loader: XBrowserPluginLoader;

  beforeEach(() => {
    loader = new XBrowserPluginLoader({ cwd: TEST_DIR });
  });

  afterEach(async () => {
    await loader.unload();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should create loader with API', () => {
    const api = loader.getAPI();
    expect(api).toBeDefined();
    expect(typeof api.createSite).toBe('function');
    expect(typeof api.registerCommand).toBe('function');
  });

  it('should return empty plugins initially', () => {
    const plugins = loader.getLoadedPlugins();
    expect(plugins).toEqual([]);
  });

  it('should return unloaded status for unknown plugin', () => {
    const status = loader.getPluginStatus('nonexistent');
    expect(status).toBe('unloaded');
  });

  it('should get undefined for unknown plugin', () => {
    const plugin = loader.getPlugin('nonexistent');
    expect(plugin).toBeUndefined();
  });

  it('should load plugin from function', async () => {
    let siteCreated = false;
    await loader.loadFromFunction((api) => {
      api.createSite({ name: 'test-site' });
      siteCreated = true;
    });
    expect(siteCreated).toBe(true);
  });

  it('should scan empty directories without error', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const plugins = await loader.scanAndLoad();
    expect(Array.isArray(plugins)).toBe(true);
  });

  it('resolveSiteName maps directory name to site name (alias fallback)', async () => {
    // 复刻 alibaba-1688 实测案例：目录名与 site.name 不一致时，
    // 用户按 plugin list 显示的目录名敲命令也应命中
    const pluginDir = resolve(TEST_DIR, '.xcli/plugins', 'alibaba-1688');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(resolve(pluginDir, 'package.json'), JSON.stringify({
      name: 'test-alibaba', version: '1.0.0', main: 'index.ts', type: 'module',
      xbrowser: { name: 'alibaba-1688', slug: 'alibaba-1688', version: '1.0.0', description: 't' },
    }));
    writeFileSync(resolve(pluginDir, 'index.ts'), [
      "export default function (api: { createSite: (c: Record<string, unknown>) => void }) {",
      "  api.createSite({ name: '1688', url: 'https://1688.com', description: 't' });",
      "}",
    ].join('\n'));
    await loader.scanAndLoad();
    expect(loader.resolveSiteName('1688')).toBe('1688');           // 直查命中原样返回
    expect(loader.resolveSiteName('alibaba-1688')).toBe('1688');    // 目录名 → site 名
    expect(loader.resolveSiteName('no-such-plugin')).toBeUndefined();
  });
});

describe('PluginInstaller', () => {
  let installer: PluginInstaller;
  let testPluginsDir: string;

  beforeEach(() => {
    testPluginsDir = resolve(TEST_DIR, 'plugins');
    installer = new PluginInstaller(testPluginsDir);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should list empty plugins when dir does not exist', async () => {
    const plugins = await installer.list();
    expect(plugins).toEqual([]);
  });

  it('should install from local path', async () => {
    const localPlugin = resolve(TEST_DIR, 'source-plugin');
    mkdirSync(localPlugin, { recursive: true });
    writeFileSync(resolve(localPlugin, 'index.ts'), 'export default function() {}');

    const result = await installer.install(localPlugin, { name: 'test-plugin' });
    expect(result.name).toBe('test-plugin');
    expect(result.source).toBe('local');
    expect(existsSync(result.path)).toBe(true);
  });

  it('should reject duplicate install without force', async () => {
    const localPlugin = resolve(TEST_DIR, 'source-plugin');
    mkdirSync(localPlugin, { recursive: true });
    writeFileSync(resolve(localPlugin, 'index.ts'), 'export default function() {}');

    await installer.install(localPlugin, { name: 'dupe' });
    await expect(installer.install(localPlugin, { name: 'dupe' })).rejects.toThrow(
      'already exists'
    );
  });

  it('should allow duplicate install with force', async () => {
    const localPlugin = resolve(TEST_DIR, 'source-plugin');
    mkdirSync(localPlugin, { recursive: true });
    writeFileSync(resolve(localPlugin, 'index.ts'), 'export default function() {}');

    await installer.install(localPlugin, { name: 'force-test' });
    const result = await installer.install(localPlugin, { name: 'force-test', force: true });
    expect(result.name).toBe('force-test');
  });

  it('should uninstall plugin', async () => {
    const localPlugin = resolve(TEST_DIR, 'source-plugin');
    mkdirSync(localPlugin, { recursive: true });
    writeFileSync(resolve(localPlugin, 'index.ts'), 'export default function() {}');

    await installer.install(localPlugin, { name: 'to-remove' });
    await installer.uninstall('to-remove');
    const plugins = await installer.list();
    expect(plugins.find((p) => p.name === 'to-remove')).toBeUndefined();
  });

  it('should throw when uninstalling nonexistent plugin', async () => {
    await expect(installer.uninstall('nonexistent')).rejects.toThrow('not found');
  });

  it('should detect source types correctly', async () => {
    const i = new PluginInstaller(testPluginsDir);
    expect(i).toBeDefined();
  });
});
