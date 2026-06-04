import type { BuiltinCommand } from './session.js';
import { XBrowserPluginLoader } from '../plugin/loader.js';
import { PluginInstaller } from '../plugin/installer.js';
import { PluginMetadataParser } from '../plugin/metadata-parser.js';
import type { PluginListOptions } from '../plugin/types.js';
import { outputResult } from '../cli/output.js';

let pluginLoader: XBrowserPluginLoader | null = null;
let pluginInstaller: PluginInstaller | null = null;

function getLoader(): XBrowserPluginLoader {
  if (!pluginLoader) {
    pluginLoader = new XBrowserPluginLoader();
  }
  return pluginLoader;
}

function getInstaller(): PluginInstaller {
  if (!pluginInstaller) {
    pluginInstaller = new PluginInstaller();
  }
  return pluginInstaller;
}

function handlePluginHelp(): string {
  return [
    'Usage: xbrowser plugin <command> [options]',
    '',
    'Commands:',
    '  search <query> [options]                      Search for plugins on npm and marketplace',
    '  info <slug>                                   Show plugin details',
    '  install <source> [--name <name>] [--force]    Install a plugin',
    '  install <slug> --from-marketplace             Install from marketplace',
    '  uninstall <name>                              Uninstall a plugin',
    '  list [--json]                                 List installed plugins',
    '  schema <name> [command] [--json]              Show plugin contract and command forms',
    '  reload <name>                                 Reload a plugin',
    '',
    'Examples:',
    '  xbrowser plugin search scraper',
    '  xbrowser plugin install xbrowser-plugin-scraper',
    '  xbrowser plugin install ./my-plugin',
    '  xbrowser plugin uninstall my-plugin',
    '  xbrowser plugin list',
    '  xbrowser plugin schema my-plugin --json',
    '  xbrowser plugin reload my-plugin',
  ].join('\n');
}

export const pluginInstallBuiltin: BuiltinCommand = {
  name: 'plugin install',
  description: 'Install a plugin',
  help: {
    usage: 'xbrowser plugin install <source> [--name <name>] [--force] [--from-marketplace] [--source marketplace|npm]',
    description: 'Install a plugin from local path, npm, git, URL, or marketplace (defaults to marketplace-first)',
    options: [
      { name: '--name <name>', description: 'Custom plugin name' },
      { name: '--force', description: 'Overwrite existing plugin' },
      { name: '--from-marketplace', description: 'Install from marketplace by slug' },
      { name: '--source <type>', description: 'Force source: marketplace or npm' },
    ],
    examples: [
      { cmd: 'xbrowser plugin install deepseek', description: 'Auto: tries marketplace first, then npm' },
      { cmd: 'xbrowser plugin install ./my-plugin', description: 'Install from local path' },
      { cmd: 'xbrowser plugin install my-plugin --from-marketplace', description: 'Install from marketplace' },
      { cmd: 'xbrowser plugin install my-plugin --source npm', description: 'Force install from npm' },
    ],
  },
  execute: async (args, options) => {
    const source = args[0];
    if (!source) {
        console.error('Usage: xbrowser plugin install <source> [--name <name>] [--from-marketplace] [--source marketplace|npm]');
        process.exit(1);
    }
    try {
      const installer = getInstaller();
      const installOpts = {
        name: options['name'] as string | undefined,
        force: !!options['force'],
      };

      let result;
      const sourceFlag = options['source'] as string | undefined;
      if (options['from-marketplace'] || sourceFlag === 'marketplace') {
        result = await installer.installFromMarketplace(source, installOpts);
      } else if (sourceFlag === 'npm') {
        result = await installer.install(source, installOpts);
      } else {
        result = await installer.installWithMarketplaceFallback(source, installOpts);
      }

      console.log(`Plugin "${result.name}" installed from ${result.source}`);
      console.log(`  Path: ${result.path}`);

      const metadata = PluginMetadataParser.parseFromPackageJson(result.path);
      if (metadata) {
        console.log(`  Name: ${metadata.name}`);
        console.log(`  Version: ${metadata.version}`);
        console.log(`  Description: ${metadata.description}`);
        if (metadata.author) {
          console.log(`  Author: ${metadata.author}`);
        }
        if (metadata.commands && metadata.commands.length > 0) {
          console.log(`  Commands: ${metadata.commands.join(', ')}`);
        }
        if (metadata.sites && metadata.sites.length > 0) {
          console.log(`  Sites: ${metadata.sites.join(', ')}`);
        }
        if (metadata.tags && metadata.tags.length > 0) {
          console.log(`  Tags: ${metadata.tags.join(', ')}`);
        }
      } else {
        console.warn('  ⚠️  Warning: No xbrowser metadata found in package.json');
      }

      if (result.warnings && result.warnings.length > 0) {
        console.warn('\n⚠ Verification warnings:');
        for (const w of result.warnings) {
          console.warn(`  - ${w}`);
        }
      }
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export const pluginUninstallBuiltin: BuiltinCommand = {
  name: 'plugin uninstall',
  description: 'Uninstall a plugin',
  help: {
    usage: 'xbrowser plugin uninstall <name>',
    description: 'Remove an installed plugin',
    options: [],
    examples: [{ cmd: 'xbrowser plugin uninstall my-plugin', description: 'Uninstall plugin' }],
  },
  execute: async (args) => {
    const name = args[0];
    if (!name) {
      console.error('Usage: xbrowser plugin uninstall <name>');
      process.exit(1);
    }
    try {
      const installer = getInstaller();
      await installer.uninstall(name);
      console.log(`Plugin "${name}" uninstalled`);
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export const pluginListBuiltin: BuiltinCommand = {
  name: 'plugin list',
  description: 'List installed plugins',
  help: {
    usage: 'xbrowser plugin list [--json]',
    description: 'Show all installed plugins and their metadata',
    options: [{ name: '--json', description: 'Output in JSON format' }],
    examples: [
      { cmd: 'xbrowser plugin list', description: 'List all plugins' },
      { cmd: 'xbrowser plugin list --json', description: 'List in JSON format' },
    ],
  },
  execute: async (_, options) => {
    try {
      const installer = getInstaller();
      const listOptions: PluginListOptions = {
        json: !!options['json'],
      };

      const plugins = await installer.list(listOptions);

      if (listOptions.json) {
        outputResult(plugins, 'json');
        return;
      }

      if (plugins.length === 0) {
        console.log('No plugins installed');
        return;
      }

      console.log('Installed plugins:');
      for (const p of plugins) {
        console.log(`\n  ${p.name}`);
        console.log(`    Source: ${p.source}`);
        console.log(`    Path: ${p.path}`);

        if (p.metadata) {
          const meta = p.metadata;
          if (meta.description) {
            console.log(`    Description: ${meta.description}`);
          }
          if (meta.version) {
            console.log(`    Version: ${meta.version}`);
          }
          if (meta.author) {
            console.log(`    Author: ${meta.author}`);
          }
          if (meta.commands && meta.commands.length > 0) {
            console.log(`    Commands: ${meta.commands.join(', ')}`);
          }
          if (meta.sites && meta.sites.length > 0) {
            console.log(`    Sites: ${meta.sites.join(', ')}`);
          }
          if (meta.tags && meta.tags.length > 0) {
            console.log(`    Tags: ${meta.tags.join(', ')}`);
          }
        }
      }
      console.log('');
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export const pluginReloadBuiltin: BuiltinCommand = {
  name: 'plugin reload',
  description: 'Reload a plugin',
  help: {
    usage: 'xbrowser plugin reload <name>',
    description: 'Reload a plugin (unload then load again)',
    options: [],
    examples: [{ cmd: 'xbrowser plugin reload my-plugin', description: 'Reload plugin' }],
  },
  execute: async (args) => {
    const name = args[0];
    if (!name) {
      console.error('Usage: xbrowser plugin reload <name>');
      process.exit(1);
    }
    try {
      const loader = getLoader();
      const status = loader.getPluginStatus(name);
      if (status === 'unloaded') {
        console.log(`Plugin "${name}" is not loaded, loading...`);
      }
      await loader.reloadPlugin(name);
      console.log(`Plugin "${name}" reloaded`);
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export { handlePluginHelp };
