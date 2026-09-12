import {
  Core,
  PluginLoader,
  type PluginInstance,
  type PluginStatus,
  type XCLIAPI,
  type CoreConfig,
} from '@dyyz1993/xcli-core';
import { resolve, basename, dirname } from 'path';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { PluginMetadataParser } from './metadata-parser.js';
import { ensurePluginDependencies } from './ensure-deps.js';
import { buildPluginContract } from './contract.js';
import type { PluginCommandContract, PluginContract } from './types.js';
import { patchLoginRequired } from './login-required-patch.js';

export type { PluginInstance, PluginStatus, XCLIAPI };

/**
 * Options for configuring the plugin loader's search directories.
 */
export interface PluginLoaderOptions {
  cwd?: string;
  userDir?: string;
  globalDir?: string;
}

const DEFAULT_PLUGIN_DIRS = ['.xcli/plugins', '../.xcli/plugins'];

/**
 * Plugin loader for discovering and managing xbrowser plugins.
 *
 * Wraps the xcli-core PluginLoader and provides xbrowser-specific
 * directory conventions for plugin discovery.
 */
export class XBrowserPluginLoader {
  private core: Core;
  private loader: PluginLoader;
  private options: PluginLoaderOptions;
  /** 目录名 → 该插件注册的 site 名（site.name ≠ 目录名时的命令别名兜底） */
  private dirSiteAliases = new Map<string, string>();

  constructor(options?: PluginLoaderOptions) {
    patchLoginRequired();
    this.options = options ?? {};
    const cwd = this.options.cwd || process.cwd();

    const coreConfig: CoreConfig = {
      name: 'xbrowser',
      version: '0.1.0',
      description: 'Browser automation CLI',
      configDirName: '.xbrowser',
      envPrefix: 'XBROWSER',
      pluginDirs: [
        ...DEFAULT_PLUGIN_DIRS,
        resolve(cwd, '.xcli/plugins'),
      ],
    };

    this.core = new Core(coreConfig);
    this.loader = this.core.loader;
  }

  getAPI(): XCLIAPI {
    return this.loader.getAPI();
  }

  /**
   * Get the core instance for external use.
   * @returns The xcli-core Core instance.
   */
  getCore(): Core {
    return this.core;
  }

  getPlugin(id: string): PluginInstance | undefined {
    return this.loader.getPlugin(id);
  }

  getPluginStatus(id: string): PluginStatus {
    return this.loader.getPluginStatus(id);
  }

  getLoadedPlugins(): PluginInstance[] {
    return this.loader.getLoadedPlugins();
  }

  /**
   * 目录名别名兜底（小白用户实测踩坑）：`plugin list` 显示目录名，但命令路由
   * 按 site.name 匹配——两者不一致时（如目录 alibaba-1688、site 名 1688），
   * 用户按 list 显示的名字敲命令会 "Unknown command"。映射在 scanAndLoad/
   * loadPlugin 时通过加载前后 site 快照 diff 记录（instance.siteName 返回的是
   * 插件 id 而非 site 名，不可用）。
   */
  resolveSiteName(name: string): string | undefined {
    if (this.core.loader.getSite(name)) return name;
    const aliased = this.dirSiteAliases.get(name);
    if (aliased && this.core.loader.getSite(aliased)) return aliased;
    return undefined;
  }

  /** 记录一次插件加载引入的 site：加载前后快照 diff（同插件可注册多个 site） */
  private recordSiteAliases(pluginDirName: string, before: Set<string>): void {
    for (const site of this.core.loader.getSites()) {
      if (!before.has(site.name)) this.dirSiteAliases.set(pluginDirName, site.name);
    }
  }

  getPluginContract(siteName: string, commandName?: string): PluginContract | PluginCommandContract | undefined {
    const resolved = this.resolveSiteName(siteName);
    if (!resolved) return undefined;
    const site = this.core.loader.getSite(resolved);
    if (!site) return undefined;
    const contract = buildPluginContract(site);
    if (!commandName) return contract;
    return contract.commands.find(command => command.name === commandName);
  }

  async loadPlugin(pluginPath: string, id?: string): Promise<PluginInstance> {
    const before = new Set(this.core.loader.getSites().map((s) => s.name));
    const instance = await this.loader.loadPlugin(pluginPath, id);
    this.recordSiteAliases(basename(dirname(pluginPath)), before);
    return instance;
  }

  async unloadPlugin(id: string): Promise<void> {
    return this.loader.unloadPlugin(id);
  }

  async reloadPlugin(id: string): Promise<PluginInstance> {
    return this.loader.reloadPlugin(id);
  }

  async loadFromFunction(setup: (api: XCLIAPI) => void): Promise<void> {
    return this.loader.loadFromFunction(setup);
  }

  async scanAndLoad(): Promise<PluginInstance[]> {
    const cwd = this.options.cwd || process.cwd();
    const globalDir = this.options.globalDir || resolve(homedir(), '.xbrowser/plugins');
    ensurePluginDependencies(globalDir);
    const dirs = [
      resolve(cwd, '.xcli/plugins'),
      resolve(cwd, '../.xcli/plugins'),
      this.options.userDir || resolve(homedir(), '.xcli/plugins'),
      globalDir,
    ];

    const loaded: PluginInstance[] = [];
    const seen = new Set<string>();

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Skip if already loaded from a higher-priority directory
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);

        const pluginDir = resolve(dir, entry.name);
        let indexPath = resolve(pluginDir, 'index.js');
        if (!existsSync(indexPath)) {
          indexPath = resolve(pluginDir, 'index.ts');
        }
        if (!existsSync(indexPath)) continue;
        try {
          if (!existsSync(resolve(pluginDir, 'package.json'))) {
            console.warn(`⚠️  Plugin "${entry.name}" has no package.json. Use "xbrowser create ${entry.name} --template static" for proper structure.`);
          } else {
            const metadata = PluginMetadataParser.parseFromPackageJson(pluginDir);
            if (!metadata) {
              console.warn(`⚠️  Plugin "${entry.name}" has package.json but no xbrowser metadata. Add { "xbrowser": { "description": "..." } } to package.json.`);
            }
          }
          const instance = await this.loadPlugin(indexPath, entry.name);
          loaded.push(instance);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // Always warn on load failure — silent failures cause "Unknown command" confusion
          console.warn(`⚠️  Plugin "${entry.name}" load failed: ${errMsg}`);
          if (errMsg.includes("Cannot find module") && errMsg.includes("shared/")) {
            console.warn(`   💡 This plugin needs shared/ dependencies. Try: xbrowser plugin install shared`);
          }
        }
      }
    }

    return loaded;
  }

  async unload(): Promise<void> {
    return this.loader.unload();
  }
}

export function getPluginLoader(): XBrowserPluginLoader {
  return new XBrowserPluginLoader();
}

export function getCore(): Core {
  const loader = getPluginLoader();
  return loader.getCore();
}
