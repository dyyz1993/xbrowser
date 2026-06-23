import { allBuiltins, handlePluginHelp } from '../builtins/index.js';
import { errMsg } from '../utils/error.js';
import { createStubContext } from '../utils/stub-context.js';
import { XBrowserPluginLoader } from '../plugin/loader.js';
import { PluginInstaller } from '../plugin/installer.js';
import { NPMSearcher } from '../plugin/npm-search.js';
import { startDaemonProcess, stopDaemonProcess, getDaemonProcessStatus } from '../daemon/daemon.js';
import { outputResult, outputError } from './output.js';
import { NPM_REGISTRY_URL, resolveNpmPackageWithFallback } from '../config.js';
import { ensureProxyFetch } from '../utils/proxy-fetch.js';
import { getPluginLoader as getGlobalPluginLoader } from '../utils/plugin-singleton.js';
import type { PluginCommandContract, PluginContract } from '../plugin/types.js';

interface PluginRuntimeInfo {
  commands: string[];
  hasLogin: boolean;
  loggedIn: boolean | null;
  requiresLoginCommands: string[];
}

async function buildRuntimePluginInfo(): Promise<Map<string, PluginRuntimeInfo>> {
  const loader = await getGlobalPluginLoader();
  const sites = loader.getCore().loader.getSites();
  const map = new Map<string, PluginRuntimeInfo>();
  for (const site of sites) {
    const cmds = site.getAllCommands();
    const commandNames = cmds.map(c => c.name);
    if (commandNames.length === 0) continue;
    // SiteInstance may have a dynamically-attached hasLoginCommand method
    // (added by login-required-patch.ts). Check with `in` instead of double-casting.
    const hasLoginHandler = 'hasLoginCommand' in site
      && typeof (site as Record<string, unknown>).hasLoginCommand === 'function'
      && ((site as Record<string, unknown>).hasLoginCommand as () => boolean)();
    const configRequiresLogin = !!site.config.requiresLogin;
    const hasLogin = hasLoginHandler || configRequiresLogin;
    let loggedIn: boolean | null = null;
    if (hasLogin) {
      try { loggedIn = await site.isLoggedIn(); } catch { loggedIn = null; }
    }
    const requiresLoginCommands = cmds
      .filter(c => c.requiresLogin === true)
      .map(c => c.name);
    map.set(site.name, { commands: commandNames, hasLogin, loggedIn, requiresLoginCommands });
  }
  return map;
}

function applyRegistryOverride(options: Record<string, unknown>): void {
  const registry = options['registry'] as string | undefined;
  if (registry && !process.env.XBROWSER_MARKETPLACE_URL) {
    process.env.XBROWSER_MARKETPLACE_URL = registry;
  }
}

function extractItems(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  if ('data' in r) {
    const data = r.data as Record<string, unknown>;
    if (data && 'items' in data && Array.isArray(data.items)) {
      return data.items as Array<Record<string, unknown>>;
    }
  }
  if ('items' in r && Array.isArray(r.items)) {
    return r.items as Array<Record<string, unknown>>;
  }
  return [];
}

async function searchFromMarketplacePlugin(
  options: { query?: string; tag?: string; site?: string; limit?: number },
  loader: XBrowserPluginLoader,
): Promise<Array<Record<string, unknown>>> {
  const sites = loader.getCore().loader.getSites();
  // 只找 marketplace site（由 marketplace 插件注册）
  const marketplaceSite = sites.find(s => s.name === 'marketplace');
  if (!marketplaceSite) return [];

  const searchCmd = marketplaceSite.getCommand('search');
  if (!searchCmd) return [];

  try {
    const result = await searchCmd.handler(
      {
        query: options.query,
        tag: options.tag,
        site: options.site,
        limit: options.limit,
      },
      createStubContext('marketplace'),
    );

    const items = extractItems(result);
    return items.map(item => ({ ...item, source: 'marketplace' }));
  } catch {
    // marketplace 插件搜索失败，静默跳过
    return [];
  }
}

async function infoFromMarketplacePlugin(
  slug: string,
  loader: XBrowserPluginLoader,
): Promise<Record<string, unknown> | null> {
  const sites = loader.getCore().loader.getSites();
  const marketplaceSite = sites.find(s => s.name === 'marketplace');
  if (!marketplaceSite) return null;

  const infoCmd = marketplaceSite.getCommand('info');
  if (!infoCmd) return null;

  try {
    const result = await infoCmd.handler({ slug }, createStubContext('marketplace'));

    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;

    let plugin: Record<string, unknown> | null = null;
    if ('data' in r) {
      const data = r.data as Record<string, unknown>;
      plugin = (data?.plugin as Record<string, unknown>) || null;
    }
    if (!plugin && 'plugin' in r) {
      plugin = r.plugin as Record<string, unknown>;
    }

    if (plugin && plugin.name) {
      return { ...plugin, source: 'marketplace' };
    }
  } catch {
    // marketplace 插件 info 失败，静默跳过
  }

  return null;
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

  const loader = await getGlobalPluginLoader();
  const pluginResults = await searchFromMarketplacePlugin(searchOpts, loader);
  results.push(...pluginResults);

  if (pluginResults.length === 0) {
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

  const loader = await getGlobalPluginLoader();

  try {
    const pluginInfo = await infoFromMarketplacePlugin(slug, loader);
    if (pluginInfo) {
      const d = pluginInfo;
      if (mode === 'json') {
        outputResult({ source: 'marketplace', ...d }, mode);
        return;
      }
      console.log(`名称: ${d.name || ''}`);
      console.log(`版本: ${d.version || ''}`);
      console.log(`描述: ${d.description || ''}`);
      console.log(`作者: ${d.author || ''}`);
      console.log(`命令: ${((d.commands || []) as string[]).join(', ')}`);
      console.log(`下载量: ${d.downloads || 0}`);
      console.log(`标签: ${((d.tags || []) as string[]).join(', ')}`);
      console.log(`网站: ${((d.sites || []) as string[]).join(', ')}`);
      return;
    }
  } catch {
    // Plugin-based info unavailable, fallback to npm
  }

  try {
    const npmName = await resolveNpmPackageWithFallback(slug);
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
    console.error('查询失败:', errMsg(err));
  }
}

async function handlePluginSchema(
  args: string[],
  mode: string
): Promise<void> {
  const pluginName = args[0];
  const commandName = args[1];
  if (!pluginName) outputError('Usage: xbrowser plugin schema <name> [command] [--json]');

  const loader = await getGlobalPluginLoader();
  const contract = loader.getPluginContract(pluginName, commandName);
  if (!contract) {
    outputError(commandName
      ? `Command "${commandName}" not found in plugin "${pluginName}"`
      : `Plugin "${pluginName}" not found`);
    return;
  }

  if (mode === 'json') {
    outputResult(contract, mode);
    return;
  }

  if ('commands' in contract) {
    printPluginContract(contract);
  } else {
    printCommandContract(pluginName, contract);
  }
}

function printPluginContract(contract: PluginContract): void {
  console.log(`${contract.plugin.name} contract v${contract.version}`);
  if (contract.plugin.description) console.log(contract.plugin.description);
  console.log('');
  for (const command of contract.commands) {
    printCommandContract(contract.plugin.name, command);
  }
}

function printCommandContract(pluginName: string, command: PluginCommandContract): void {
  console.log(`${pluginName} ${command.name}`);
  if (command.description) console.log(`  ${command.description}`);
  console.log(`  scope: ${command.scope}`);
  if (command.capabilities.length > 0) {
    console.log(`  capabilities: ${command.capabilities.join(', ')}`);
  }
  if (command.positional.length > 0) {
    console.log(`  positional: ${command.positional.join(', ')}`);
  }
  if (command.form.fields.length > 0) {
    console.log('  fields:');
    for (const field of command.form.fields) {
      const required = field.required ? 'required' : 'optional';
      const choices = field.enum ? ` [${field.enum.join('|')}]` : '';
      console.log(`    --${field.name}: ${field.type}/${field.widget} ${required}${choices}`);
    }
  }
  console.log('');
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
      // Reload the plugin into memory so it's available for immediate use
      try { await (await getGlobalPluginLoader()).reloadPlugin(result.name); } catch { /* not critical */ }
      outputResult(
        { ok: true, name: result.name, source: result.source, path: result.path },
        mode
      );
      break;
    }
    case 'uninstall': {
      const name = subArgs[0];
      if (!name) outputError('Usage: xbrowser plugin uninstall <name>');
      // Check if plugin is actually installed before uninstalling
      const installed = await installer.list();
      const exists = installed.some(p => p.name === name || p.metadata?.name === name);
      if (!exists) {
        outputError(`Plugin "${name}" is not installed. Use 'xbrowser plugin list' to see installed plugins.`);
      }
      await installer.uninstall(name);
      // Reload the plugin registry so the delisted plugin is removed from memory
      try {
        const loader = await getGlobalPluginLoader();
        await loader.reloadPlugin(name);
      } catch { /* plugin already removed */ }
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'list': {
      const plugins = await installer.list();

      const runtimeInfo = await buildRuntimePluginInfo();

      const enrichedPlugins = plugins.map(p => {
        const metadata = p.metadata as Record<string, unknown> | undefined;
        const staticCommands = metadata?.commands as string[] | undefined;
        const rt = runtimeInfo.get(p.name);
        const commands = rt?.commands || staticCommands;
        return {
          ...p,
          commands,
          version: metadata?.version as string | undefined,
          description: metadata?.description as string | undefined,
          hasLogin: rt?.hasLogin ?? false,
          loggedIn: rt?.loggedIn ?? null,
          requiresLoginCommands: rt?.requiresLoginCommands ?? [],
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
          const loginTag = p.hasLogin ? (p.loggedIn ? ' [logged in]' : ' [need login]') : '';
          if (p.version && p.description) {
            console.log(`${p.name} (${p.version}) - ${p.description}${loginTag}`);
          } else {
            console.log(`${p.name}${loginTag}`);
          }
          if (p.commands && p.commands.length > 0) {
            console.log(`  ${p.commands.join(', ')}`);
          }
          if (p.requiresLoginCommands.length > 0) {
            console.log(`  requires login: ${p.requiresLoginCommands.join(', ')}`);
          }
        }
        console.log(`\nTotal: ${enrichedPlugins.length} plugins`);
      }
      break;
    }
    case 'schema':
      await handlePluginSchema(subArgs, mode);
      break;
    case 'reload': {
      const name = subArgs[0];
      if (!name) outputError('Usage: xbrowser plugin reload <name>');
      (await getGlobalPluginLoader()).reloadPlugin(name);
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
    case 'register':
    case 'login':
    case 'whoami':
    case 'logout':
      outputError(`"${sub}" has moved to the marketplace plugin. Use: xbrowser marketplace ${sub}`);
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
      console.log('Daemon starts automatically. No manual action needed.');
  }
}
