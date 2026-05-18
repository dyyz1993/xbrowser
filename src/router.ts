import { parseArgs, outputFormatter, isCommandResult, type CommandResult } from '@dyyz1993/xcli-core';
import { mapPositionalValues } from './utils/positional-params.js';
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
import { getPluginLoader } from './utils/plugin-singleton.js';
import { findOrRestoreSession, createSession, saveSessionDiskMeta, destroyBrowser } from './browser.js';
import { HTTPServer } from './server/http-server.js';


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
        throw new Error("Command failed");
      }
      commands.push(cmd);
      i++;
    }
  }
  return commands;
}

function extractCdpFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cdp' && argv[i + 1]) return argv[i + 1];
    if (typeof argv[i] === 'string' && argv[i].startsWith('--cdp=')) return argv[i].slice(6);
  }
  return undefined;
}

async function handleStdinMode(stdinCommands: string[], argv?: string[]): Promise<void> {
  const chain = stdinCommands.join(' && ');
  const cdpEndpoint = argv ? extractCdpFromArgv(argv) : undefined;
  const chainResult = await executeChain(chain, { fileMode: true, cdpEndpoint });
  printChainResult(chainResult);
  if (!chainResult.success) throw new Error("Command failed");
}

async function handleEvalMode(argv: string[]): Promise<void> {
  const evalCommands = parseEvalFlags(argv);
  if (evalCommands.length === 0) return;
  const chain = evalCommands.join(' && ');
  const cdpEndpoint = extractCdpFromArgv(argv);
  const chainResult = await executeChain(chain, { cdpEndpoint });
  printChainResultBrief(chainResult);
  if (!chainResult.success) throw new Error("Command failed");
}

async function handleChainInput(input: string, argv?: string[]): Promise<void> {
  const cdpEndpoint = argv ? extractCdpFromArgv(argv) : undefined;
  const chainResult = await executeChain(input, { cdpEndpoint });
  printChainResult(chainResult);
  if (!chainResult.success) throw new Error("Command failed");
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
  try {
    if (stdinCommands && stdinCommands.length > 0) {
      await handleStdinMode(stdinCommands, argv);
      return;
    }

    if (parseEvalFlags(argv).length > 0) {
      await handleEvalMode(argv);
      return;
    }

    if (argv.length === 1 && isChainInput(argv[0])) {
      await handleChainInput(argv[0], argv);
      return;
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
    return;
  }

  const parsed = parseArgs(argv);
  const { positional, options } = parsed;
  const mode = options.json ? 'json' : options.yaml ? 'yaml' : 'text';
  const sessionName = (options.session as string) || 'default';
  const cdpEndpoint = options.cdp as string | undefined;

  if (options.version || options.v) {
    console.log(`xbrowser v${version}`);
    return;
  }
  if (positional.length === 0) {
    showMainHelp();
    return;
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
    return;
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
        handleConvert(cmdArgs, mode);
        break;
      case 'extract':
        handleExtract(cmdArgs, mode);
        break;
      case 'filter':
        handleFilter(cmdArgs, mode);
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
      case 'serve':
        await handleServe(cmdArgs, options, mode);
        break;
      case 'remote':
        await handleRemote(cmdArgs, options, mode);
        break;
      case 'preview': {
        const builtin = allBuiltins.find((b) => b.name === 'preview');
        if (builtin) await builtin.execute(cmdArgs, options, { cwd: process.cwd() });
        break;
      }
      case 'help':
        showMainHelp();
        break;
      case 'net': {
        const subCommand = cmdArgs[0] || 'list';
        const netSession = sessionName;

        const { isDaemonRunning, forwardNetworkList, forwardNetworkClear, forwardNetworkTop, forwardCommandLog, forwardNetworkAround, forwardNetworkAnalyze, forwardNetworkCurl, forwardNetworkReplay, forwardNetworkLike, forwardNetworkDislike, forwardNetworkExport, forwardNetworkInspect } = await import('./client/daemon-client.js');
        if (!(await isDaemonRunning())) {
          outputError('Daemon is not running. Start with: xbrowser daemon start');
          break;
        }

        switch (subCommand) {
          case 'list': {
            const filter = options.filter as string | undefined;
            const method = options.method as string | undefined;
            const limit = options.limit ? Number(options.limit) : 50;
            const result = (await forwardNetworkList(netSession, { filter, method, limit })) as {
              total: number;
              captures: Array<{
                id: number;
                method: string;
                status: number;
                resourceType: string;
                path: string;
                contentType: string;
                size: number;
              }>;
            };
            if (mode === 'json') {
              outputResult(result, mode);
            } else {
              console.log(`\n  Network captures (session: ${netSession})`);
              console.log(`  Total: ${result.total}, Showing: ${result.captures.length}\n`);
              for (const c of result.captures) {
                const statusColor = c.status < 300 ? '\x1b[32m' : c.status < 400 ? '\x1b[33m' : '\x1b[31m';
                const reset = '\x1b[0m';
                console.log(`  #${c.id} ${c.method.padEnd(6)} ${statusColor}${c.status}${reset} ${c.resourceType.padEnd(10)} ${c.path}`);
                if (c.size > 0) {
                  const sizeStr = c.size > 1024 ? `${(c.size / 1024).toFixed(1)}KB` : `${c.size}B`;
                  console.log(`         ${c.contentType.split(';')[0]} ${sizeStr}`);
                }
              }
              console.log('');
            }
            break;
          }
          case 'clear': {
            await forwardNetworkClear(netSession);
            console.log(`Network captures cleared for session: ${netSession}`);
            break;
          }
          case 'top': {
            const minScore = options['min-score'] ? Number(options['min-score']) : 0;
            const limit = options.limit ? Number(options.limit) : 20;
            const result = (await forwardNetworkTop(netSession, { minScore, limit })) as {
              session: string;
              entries: Array<{
                score: number;
                method: string;
                status: number;
                resourceType: string;
                path: string;
                contentType: string;
                size: number;
                scoreBreakdown: { content: number };
              }>;
            };
            if (mode === 'json') {
              outputResult(result, mode);
            } else {
              console.log(`\n  Top valued requests (session: ${netSession})`);
              console.log(`  Showing: ${result.entries.length}\n`);
              for (const e of result.entries) {
                const scoreColor = e.score >= 50 ? '\x1b[32m' : e.score >= 20 ? '\x1b[33m' : '\x1b[90m';
                const reset = '\x1b[0m';
                const methodStr = e.method.padEnd(6);
                const scoreStr = `${scoreColor}${e.score.toString().padStart(3)}${reset}`;
                console.log(`  ${scoreStr} ${methodStr} ${e.status} ${e.resourceType.padEnd(10)} ${e.path}`);
                if (e.scoreBreakdown.content > 0) {
                  console.log(`         ${e.contentType.split(';')[0]} ${e.size > 1024 ? (e.size / 1024).toFixed(1) + 'KB' : e.size + 'B'}`);
                }
              }
              console.log('');
            }
            break;
          }
          case 'log': {
            const logResult = await forwardCommandLog(netSession, options.limit ? Number(options.limit) : 50) as { session: string; commands: Array<{ id: number; timestamp: number; command: string; params: Record<string, unknown> }> };
            if (mode === 'json') {
              outputResult(logResult, mode);
            } else {
              console.log(`\n  Command log (session: ${netSession})`);
              console.log(`  Total: ${logResult.commands.length}\n`);
              for (const cmd of logResult.commands) {
                const ts = new Date(cmd.timestamp).toISOString().substring(11, 19);
                const paramsStr = Object.entries(cmd.params).map(([k, v]) => `${k}=${v}`).join(' ');
                console.log(`  #${cmd.id} [${ts}] ${cmd.command} ${paramsStr}`);
              }
              console.log('');
            }
            break;
          }
          case 'around': {
            const cmdId = parseInt(cmdArgs[1] || '0', 10);
            if (!cmdId) {
              outputError('Usage: xbrowser net around <command-id> [--window 5000]');
              break;
            }
            const windowMs = options.window ? Number(options.window) : 5000;
            const aroundResult = await forwardNetworkAround(netSession, cmdId, windowMs) as Record<string, unknown> | null;
            if (mode === 'json') {
              outputResult(aroundResult, mode);
            } else {
              if (!aroundResult) {
                console.log('  No command found with that ID');
                break;
              }
              const cmd = aroundResult.command as { id: number; timestamp: number; command: string };
              const ts = new Date(cmd.timestamp).toISOString().substring(11, 19);
              console.log(`\n  Command: #${cmd.id} [${ts}] ${cmd.command}`);
              console.log(`  Window: ±${windowMs}ms\n`);
              const before = (aroundResult.before as Array<Record<string, unknown>>);
              const after = (aroundResult.after as Array<Record<string, unknown>>);
              console.log(`  BEFORE (${before.length} requests):`);
              for (const r of before.slice(0, 5)) {
                console.log(`    ${r.method} ${r.status} ${String(r.resourceType).padEnd(10)} ${r.path}`);
              }
              console.log(`\n  AFTER (${aroundResult.afterCount as number} requests):`);
              for (const r of after.slice(0, 10)) {
                const highlight = r.method !== 'GET' ? ' ←' : '';
                console.log(`    ${String(r.method).padEnd(6)} ${r.status} ${String(r.resourceType).padEnd(10)} ${r.path}${highlight}`);
              }
              console.log('');
            }
            break;
          }
          case 'analyze': {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await forwardNetworkAnalyze(netSession) as any;
            if (mode === 'json') {
              outputResult(result, mode);
            } else {
              console.log(`\n  API Reusability Analysis (session: ${netSession})`);
              console.log(`  Total: ${result.total}, Analyzed: ${result.analyzed.length}\n`);

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const groups: Record<string, any[]> = { high: [], medium: [], low: [], unknown: [] };
              for (const e of result.analyzed) {
                groups[e.reusability.level]?.push(e);
              }

              for (const level of ['high', 'medium', 'low', 'unknown'] as const) {
                const items = groups[level];
                if (!items?.length) continue;
                const color = level === 'high' ? '\x1b[32m' : level === 'medium' ? '\x1b[33m' : level === 'low' ? '\x1b[31m' : '\x1b[90m';
                const reset = '\x1b[0m';
                console.log(`  ${color}${level.toUpperCase()}${reset} (${items.length})`);
                for (const e of items.slice(0, 5)) {
                  const scoreStr = `[${e.reusability.score.toString().padStart(3)}]`;
                  console.log(`    ${e.method.padEnd(6)} ${e.status} ${scoreStr} ${e.path}`);
                  if (e.reusability.reasons.length > 0) {
                    console.log(`           ${e.reusability.reasons.join(', ')}`);
                  }
                }
                if (items.length > 5) console.log(`    ... and ${items.length - 5} more`);
                console.log('');
              }
            }
            break;
          }
          case 'curl': {
            const id = parseInt(cmdArgs[1] || '0', 10);
            if (!id) {
              outputError('Usage: xbrowser net curl <id> [--session default]');
              break;
            }
            const result = await forwardNetworkCurl(netSession, id) as Record<string, unknown>;
            if ((result as Record<string, unknown>).error) {
              outputError((result as Record<string, unknown>).error as string);
              break;
            }
            if (mode === 'json') {
              outputResult(result, mode);
            } else {
              console.log(`\n  ${result.method} ${result.url}`);
              console.log(`  Headers: ${result.headerCount}, Body: ${result.hasBody}\n`);
              console.log(result.command as string);
              console.log('');
            }
            break;
          }
          case 'replay': {
            const id = parseInt(cmdArgs[1] || '0', 10);
            if (!id) {
              outputError('Usage: xbrowser net replay <id> [--session default]');
              break;
            }
            const result = await forwardNetworkReplay(netSession, id) as Record<string, unknown>;
            if ((result as Record<string, unknown>).error) {
              outputError((result as Record<string, unknown>).error as string);
              break;
            }
            if (mode === 'json') {
              outputResult(result, mode);
            } else {
              console.log(`\n  Replay Result`);
              console.log(`  ${(result.curlCommand as string)?.split('\n')[0]?.trim()}\n`);
              const replay = result.replay as Record<string, unknown> | undefined;
              if (replay?.error) {
                console.log(`  \x1b[31mFAILED\x1b[0m: ${replay.error}`);
              } else if (replay) {
                const statusColor = (replay.status as number) && (replay.status as number) < 300 ? '\x1b[32m' : '\x1b[31m';
                const status = replay.status as number;
                const size = replay.size as number;
                const duration = replay.duration as number;
                console.log(`  Status: ${statusColor}${status}\x1b[0m ${replay.statusText}`);
                console.log(`  Size: ${size > 1024 ? (size / 1024).toFixed(1) + 'KB' : size + 'B'}`);
                console.log(`  Duration: ${duration}ms`);
                console.log(`  Body Match: ${replay.bodyMatch ? '\x1b[32mYes\x1b[0m' : '\x1b[33mNo\x1b[0m'}`);
                if (status && status >= 400) {
                  console.log(`  \x1b[33m⚠ API may require fresh signature/token\x1b[0m`);
                }
              }
              console.log('');
            }
            break;
          }
          case 'inspect': {
            const id = parseInt(cmdArgs[1] || '0', 10);
            if (!id) {
              outputError('Usage: xbrowser net inspect <id> [--session default]');
              break;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await forwardNetworkInspect(netSession, id) as any;
            if (!result.capture) {
              outputError(`Entry #${id} not found`);
              break;
            }
            if (mode === 'json') {
              outputResult(result, mode);
            } else {
              const c = result.capture;
              console.log(`\n  Request #${c.id}`);
              console.log(`  ${c.method} ${c.url}`);
              console.log(`  Status: ${c.status} | Size: ${c.size}B | Type: ${c.contentType}`);
              console.log(`  Resource: ${c.resourceType}`);
              if (c.requestHeaders) {
                console.log(`\n  Request Headers:`);
                for (const [k, v] of Object.entries(c.requestHeaders)) {
                  console.log(`    ${k}: ${String(v).substring(0, 100)}`);
                }
              }
              if (c.requestBody !== undefined) {
                console.log(`\n  Request Body:`);
                const bodyStr = typeof c.requestBody === 'string' ? c.requestBody : JSON.stringify(c.requestBody, null, 2);
                const lines = bodyStr.split('\n').slice(0, 20);
                for (const line of lines) console.log(`    ${line}`);
                if (bodyStr.split('\n').length > 20) console.log('    ...');
              }
              console.log(`\n  Response Headers:`);
              for (const [k, v] of Object.entries(c.headers)) {
                console.log(`    ${k}: ${String(v).substring(0, 100)}`);
              }
              if (c.body !== undefined) {
                console.log(`\n  Response Body:`);
                const bodyStr = typeof c.body === 'string' ? c.body : JSON.stringify(c.body, null, 2);
                const lines = bodyStr.split('\n').slice(0, 20);
                for (const line of lines) console.log(`    ${line}`);
                if (bodyStr.split('\n').length > 20) console.log('    ...');
              }
              console.log('');
            }
            break;
          }
          case 'like': {
            const id = parseInt(cmdArgs[1] || '0', 10);
            if (!id) { outputError('Usage: xbrowser net like <id>'); break; }
            await forwardNetworkLike(netSession, id);
            console.log(`Marked #${id} as useful`);
            break;
          }
          case 'dislike': {
            const id = parseInt(cmdArgs[1] || '0', 10);
            if (!id) { outputError('Usage: xbrowser net dislike <id>'); break; }
            await forwardNetworkDislike(netSession, id);
            console.log(`Marked #${id} as not useful`);
            break;
          }
          case 'export': {
            const id = parseInt(cmdArgs[1] || '0', 10);
            if (!id) { outputError('Usage: xbrowser net export <id> [--lang ts|python|curl]'); break; }
            const lang = (options.lang as string) || 'ts';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await forwardNetworkExport(netSession, id, lang) as any;
            if (result.error) { outputError(result.error); break; }
            console.log(result.code);
            break;
          }
          default:
            outputError(`Unknown net sub-command: ${subCommand}. Use: list, clear, top, log, around, analyze, curl, replay, inspect, like, dislike, export`);
        }
        break;
      }
      default: {
        const fullInput = argv.join(' ');
        if (isChainInput(fullInput)) {
          const chainResult = await executeChain(fullInput, { cdpEndpoint, sessionName });
          for (const step of chainResult.steps) {
            if (step.success) {
              console.log(`[OK] ${step.raw}`);
              if (step.tips?.length) {
                for (const tip of step.tips) {
                  console.log(`  💡 ${tip}`);
                }
              }
            } else {
              console.error(`[FAIL] ${step.raw}: ${step.message}`);
            }
          }
          if (!chainResult.success) throw new Error("Command failed");
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
          const rawParams: Record<string, unknown> = { ...options };

          // Parse --key value pairs and collect positional args
          const positionalValues: string[] = [];
          for (let i = 0; i < cmdArgsForPlugin.length; i++) {
            if (cmdArgsForPlugin[i] === '--' && cmdArgsForPlugin[i + 1]) {
              try {
                Object.assign(rawParams, JSON.parse(cmdArgsForPlugin[i + 1]));
              } catch { /* not JSON, skip */ }
              break;
            }
            if (cmdArgsForPlugin[i].startsWith('--')) {
              const key = cmdArgsForPlugin[i].slice(2);
              const value = cmdArgsForPlugin[i + 1];
              if (value && !value.startsWith('-')) {
                if (value === 'true') rawParams[key] = true;
                else if (value === 'false') rawParams[key] = false;
                else if (/^\d+$/.test(value)) rawParams[key] = parseInt(value, 10);
                else rawParams[key] = value;
                i++;
              } else {
                rawParams[key] = true;
              }
            } else if (!cmdArgsForPlugin[i].startsWith('-')) {
              positionalValues.push(cmdArgsForPlugin[i]);
            }
          }

          // Map positional values to Zod schema params (with type coercion + unquoting)
          Object.assign(rawParams, mapPositionalValues(cmdEntry.parameters!, positionalValues, rawParams));

          const params: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawParams)) {
            const camelKey = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            params[camelKey] = v;
          }

          let session = await findOrRestoreSession(sessionName, cdpEndpoint);
          if (!session) {
            session = await createSession(sessionName, undefined, cdpEndpoint ? { cdpEndpoint } : {});
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
              set: async <T>(_key: string, _value: T): Promise<void> => { },
              delete: async (_key: string): Promise<void> => { },
              clear: async (): Promise<void> => { },
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
            // Auto-save conversationUrl to session file for cross-process recovery
            if (session && result && result.data) {
              const convUrl = (result.data as Record<string, unknown>).conversationUrl as string | undefined;
              if (convUrl) {
                saveSessionDiskMeta(sessionName, { conversationUrl: convUrl, cdpEndpoint });
              }
            }
            if (isCommandResult(result)) {
              // Framework-controlled output: json/yaml → pure data on stdout, tips on stderr
              if (mode === 'json' || mode === 'yaml') {
                console.log(outputFormatter.format(result.data, { mode: mode as 'json' | 'yaml', color: false, emoji: false }));
                if (result.tips?.length) {
                  for (const tip of result.tips) console.error(`\u{1F4A1} ${tip}`);
                }
              } else {
                console.log(outputFormatter.format(result.data, { mode: 'text', color: true, emoji: true }));
                if (result.tips?.length) {
                  for (const tip of result.tips) console.log(`  \u{1F4A1} ${tip}`);
                }
              }
            } else if (result && typeof result === 'object') {
              // Legacy plugins that don't return standard CommandResult
              const obj = result as Record<string, unknown>;
              if (mode === 'json' || mode === 'yaml') {
                console.log(outputFormatter.format(obj.data ?? obj, { mode: mode as 'json' | 'yaml', color: false, emoji: false }));
                const tips = obj.tips as string[] | undefined;
                if (tips?.length) {
                  for (const tip of tips) console.error(`\u{1F4A1} ${tip}`);
                }
              } else {
                if (obj.data) console.log(JSON.stringify(obj.data, null, 2));
                const tips = obj.tips as string[] | undefined;
                if (tips?.length) {
                  for (const tip of tips) console.log(`  \u{1F4A1} ${tip}`);
                }
              }
            }
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e));
          } finally {
            // CLI mode: clean up browser resources so process can exit.
            // Daemon mode: keep sessions alive for reuse.
            if (process.env.XBROWSER_DAEMON_WORKER !== '1') {
              await destroyBrowser().catch(() => {});
            }
          }
          return;
        }

        await handleBrowserCommand(command, cmdArgs, options, sessionName, mode, cdpEndpoint);
      }
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Handle the `xbrowser serve` command — start an HTTP server for remote access.
 *
 * @param args - Positional arguments (unused).
 * @param options - CLI options including `--port` and `--token`.
 * @param mode - Output mode (text, json, yaml).
 */
async function handleServe(
  _args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const port = options.port ? Number(options.port) : undefined;
  const token = options.token as string | undefined;

  const httpServer = new HTTPServer({ port, tokens: token ? [token] : undefined });

  process.on('SIGINT', async () => {
    await httpServer.stop();
    return;
  });
  process.on('SIGTERM', async () => {
    await httpServer.stop();
    return;
  });

  try {
    const addr = await httpServer.start();
    const output = {
      ok: true,
      message: `xbrowser HTTP server running`,
      url: `http://${addr.host}:${addr.port}`,
      port: addr.port,
      authRequired: !!token || !!process.env.XBROWSER_SERVER_TOKEN,
      endpoints: {
        health: `GET  /api/v1/health`,
        commands: `GET  /api/v1/commands`,
        sessions: `GET  /api/v1/sessions`,
        createSession: `POST /api/v1/sessions`,
        closeSession: `DELETE /api/v1/sessions/:name`,
        exec: `POST /api/v1/exec`,
        chain: `POST /api/v1/chain`,
      },
    };

    if (mode === 'json') {
      outputResult(output, mode);
    } else {
      console.log(`\n  🌐 xbrowser HTTP Server`);
      console.log(`\n  URL: ${output.url}`);
      console.log(`  Auth: ${output.authRequired ? 'Enabled (Bearer token)' : 'Disabled (dev mode)'}\n`);
      console.log(`  Endpoints:`);
      for (const [, value] of Object.entries(output.endpoints)) {
        console.log(`    ${value}`);
      }
      console.log(`\n  Press Ctrl+C to stop\n`);
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
    throw new Error("Command failed");
  }
}

/**
 * Handle the `xbrowser remote` command — proxy commands to a remote
 * xbrowser HTTP server.
 *
 * @param args - Positional arguments: [url, command...].
 * @param options - CLI options including `--token`.
 * @param mode - Output mode (text, json, yaml).
 */
async function handleRemote(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const serverUrl = args[0];
  if (!serverUrl) {
    outputError('Usage: xbrowser remote <url> [command] [--token <token>]');
    return;
  }

  const token = options.token as string | undefined;

  if (!args[1]) {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const resp = await fetch(`${serverUrl}/api/v1/health`, { headers });
      const data = await resp.json();
      outputResult(data, mode);
    } catch (e) {
      outputError(`Failed to connect to ${serverUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  const command = args.slice(1).join(' ');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  if (isChainInput(command)) {
    const body = { chain: command };
    try {
      const resp = await fetch(`${serverUrl}/api/v1/chain`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { steps?: Array<{ success: boolean; raw: string; message?: string }> };
      if (mode === 'json') {
        outputResult(data, mode);
      } else {
        for (const step of data.steps || []) {
          if (step.success) {
            console.log(`[OK] ${step.raw}`);
          } else {
            console.error(`[FAIL] ${step.raw}: ${step.message}`);
          }
        }
      }
    } catch (e) {
      outputError(`Remote execution failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    const parts = command.split(/\s+/);
    const cmdName = parts[0];
    const cmdParts = parts.slice(1);
    const params: Record<string, unknown> = {};

    for (let i = 0; i < cmdParts.length; i++) {
      if (cmdParts[i].startsWith('--')) {
        const key = cmdParts[i].slice(2);
        const val = cmdParts[i + 1];
        if (val && !val.startsWith('--')) {
          params[key] = val;
          i++;
        } else {
          params[key] = true;
        }
      } else {
        if (!params.url) params.url = cmdParts[i];
        else if (!params.selector) params.selector = cmdParts[i];
        else if (!params.value) params.value = cmdParts[i];
      }
    }

    const body = { command: cmdName, params };
    try {
      const resp = await fetch(`${serverUrl}/api/v1/exec`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { success?: boolean; data?: unknown; message?: string };
      if (mode === 'json') {
        outputResult(data, mode);
      } else {
        if (data.success) {
          if (data.data) console.log(JSON.stringify(data.data, null, 2));
        } else {
          outputError(data.message || 'Command failed');
        }
      }
    } catch (e) {
      outputError(`Remote execution failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
