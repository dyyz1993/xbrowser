import { parseArgs, type CommandResult } from '@dyyz1993/xcli-core';
import { version } from './version.js';
import { executeChain, isChainInput } from './executor.js';
import { allBuiltins } from './builtins/index.js';
import {
  handleBrowserCommand,
  handleSession,
  handlePlugin,
  handleCreate,
  handleDaemon,
  handleRecord,
  handleReplay,
  handleConvert,
  handleExtract,
  handleFilter,
  handleRun,
  handleAdmin,
} from './cli/index.js';
import { outputError, outputResult } from './cli/output.js';
import { showMainHelp } from './cli/help.js';
import { printChainResult, printChainResultBrief } from './cli/chain-output.js';
import { XBrowserPluginLoader } from './plugin/loader.js';
import { findSession, createSession, destroyBrowser } from './browser.js';

let pluginLoader: XBrowserPluginLoader | null = null;
let pluginsScanned = false;

async function getPluginLoader(): Promise<XBrowserPluginLoader> {
  if (!pluginLoader) {
    pluginLoader = new XBrowserPluginLoader();
  }
  if (!pluginsScanned) {
    await pluginLoader.scanAndLoad();
    pluginsScanned = true;
  }
  return pluginLoader;
}

function handleConfig(
  args: string[],
  options: Record<string, unknown>
): void {
  const builtin = allBuiltins.find((b) => b.name === 'config');
  if (builtin) builtin.execute(args, options, { cwd: process.cwd() });
}

function parseEvalFlags(argv: string[]): string[] {
  const commands: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-e' || argv[i] === '--eval') {
      const cmd = argv[i + 1];
      if (!cmd) {
        console.error('Error: -e/--eval requires a command argument');
        process.exit(1);
      }
      commands.push(cmd);
      i++;
    }
  }
  return commands;
}

async function handleStdinMode(stdinCommands: string[]): Promise<void> {
  const chain = stdinCommands.join(' && ');
  const chainResult = await executeChain(chain, { fileMode: true });
  printChainResult(chainResult);
  if (!chainResult.success) process.exit(1);
}

async function handleEvalMode(argv: string[]): Promise<void> {
  const evalCommands = parseEvalFlags(argv);
  if (evalCommands.length === 0) return;
  const chain = evalCommands.join(' && ');
  const chainResult = await executeChain(chain);
  printChainResultBrief(chainResult);
  if (!chainResult.success) process.exit(1);
}

async function handleChainInput(input: string): Promise<void> {
  const chainResult = await executeChain(input);
  printChainResult(chainResult);
  if (!chainResult.success) process.exit(1);
}

/**
 * Route CLI arguments to the appropriate handler.
 *
 * Dispatches stdin commands, eval flags, chain input, and sub-commands
 * (session, plugin, daemon, record, replay, etc.) to their respective
 * handler functions.
 *
 * @param argv - Raw CLI argument array (typically `process.argv.slice(2)`).
 * @param stdinCommands - Optional array of commands read from stdin.
 */
export async function routeCommand(
  argv: string[],
  stdinCommands?: string[]
): Promise<void> {
  if (stdinCommands && stdinCommands.length > 0) {
    await handleStdinMode(stdinCommands);
    return;
  }

  if (parseEvalFlags(argv).length > 0) {
    await handleEvalMode(argv);
    return;
  }

  if (argv.length === 1 && isChainInput(argv[0])) {
    await handleChainInput(argv[0]);
    return;
  }

  const parsed = parseArgs(argv);
  const { positional, options } = parsed;
  const mode = options.json ? 'json' : options.yaml ? 'yaml' : 'text';
  const sessionName = (options.session as string) || 'default';
  const cdpEndpoint = options.cdp as string | undefined;

  if (options.version || options.v) {
    console.log(`xbrowser v${version}`);
    process.exit(0);
  }
  if (positional.length === 0) {
    showMainHelp();
    process.exit(0);
  }

  const command = positional[0];
  const cmdArgs = positional.slice(1);

  if ((options.help || options.h) && positional.length > 0) {
    const loader = await getPluginLoader();
    const internalLoader = loader.getCore().loader;
    const site = internalLoader.getSite(command);
    if (site) {
      const commands = site.getAllCommands();
      if (mode === 'json') {
        outputResult({
          site: command,
          url: site.url,
          commands: commands.map((c) => ({
            name: c.name,
            description: c.description,
            scope: c.scope,
          })),
        }, mode);
      } else {
        console.log(`\n  ${site.config.description || site.name} (${site.url})`);
        console.log(`\n  Commands:`);
        for (const c of commands) {
          console.log(`    ${command} ${c.name.padEnd(20)} ${c.description}`);
        }
        console.log('');
      }
      return;
    }
    showMainHelp();
    return;
  }

  if (options.help || options.h) {
    showMainHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'session':
        await handleSession(cmdArgs, options, mode, cdpEndpoint);
        break;
      case 'plugin':
        await handlePlugin(cmdArgs, options, mode);
        break;
      case 'create':
        handleCreate(cmdArgs, options);
        break;
      case 'daemon':
        handleDaemon(cmdArgs, options, mode);
        break;
      case 'record':
        await handleRecord(cmdArgs, options, mode);
        break;
      case 'replay':
        await handleReplay(cmdArgs, options, mode);
        break;
      case 'config':
        handleConfig(cmdArgs, options);
        break;
      case 'convert':
        await handleConvert(cmdArgs, mode);
        break;
      case 'extract':
        await handleExtract(cmdArgs, mode);
        break;
      case 'filter':
        await handleFilter(cmdArgs, mode);
        break;
      case 'run':
        if (!cmdArgs[0]) {
          outputError('Usage: xbrowser run <file>');
        }
        await handleRun(cmdArgs[0], { cdpEndpoint, sessionName });
        break;
      case 'admin':
        await handleAdmin(cmdArgs, options, mode);
        break;
      case 'preview': {
        const builtin = allBuiltins.find((b) => b.name === 'preview');
        if (builtin) builtin.execute(cmdArgs, options, { cwd: process.cwd() });
        break;
      }
      case 'help':
        showMainHelp();
        break;
      default: {
        const fullInput = argv.join(' ');
        if (isChainInput(fullInput)) {
          const chainResult = await executeChain(fullInput, { cdpEndpoint, sessionName });
          for (const step of chainResult.steps) {
            if (step.success) {
              console.log(`[OK] ${step.raw}`);
            } else {
              console.error(`[FAIL] ${step.raw}: ${step.message}`);
            }
          }
          if (!chainResult.success) process.exit(1);
          return;
        }

        const loader = await getPluginLoader();
        const internalLoader = loader.getCore().loader;
        const site = internalLoader.getSite(command);
        if (site) {
          const subCommand = cmdArgs[0];
          if (!subCommand || subCommand === '--help' || subCommand === '-h') {
            const commands = site.getAllCommands();
            if (mode === 'json') {
              outputResult({
                site: command,
                url: site.url,
                commands: commands.map((c) => ({
                  name: c.name,
                  description: c.description,
                  scope: c.scope,
                })),
              }, mode);
            } else {
              console.log(`\n  ${site.config.description || site.name} (${site.url})`);
              console.log(`\n  Commands:`);
              for (const c of commands) {
                console.log(`    ${command} ${c.name.padEnd(20)} ${c.description}`);
              }
              console.log('');
            }
            return;
          }

          const cmdEntry = site.getCommand(subCommand);
          if (!cmdEntry) {
            outputError(
              `Unknown command "${subCommand}" for site "${command}".\n` +
              `Run "xbrowser ${command} --help" to see available commands.`
            );
            return;
          }

          const cmdArgsForPlugin = cmdArgs.slice(1);
          const params: Record<string, unknown> = { ...options };
          for (let i = 0; i < cmdArgsForPlugin.length; i++) {
            if (cmdArgsForPlugin[i] === '--' && cmdArgsForPlugin[i + 1]) {
              try {
                Object.assign(params, JSON.parse(cmdArgsForPlugin[i + 1]));
              } catch { /* not JSON, skip */ }
              break;
            }
          }

          let session = findSession(sessionName);
          let createdSession = false;
          if (!session) {
            session = await createSession(sessionName, undefined, {});
            createdSession = true;
          }

          const ctx = {
            args: cmdArgsForPlugin,
            options,
            cwd: process.cwd(),
            page: session.page,
            browser: session.context.browser()!,
            browserContext: session.context,
            sessionId: session.id,
            storage: {
              get: async <T>(_key: string): Promise<T | null> => null,
              set: async <T>(_key: string, _value: T): Promise<void> => {},
              delete: async (_key: string): Promise<void> => {},
              clear: async (): Promise<void> => {},
              keys: async (): Promise<string[]> => [],
            },
            output: { mode: mode as 'text' | 'json' | 'yaml', showTips: true, color: true, emoji: true },
            error: (msg: string) => { outputError(msg); },
            config: {},
            site,
            cliName: 'xbrowser',
            waitForHuman: async (_opts: Record<string, unknown>) => {
              return { solved: false, timedOut: true };
            },
          };

          try {
            const result = await cmdEntry.handler(params, ctx) as CommandResult;
            if (mode === 'json' || mode === 'yaml') {
              outputResult(result, mode);
            } else if (result) {
              if (result.data) console.log(JSON.stringify(result.data, null, 2));
              if (result.tips?.length) {
                for (const tip of result.tips) console.log(`  💡 ${tip}`);
              }
            }
          } finally {
            if (createdSession) {
              await destroyBrowser();
            }
          }
          return;
        }

        await handleBrowserCommand(command, cmdArgs, options, sessionName, mode);
      }
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}
