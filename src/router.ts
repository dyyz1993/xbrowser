import { parseArgs, outputFormatter, isCommandResult, type CommandResult, helpGenerator } from '@dyyz1993/xcli-core';
import { parsePluginParams } from './utils/plugin-params.js';
import { version } from './version.js';
import { executeChain, isChainInput, getPluginStorage } from './executor.js';
import { loadHooks } from './hooks/loader.js';
import { allBuiltins } from './builtins/index.js';

/**
 * Known global options that xbrowser CLI recognizes as flags.
 * These are filtered out during plugin param validation to avoid false positives.
 */
const KNOWN_GLOBAL_OPTIONS = new Set([
  'json', 'yaml',
  'session',
  'cdp', 'cdp-endpoint',
  'version', 'v',
  'help', 'h',
  'target',
  'port',
  'token',
  'timeout',
  'headless',
]);

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
  handleViewer,
  handleNetCommand,
} from './cli/index.js';
import { outputError, outputResult } from './cli/output.js';
import { showMainHelp } from './cli/help.js';
import { printChainResult, printChainResultBrief } from './cli/chain-output.js';
import { getPluginLoader } from './utils/plugin-singleton.js';
import { findOrRestoreSession, createSession, saveSessionDiskMeta } from './browser.js';
import { HTTPServer } from './server/http-server.js';
import { getCommand } from './commands/command-registry.js';

function showCommandHelp(siteName: string, cmd: unknown, siteConfig: { description?: string; name: string; url: string }, mode: string): void {
  const c = cmd as { name: string; description: string; scope: string; parameters?: unknown; examples?: Array<{ cmd: string; description: string }> };

  if (mode === 'json') {
    const paramsList: Array<{ name: string; type: string; required: boolean; default_: unknown; description: string; enumValues?: string[] }> = [];
    if (c.parameters) {
      const def = (c.parameters as unknown as { _def: { shape?: () => Record<string, unknown> } })._def;
      const shape = def.shape?.() as Record<string, unknown> | undefined;
      if (shape) {
        for (const [key, value] of Object.entries(shape)) {
          const info = extractZodFieldInfo(value);
          paramsList.push({
            name: key,
            type: info.cleanType,
            required: !info.isOptional,
            default_: info.defaultValue,
            description: info.description,
            ...(info.enumValues ? { enumValues: info.enumValues } : {}),
          });
        }
      }
    }
    outputResult({
      site: siteName,
      command: c.name,
      description: c.description,
      scope: c.scope,
      parameters: paramsList,
    }, mode);
  } else {
    console.log(`\n  ${siteConfig.description || siteConfig.name} (${siteConfig.url})`);
    const text = helpGenerator.generate({
      name: `${siteName} ${c.name}`,
      description: c.description,
      parameters: c.parameters as Parameters<typeof helpGenerator.generate>[0]['parameters'],
      examples: c.examples,
    }, { color: false, emoji: false });
    console.log(text);
    console.log('');
  }
}

/** Extract type info from a Zod field (handles Optional, Default, Enum wrappers) */
function extractZodFieldInfo(value: unknown): {
  cleanType: string;
  isOptional: boolean;
  defaultValue: unknown;
  description: string;
  enumValues: string[] | undefined;
} {
  const field = value as { _def?: { typeName?: string; defaultValue?: () => unknown; innerType?: unknown; values?: unknown[]; description?: string } };
  const fieldDef = field._def;
  let typeName = fieldDef?.typeName || 'unknown';
  let isOptional = typeName === 'ZodOptional' || typeName === 'ZodDefault';
  let innerType = fieldDef?.innerType;
  let enumValues: string[] | undefined;
  let defaultValue: unknown = undefined;
  let description = fieldDef?.description || '';

  // Unwrap optional/default layers
  let depth = 0;
  while ((isOptional || typeName === 'ZodDefault') && innerType && depth < 5) {
    const inner = (innerType as { _def?: { typeName?: string; defaultValue?: () => unknown; innerType?: unknown; values?: unknown[]; description?: string } })._def;
    if (!inner) break;

    if (inner.defaultValue) defaultValue = inner.defaultValue();
    if (inner.description) description = inner.description;
    if (typeName === 'ZodDefault' && fieldDef?.defaultValue) defaultValue = fieldDef.defaultValue();
    typeName = inner.typeName || typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
      isOptional = true;
      innerType = inner.innerType;
    } else {
      break;
    }
    depth++;
  }

  // Extract enum values
  if (typeName === 'ZodEnum') {
    enumValues = fieldDef?.values as string[] | undefined;
    if (!enumValues && innerType) {
      const inner = (innerType as { _def?: { values?: unknown[] } })._def;
      enumValues = inner?.values as string[] | undefined;
    }
  }

  // Extract default from ZodDefault
  if (fieldDef?.defaultValue) {
    defaultValue = fieldDef.defaultValue();
    isOptional = true;
  }

  const cleanType = typeName.replace('Zod', '').toLowerCase();

  return { cleanType, isOptional, defaultValue, description, enumValues };
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
  const jsonMode = argv ? argv.includes('--json') || argv.includes('-j') : false;
  const chainResult = await executeChain(input, { cdpEndpoint });
  if (jsonMode) {
    const output = {
      success: chainResult.success,
      steps: chainResult.steps.map(s => ({
        command: s.raw,
        success: s.success,
        data: s.data,
        duration: s.duration,
        ...(s.hookOutputs?.length ? { hooks: s.hookOutputs } : {}),
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    printChainResult(chainResult);
  }
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
  const command = positional[0];
  const cmdArgs = positional.slice(1);

  // Built-in commands (search, etc.) may have their own options.
  // Typo detection is handled at the command level.
  const mode = options.json ? 'json' : options.yaml ? 'yaml' : 'text';
  const sessionName = (options.session as string) || process.env.XBROWSER_SESSION || 'default';
  const cdpEndpoint = options.cdp as string | undefined;

  if (options.version || options.v) {
    console.log(`xbrowser v${version}`);
    return;
  }
  if (positional.length === 0) {
    showMainHelp();
    return;
  }

  if ((options.help || options.h) && positional.length > 0) {
    const loader = await getPluginLoader();
    const internalLoader = loader.getCore().loader;
    const site = internalLoader.getSite(command);
    if (site) {
      // If user specified a specific command (e.g., "xbrowser zhihu chat --help"), show command-level help
      const specificCmd = positional[1];
      if (specificCmd) {
        const cmdEntry = site.getCommand(specificCmd);
        if (cmdEntry) {
          showCommandHelp(command, cmdEntry, { description: site.config.description, name: site.name, url: site.url }, mode);
          return;
        }
        // Command not found — fall through to site-level help
      }

      // Site-level help (list all commands)
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
    // Not a plugin site — check if it's a built-in browser command
    const builtinCmd = getCommand(command);
    if (builtinCmd) {
      if (mode === 'json') {
        const paramsList: Array<{ name: string; type: string; required: boolean; description: string }> = [];
        const schema = builtinCmd.parameters as unknown as { _def?: { shape?: Record<string, unknown> }; shape?: Record<string, unknown> } | undefined;
        const shape = schema?.shape ?? (schema?._def as Record<string, unknown>)?.shape as Record<string, unknown> | undefined;
        if (shape) {
          for (const [key, value] of Object.entries(shape)) {
            const fieldSchema = value as unknown as Record<string, unknown>;
            const fieldDef = fieldSchema._def as Record<string, unknown> | undefined;
            const description = (fieldSchema.description as string) || (fieldDef?.description as string) || '';
            const typeName = (fieldDef?.typeName as string) || '';
            const isOptional = typeName === 'ZodOptional' || (typeof fieldSchema.isOptional === 'function' && (fieldSchema.isOptional as () => boolean)());
            const innerType = fieldDef?.innerType as unknown as Record<string, unknown> | undefined;
            const innerTypeName = innerType?._def ? (innerType._def as Record<string, unknown>).typeName as string : typeName;
            let type = 'unknown';
            if (innerTypeName === 'ZodString' || typeName === 'ZodString') type = 'string';
            else if (innerTypeName === 'ZodNumber' || typeName === 'ZodNumber') type = 'number';
            else if (innerTypeName === 'ZodBoolean' || typeName === 'ZodBoolean') type = 'boolean';
            else if (innerTypeName === 'ZodEnum' || typeName === 'ZodEnum') {
              const vals = (fieldDef?.values || (innerType?._def as Record<string, unknown>)?.values) as string[] | undefined;
              type = vals ? vals.join('|') : 'enum';
            }
            paramsList.push({ name: key, type, required: !isOptional, description });
          }
        }
        outputResult({ command: builtinCmd.name, description: builtinCmd.description, scope: builtinCmd.scope, parameters: paramsList }, mode);
      } else {
        console.log(helpGenerator.generate(builtinCmd as unknown as Parameters<typeof helpGenerator.generate>[0], { color: true, emoji: false }));
      }
      return;
    }
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
      case 'kill': {
        await handleSession(['kill-all'], options, mode);
        break;
      }
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
      case 'viewer':
        await handleViewer(cmdArgs, options, mode, cdpEndpoint);
        break;
      case 'help':
        showMainHelp();
        break;
      case 'net':
        await handleNetCommand(cmdArgs, options, mode, sessionName);
        break;
      default: {
        // Check plugin site BEFORE chain parsing to avoid --content with +/, being misinterpreted
        const loader = await getPluginLoader();
        const internalLoader = loader.getCore().loader;
        const site = internalLoader.getSite(command);

        // Only fall through to chain parsing if NOT a registered plugin site
        if (!site) {
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
        }
        if (site) {
          const allSiteCommands = site.getAllCommands();
          const subCommand = cmdArgs[0];
          if (!subCommand || subCommand === '--help' || subCommand === '-h') {
            if (allSiteCommands.length === 1 && subCommand && (subCommand === '--help' || subCommand === '-h')) {
              const cmdEntry = site.getCommand(allSiteCommands[0].name);
              if (cmdEntry) {
                showCommandHelp(command, cmdEntry, { description: site.config.description, name: site.name, url: site.url }, mode);
                return;
              }
            }
            const commands = allSiteCommands;
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

          let cmdEntry = site.getCommand(subCommand);
          let cmdArgsForPlugin = cmdArgs.slice(1);
          if (!cmdEntry) {
            if (allSiteCommands.length === 1) {
              cmdEntry = site.getCommand(allSiteCommands[0].name);
              cmdArgsForPlugin = cmdArgs;
            }
            if (!cmdEntry) {
              outputError(
                `Unknown command "${subCommand}" for site "${command}".\n` +
                `Run "xbrowser ${command} --help" to see available commands.`
              );
              return;
            }
          }

          if (cmdArgsForPlugin.includes('--help') || cmdArgsForPlugin.includes('-h')) {
            showCommandHelp(command, cmdEntry, { description: site.config.description, name: site.name, url: site.url }, mode);
            return;
          }
          // Re-extract plugin args from original argv because global parseArgs
          // consumes all --flags and leaves cmdArgsForPlugin empty.
          // Find the index after 'pluginName subCommand' in argv.
          const pluginNameIdx = argv.indexOf(command);
          const subCmdIdx = pluginNameIdx >= 0 ? argv.indexOf(subCommand, pluginNameIdx + 1) : -1;
          const rawPluginArgs = subCmdIdx >= 0 ? argv.slice(subCmdIdx + 1) : [];
          const params = parsePluginParams(rawPluginArgs, cmdEntry.parameters!);

          // Validate plugin params against Zod schema — reject unknown flags
          if (cmdEntry.parameters) {
            const schemaAny = cmdEntry.parameters as unknown as Record<string, unknown>;
            const def = schemaAny._def as Record<string, unknown> | undefined;
            // ZodObject stores shape as a function (getter) in _def.shape
            const shapeOrFn = def?.shape ?? (schemaAny as Record<string, unknown>).shape;
            const shapeObj = typeof shapeOrFn === 'function' ? shapeOrFn() as Record<string, unknown> : shapeOrFn as Record<string, unknown> | undefined;
            if (shapeObj && typeof shapeObj === 'object') {
              const knownKeys = new Set(Object.keys(shapeObj));
              knownKeys.add('_target');
              // Also exclude global CLI options that parseArgs may have mixed in
              for (const gk of KNOWN_GLOBAL_OPTIONS) knownKeys.add(gk.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
              const unknownKeys = Object.keys(params).filter(k => !knownKeys.has(k));
              if (unknownKeys.length > 0) {
                const unknown = unknownKeys.map(k => `--${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`).join(', ');
                outputError(
                  `Unknown parameter: ${unknown}\n` +
                  `Run "xbrowser ${command} ${subCommand} --help" to see available parameters.`
                );
                return;
              }
            }
          }

          if (options.target && !params._target) {
            params._target = options.target;
          }

          const needsBrowser = cmdEntry.scope === 'page' || cmdEntry.scope === 'browser';
          if (needsBrowser && !process.env.XBROWSER_DAEMON_WORKER) {
            const { forwardExec } = await import('./client/daemon-client.js');
            const userTimeout = typeof params.timeout === 'number' && params.timeout > 0 ? params.timeout * 1000 + 30000 : undefined;
            const result = await forwardExec(`${command}.${subCommand}`, params, sessionName, cdpEndpoint, userTimeout);
            if (result && result.success !== false) {
              if (isCommandResult(result)) {
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
              }
              return;
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let session: any = undefined;
          if (needsBrowser) {
            session = await findOrRestoreSession(sessionName, cdpEndpoint);
            if (!session) {
              session = await createSession(sessionName, undefined, cdpEndpoint ? { cdpEndpoint } : {});
            }
          }

          const ctx = {
            args: cmdArgsForPlugin,
            options,
            cwd: process.cwd(),
            page: needsBrowser ? session!.page : null,
            browser: needsBrowser ? session!.context.browser()! : null,
            browserContext: needsBrowser ? session!.context : null,
            sessionId: needsBrowser ? session!.id : '',
            cdpEndpoint: cdpEndpoint || (needsBrowser ? (session as Record<string, unknown>)?.cdpEndpoint as string : undefined),
            storage: getPluginStorage(command),
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
            const cmdStart = Date.now()
            const cmdHooks = await loadHooks();
            if (cmdHooks.length > 0 && session?.page) {
              await Promise.all(cmdHooks.map(h => h.onBeforeCommand?.({ page: session.page!, command: `${command} ${subCommand}`, params })));
            }

            const result = await cmdEntry.handler(params, ctx) as CommandResult;

            const hookOutputs: Array<Record<string, unknown>> = [];
            if (cmdHooks.length > 0 && session?.page) {
              for (const h of cmdHooks) {
                const output = await h.onAfterCommand?.({ page: session.page!, command: `${command} ${subCommand}`, params, result, duration: Date.now() - cmdStart });
                if (output) hookOutputs.push({ _hook: h.name, ...output });
              }
            }
            // Auto-save conversationUrl to session file for cross-process recovery
            if (session && result && result.data) {
              const convUrl = (result.data as Record<string, unknown>).conversationUrl as string | undefined;
              if (convUrl) {
                saveSessionDiskMeta(sessionName, { conversationUrl: convUrl, cdpEndpoint });
              }
            }
            const outputData = isCommandResult(result) ? result.data : (result && typeof result === 'object' ? ((result as Record<string, unknown>).data ?? result) : result);
            const tips = isCommandResult(result) ? result.tips : ((result && typeof result === 'object') ? (result as Record<string, unknown>).tips as string[] | undefined : undefined);

            if (mode === 'json' || mode === 'yaml') {
              const finalOutput: Record<string, unknown> = {
                data: outputData,
              };
              if (hookOutputs.length > 0) {
                finalOutput.hooks = hookOutputs;
              }
              console.log(outputFormatter.format(finalOutput, { mode: mode as 'json' | 'yaml', color: false, emoji: false }));
              if (tips?.length) {
                for (const tip of tips) console.error(`\u{1F4A1} ${tip}`);
              }
            } else {
              console.log(outputFormatter.format(outputData, { mode: 'text', color: true, emoji: true }));
              if (tips?.length) {
                for (const tip of tips) console.log(`  \u{1F4A1} ${tip}`);
              }
              if (hookOutputs.length > 0) {
                for (const ho of hookOutputs) {
                  console.log(`  📸 screenshot: ${(ho.screenshot as Record<string, unknown>)?.url || 'captured'}`);
                }
              }
            }
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e));
          } finally {
            // Session lifecycle is managed by:
            //   1. process.on('exit') — cleanup on process exit
            //   2. "session close/kill" — explicit destruction by user
            // Do NOT destroy here — plugin commands are just command executors, not lifecycle managers.
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
          if (data.data) outputResult(data.data, mode);
        } else {
          outputError(data.message || 'Command failed');
        }
      }
    } catch (e) {
      outputError(`Remote execution failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
