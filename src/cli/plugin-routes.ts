import { allBuiltins, handlePluginHelp } from '../builtins/index.js';
import { XBrowserPluginLoader } from '../plugin/loader.js';
import { PluginInstaller } from '../plugin/installer.js';
import { MarketplaceSearcher } from '../plugin/marketplace-search.js';
import { NPMSearcher } from '../plugin/npm-search.js';
import { startDaemonProcess, stopDaemonProcess, getDaemonProcessStatus } from '../daemon/daemon.js';
import { outputResult, outputError } from './output.js';
import { DEFAULT_MARKETPLACE_URL, NPM_REGISTRY_URL, resolveNpmPackageName } from '../config.js';
import { ensureProxyFetch } from '../utils/proxy-fetch.js';
import { getPluginLoader as getGlobalPluginLoader } from '../utils/plugin-singleton.js';
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

/**
 * Load all plugins and build a map of plugin-name → command names from runtime.
 * This captures commands even for plugins without package.json metadata.
 */
async function buildRuntimeCommandsMap(): Promise<Map<string, string[]>> {
  const loader = await getGlobalPluginLoader();
  const sites = loader.getCore().loader.getSites();
  const map = new Map<string, string[]>();
  for (const site of sites) {
    const cmds = site.getAllCommands().map(c => c.name);
    if (cmds.length > 0) {
      map.set(site.name, cmds);
    }
  }
  return map;
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
  await ensureProxyFetch();

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

async function handlePluginInfo(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const slug = args[0];
  if (!slug) outputError('Usage: xbrowser plugin info <slug>');

  applyRegistryOverride(options);
  await ensureProxyFetch();

  const marketplaceUrl =
    process.env.XBROWSER_MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL;

  try {
    const resp = await fetch(`${marketplaceUrl}/api/plugins/${slug}`);
    if (resp.ok) {
      const raw = (await resp.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
      };
      const d = raw.data || (raw as Record<string, unknown>);
      if (mode === 'json') {
        outputResult({ source: 'marketplace', ...d }, mode);
        return;
      }
      console.log(`名称: ${d.name || ''}`);
      console.log(`版本: ${d.version || ''}`);
      console.log(`描述: ${d.description || ''}`);
      console.log(`作者: ${d.authorName || d.author || ''}`);
      console.log(`状态: ${d.status || ''}`);
      console.log(`命令: ${((d.commands || []) as string[]).join(', ')}`);
      console.log(`下载量: ${d.downloadCount || 0}`);
      console.log(`标签: ${((d.tags || []) as string[]).join(', ')}`);
      console.log(`网站: ${((d.siteUrls || []) as string[]).join(', ')}`);
      return;
    }
  } catch {
    // marketplace unavailable, fallback to npm
  }

  try {
    const npmName = resolveNpmPackageName(slug);
    const resp = await fetch(`${NPM_REGISTRY_URL}/${encodeURIComponent(npmName)}`);
    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      const distTags = data['dist-tags'] as Record<string, string> | undefined;
      const latest = distTags?.latest;
      const versions = data.versions as Record<string, Record<string, unknown>> | undefined;
      const pkg = latest && versions?.[latest];
      if (pkg) {
        if (mode === 'json') {
          outputResult({ source: 'npm', name: pkg.name, version: latest, description: pkg.description }, mode);
          return;
        }
        console.log(`名称: ${pkg.name || ''}`);
        console.log(`版本: ${latest}`);
        console.log(`描述: ${pkg.description || ''}`);
        const author = pkg.author as { name?: string } | string | undefined;
        console.log(`作者: ${typeof author === 'string' ? author : author?.name || ''}`);
        console.log(`关键词: ${((pkg.keywords || []) as string[]).join(', ')}`);
        console.log(`许可证: ${pkg.license || ''}`);
        return;
      }
    }
    console.error(`插件 '${slug}' 未找到`);
  } catch (err) {
    console.error('查询失败:', (err as Error).message);
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
          'Usage: xbrowser plugin install <source> [--name <name>] [--force] [--from-marketplace] [--source marketplace|npm]'
        );
      const installOpts = {
        name: options.name as string | undefined,
        force: !!options.force,
      };
      const sourceFlag = options.source as string | undefined;
      let result;
      if (options['from-marketplace'] || sourceFlag === 'marketplace') {
        result = await installer.installFromMarketplace(source, installOpts);
      } else if (sourceFlag === 'npm') {
        result = await installer.install(source, installOpts);
      } else {
        result = await installer.installWithMarketplaceFallback(source, installOpts);
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

      // Load runtime commands from all plugins (including bare ones without package.json)
      const runtimeCommands = await buildRuntimeCommandsMap();

      // Merge static metadata + runtime commands into enriched plugin list
      const enrichedPlugins = plugins.map(p => {
        const metadata = p.metadata as Record<string, unknown> | undefined;
        const staticCommands = metadata?.commands as string[] | undefined;
        const dynamicCommands = runtimeCommands.get(p.name);
        // Runtime commands take precedence (more accurate), fallback to static metadata
        const commands = dynamicCommands || staticCommands;
        return {
          ...p,
          commands,
          version: metadata?.version as string | undefined,
          description: metadata?.description as string | undefined,
        };
      });

      if (mode === 'json') {
        outputResult({ plugins: enrichedPlugins }, mode);
      } else {
        if (enrichedPlugins.length === 0) {
          console.log('No plugins installed');
          return;
        }
        for (const p of enrichedPlugins) {
          if (p.version && p.description) {
            console.log(`${p.name} (${p.version}) - ${p.description}`);
          } else {
            console.log(p.name);
          }
          if (p.commands && p.commands.length > 0) {
            console.log(`  ${p.commands.join(', ')}`);
          }
        }
        console.log(`\nTotal: ${enrichedPlugins.length} plugins`);
      }
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
    case 'info':
      await handlePluginInfo(subArgs, options, mode);
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
  switch (sub) {
    case 'start': {
      const port = options.port ? Number(options.port) : 9224;
      startDaemonProcess(port)
        .then((config) =>
          outputResult({ ok: true, pid: config.pid, port: config.port }, mode)
        )
        .catch((e: unknown) =>
          outputError(e instanceof Error ? e.message : String(e))
        );
      break;
    }
    case 'stop': {
      stopDaemonProcess()
        .then(() => outputResult({ ok: true }, mode))
        .catch((e: unknown) =>
          outputError(e instanceof Error ? e.message : String(e))
        );
      break;
    }
    case 'status': {
      const status = getDaemonProcessStatus();
      outputResult(
        status.running ? { running: true, pid: status.pid, port: status.port } : { running: false },
        mode
      );
      break;
    }
    default:
      console.log('Usage: xbrowser daemon <start|stop|status> [--port <port>]');
  }
}
