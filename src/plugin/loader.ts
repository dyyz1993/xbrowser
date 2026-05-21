import {
  Core,
  PluginLoader,
  type PluginInstance,
  type PluginStatus,
  type XCLIAPI,
  type CoreConfig,
} from '@dyyz1993/xcli-core';
import { resolve } from 'path';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { PluginMetadataParser } from './metadata-parser.js';

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

  constructor(options?: PluginLoaderOptions) {
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

  async loadPlugin(pluginPath: string, id?: string): Promise<PluginInstance> {
    return this.loader.loadPlugin(pluginPath, id);
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
    const dirs = [
      resolve(cwd, '.xcli/plugins'),
      resolve(cwd, '../.xcli/plugins'),
      this.options.userDir || resolve(homedir(), '.xcli/plugins'),
      this.options.globalDir || resolve(homedir(), '.xbrowser/plugins'),
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
        } catch {
          // skip plugins that fail to load
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
