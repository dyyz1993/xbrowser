import { allBuiltins, handlePluginHelp } from '../builtins/index.js';
import { XBrowserPluginLoader } from '../plugin/loader.js';
import { PluginInstaller } from '../plugin/installer.js';
import { MarketplaceSearcher } from '../plugin/marketplace-search.js';
import { NPMSearcher } from '../plugin/npm-search.js';
import { DaemonManager } from '../daemon/daemon.js';
import { outputResult, outputError } from './output.js';
import {
  handlePublish,
  handlePluginLogin,
  handlePluginWhoami,
  handlePluginLogout,
  handleRegister,
} from './publish-routes.js';

let pluginLoader: XBrowserPluginLoader | null = null;

function getPluginLoader(): XBrowserPluginLoader {
  if (!pluginLoader) pluginLoader = new XBrowserPluginLoader();
  return pluginLoader;
}

function applyRegistryOverride(options: Record<string, unknown>): void {
  const registry = options['registry'] as string | undefined;
  if (registry && !process.env.XBROWSER_MARKETPLACE_URL) {
    process.env.XBROWSER_MARKETPLACE_URL = registry;
  }
}

async function handleSearch(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const query = args[0] || '';
  applyRegistryOverride(options);

  const searchLimit = options.limit ? Number(options.limit) : 20;
  const searchOpts = { query, tag: options.tag as string | undefined, site: options.site as string | undefined, limit: searchLimit };

  const results: Array<Record<string, unknown>> = [];

  const marketplaceResults = await MarketplaceSearcher.search(searchOpts);
  for (const r of marketplaceResults) {
    results.push({ ...r, source: 'marketplace' });
  }

  if (marketplaceResults.length === 0) {
    try {
      const npmResults = await NPMSearcher.search(searchOpts);
      for (const r of npmResults) {
        results.push({ ...r, source: 'npm' });
      }
    } catch {
      // npm search may fail in restricted networks
    }
  }

  if (mode === 'json') {
    outputResult({ results, total: results.length }, mode);
  } else {
    if (results.length === 0) {
      console.log('No plugins found');
      return;
    }
    for (const r of results) {
      const src = r.source === 'marketplace' ? '[marketplace]' : '[npm]';
      const slug = r.slug ? ` (${r.slug})` : '';
      console.log(`  ${src} ${r.name}${slug}`);
      if (r.description) console.log(`    ${r.description}`);
      if (r.version) console.log(`    Version: ${r.version}`);
      if (r.downloads) console.log(`    Downloads: ${r.downloads}`);
      console.log('');
    }
    console.log(`Total: ${results.length} plugins`);
  }
}

export async function handlePlugin(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const sub = args[0];
  const subArgs = args.slice(1);
  applyRegistryOverride(options);
  const installer = new PluginInstaller();

  switch (sub) {
    case 'install': {
      const source = subArgs[0];
      if (!source)
        outputError(
          'Usage: xbrowser plugin install <source> [--name <name>] [--force] [--from-marketplace]'
        );
      const installOpts = {
        name: options.name as string | undefined,
        force: !!options.force,
      };
      let result;
      if (options['from-marketplace']) {
        result = await installer.installFromMarketplace(source, installOpts);
      } else {
        result = await installer.install(source, installOpts);
      }
      outputResult(
        { ok: true, name: result.name, source: result.source, path: result.path },
        mode
      );
      break;
    }
    case 'uninstall': {
      const name = subArgs[0];
      if (!name) outputError('Usage: xbrowser plugin uninstall <name>');
      await installer.uninstall(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'list': {
      const plugins = await installer.list();
      outputResult({ plugins }, mode);
      break;
    }
    case 'reload': {
      const name = subArgs[0];
      if (!name) outputError('Usage: xbrowser plugin reload <name>');
      await getPluginLoader().reloadPlugin(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'search':
      await handleSearch(subArgs, options, mode);
      break;
    case 'publish':
      await handlePublish(subArgs, options, mode);
      break;
    case 'register':
      await handleRegister(subArgs, options, mode);
      break;
    case 'login':
      await handlePluginLogin(subArgs, options, mode);
      break;
    case 'whoami':
      await handlePluginWhoami(subArgs, options, mode);
      break;
    case 'logout':
      await handlePluginLogout(subArgs, options, mode);
      break;
    default:
      console.log(handlePluginHelp());
  }
}

export function handleCreate(
  args: string[],
  options: Record<string, unknown>
): void {
  const name = args[0];
  if (!name) outputError('Usage: xbrowser create <name> --template <type>');
  const builtin = allBuiltins.find((b) => b.name === 'create');
  if (builtin) builtin.execute(args, options, { cwd: process.cwd() });
}

export function handleDaemon(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): void {
  const sub = args[0];
  const daemon = new DaemonManager();
  switch (sub) {
    case 'start': {
      const port = options.port ? Number(options.port) : undefined;
      daemon
        .start(port)
        .then((config) =>
          outputResult({ ok: true, pid: config.pid, port: config.port }, mode)
        )
        .catch((e: unknown) =>
          outputError(e instanceof Error ? e.message : String(e))
        );
      break;
    }
    case 'stop': {
      daemon
        .stop()
        .then(() => outputResult({ ok: true }, mode))
        .catch((e: unknown) =>
          outputError(e instanceof Error ? e.message : String(e))
        );
      break;
    }
    case 'status': {
      const status = daemon.status();
      outputResult(
        status ? { running: true, ...status } : { running: false },
        mode
      );
      break;
    }
    default:
      console.log('Usage: xbrowser daemon <start|stop|status> [--port <port>]');
  }
}
