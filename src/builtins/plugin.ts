import type { BuiltinCommand } from './session.js';
import { XBrowserPluginLoader } from '../plugin/loader.js';
import { PluginInstaller } from '../plugin/installer.js';

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
    '  install <source> [--name <name>] [--force]  Install a plugin',
    '  uninstall <name>                             Uninstall a plugin',
    '  list                                         List installed plugins',
    '  reload <name>                                Reload a plugin',
    '',
    'Examples:',
    '  xbrowser plugin install ./my-plugin',
    '  xbrowser plugin install npm-package --name my-plugin',
    '  xbrowser plugin uninstall my-plugin',
    '  xbrowser plugin list',
    '  xbrowser plugin reload my-plugin',
  ].join('\n');
}

export const pluginInstallBuiltin: BuiltinCommand = {
  name: 'plugin install',
  description: 'Install a plugin',
  help: {
    usage: 'xbrowser plugin install <source> [--name <name>] [--force]',
    description: 'Install a plugin from local path, npm, git, or URL',
    options: [
      { name: '--name <name>', description: 'Custom plugin name' },
      { name: '--force', description: 'Overwrite existing plugin' },
    ],
    examples: [
      { cmd: 'xbrowser plugin install ./my-plugin', description: 'Install from local path' },
      { cmd: 'xbrowser plugin install some-npm-pkg', description: 'Install from npm' },
    ],
  },
  execute: async (args, options) => {
    const source = args[0];
    if (!source) {
      console.error('Usage: xbrowser plugin install <source> [--name <name>]');
      process.exit(1);
    }
    try {
      const installer = getInstaller();
      const result = await installer.install(source, {
        name: options['name'] as string | undefined,
        force: !!options['force'],
      });
      console.log(`Plugin "${result.name}" installed from ${result.source}`);
      console.log(`  Path: ${result.path}`);
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
    usage: 'xbrowser plugin list',
    description: 'Show all installed plugins and their status',
    options: [],
    examples: [{ cmd: 'xbrowser plugin list', description: 'List all plugins' }],
  },
  execute: async () => {
    try {
      const installer = getInstaller();
      const plugins = await installer.list();
      if (plugins.length === 0) {
        console.log('No plugins installed');
        return;
      }
      console.log('Installed plugins:');
      for (const p of plugins) {
        console.log(`  ${p.name} (${p.source}) - ${p.path}`);
      }
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
