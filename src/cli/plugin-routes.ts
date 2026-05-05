import { allBuiltins, handlePluginHelp } from '../builtins/index.js';
import { XBrowserPluginLoader } from '../plugin/loader.js';
import { PluginInstaller } from '../plugin/installer.js';
import { DaemonManager } from '../daemon/daemon.js';
import { outputResult, outputError } from './output.js';

let pluginLoader: XBrowserPluginLoader | null = null;

function getPluginLoader(): XBrowserPluginLoader {
  if (!pluginLoader) pluginLoader = new XBrowserPluginLoader();
  return pluginLoader;
}

export async function handlePlugin(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const sub = args[0];
  const subArgs = args.slice(1);
  const installer = new PluginInstaller();

  switch (sub) {
    case 'install': {
      const source = subArgs[0];
      if (!source)
        outputError(
          'Usage: xbrowser plugin install <source> [--name <name>] [--force]'
        );
      const result = await installer.install(source, {
        name: options.name as string | undefined,
        force: !!options.force,
      });
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
