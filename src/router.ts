import { parseArgs, outputFormatter, isCommandResult, type CommandResult, helpGenerator, TipCollector, normalizeTips, tip as makeTip } from '@dyyz1993/xcli-core';
import { parsePluginParams } from './utils/plugin-params.js';
import { asZodSchema } from './utils/zod-internal.js';
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
  'tab',
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
  handleTest,
} from './cli/index.js';
import { outputEnvelope, outputError, outputResult } from './cli/output.js';
import { showMainHelp } from './cli/help.js';
import { printChainResult } from './cli/chain-output.js';
import { getPluginLoader } from './utils/plugin-singleton.js';
import { checkPluginLoginRequired } from './plugin/login-guard.js';
import { findOrRestoreSession, createSession, saveSessionDiskMeta, type ManagedSession } from './browser.js';
import { HTTPServer } from './server/http-server.js';
import { getCommand } from './commands/command-registry.js';
import { buildViewerUrl } from './utils/viewer-url.js';
import { attachDetectAntiBot } from './context.js';

function showCommandHelp(siteName: string, cmd: unknown, siteConfig: { description?: string; name: string; url: string }, mode: string): void {
  const c = cmd as { name: string; description: string; scope: string; parameters?: unknown; examples?: Array<{ cmd: string; description: string }>; loginRequired?: 'required' | 'optional' | 'none' };

  if (mode === 'json') {
    const paramsList: Array<{ name: string; type: string; required: boolean; default_: unknown; description: string; enumValues?: string[] }> = [];
    if (c.parameters) {
      const def = asZodSchema(c.parameters)._def;
      const rawShape = def?.shape;
      const shape = typeof rawShape === 'function' ? (rawShape as () => Record<string, unknown>)() : (rawShape as Record<string, unknown> | undefined);
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
      ...(c.loginRequired ? { loginRequired: c.loginRequired } : {}),
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
    if (c.loginRequired) {
      console.log(`  Login: ${c.loginRequired}`);
    }
    console.log('');
  }
}

function outputLoginRequired(result: { message?: string; tips?: import('@dyyz1993/xcli-core').Tip[] }, mode: string): void {
  if (mode === 'json' || mode === 'yaml') {
    console.log(outputFormatter.format(result, { mode: mode as 'json' | 'yaml', color: false, emoji: false }));
    return;
  }

  const message = result.message || 'Login required';
  console.error(message);
  for (const tip of result.tips || []) {
    const text = typeof tip === 'string' ? tip : tip.message;
    if (text !== message) console.error(`  \u{1F4A1} ${text}`);
  }
  process.exit(1);
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
  return process.env.XBROWSER_CDP;
}

async function handleStdinMode(stdinCommands: string[], argv?: string[]): Promise<void> {
  // Use ';' (sequence) instead of '&&' so each line runs independently.
  // With '&&', a failure on line 1 (e.g. title on about:blank) would stop
  // all subsequent lines, which is not what users expect from stdin piping.
  const chain = stdinCommands.join(' ; ');
  const cdpEndpoint = argv ? extractCdpFromArgv(argv) : undefined;
  const sessionName = argv ? extractSessionNameFromArgv(argv) : 'default';
  const chainResult = await executeChain(chain, { fileMode: true, cdpEndpoint, sessionName });
  printChainResult(chainResult);
  if (!chainResult.success) throw new Error("Command failed");
}

function extractSessionNameFromArgv(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session' && argv[i + 1]) return argv[i + 1];
    if (typeof argv[i] === 'string' && argv[i].startsWith('--session=')) return argv[i].slice(10);
  }
  return process.env.XBROWSER_SESSION || 'default';
}

async function handleEvalMode(argv: string[]): Promise<void> {
  const evalCommands = parseEvalFlags(argv);
  if (evalCommands.length === 0) return;
  // Encode each script as base64url so chain parsing (which splits on ';',
  // whitespace and newlines) cannot break JS containing semicolons or
  // multiline statements. The eval command decodes scriptB64.
  const chain = evalCommands
    .map((script) => `eval --script-b64 ${Buffer.from(script, 'utf8').toString('base64url')}`)
    .join(' ; ');
  const cdpEndpoint = extractCdpFromArgv(argv);
  // Extract --session from argv for eval mode (not handled by parseArgs)
  const sessionArgIdx = argv.indexOf('--session');
  const sessionName = sessionArgIdx >= 0 && argv[sessionArgIdx + 1]
    ? argv[sessionArgIdx + 1]
    : process.env.XBROWSER_SESSION || 'default';
  const chainResult = await executeChain(chain, { cdpEndpoint, sessionName });
  printChainResult(chainResult);
  if (!chainResult.success) throw new Error("Command failed");
}

/**
 * `xbrowser eval <js...>` — everything after the `eval` word is ONE script.
 * Shell quotes are consumed before argv reaches us, so the script's own
 * newlines/semicolons are indistinguishable from chain separators at parse
 * time (field-verified: any eval containing `;` or newlines was split into
 * fake commands). Pass the script base64url-encoded via --script-b64, which
 * chain parsing cannot break, and let the eval command decode it.
 */
function findEvalStart(argv: string[]): number {
  const flagsWithValue = new Set(['--session', '--cdp']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-e' || a === '--eval') return -1; // -e mode owns this input
    if (a.startsWith('--')) {
      if (flagsWithValue.has(a)) { i++; continue; } // skip flag + value
      continue; // valueless global flag (--json/--yaml)
    }
    return a === 'eval' ? i : -1; // first positional token must be `eval`
  }
  return -1;
}

async function handleEvalScript(parts: string[], argv: string[]): Promise<void> {
  const cdpEndpoint = extractCdpFromArgv(argv);
  const sessionName = extractSessionNameFromArgv(argv);
  // Programmatic callers may use the b64 channel directly — pass through
  // verbatim (no re-encoding, which would double-encode the script).
  if (parts[0] === '--script-b64' && parts[1]) {
    const chainResult = await executeChain(`eval --script-b64 ${parts[1]}`, { cdpEndpoint, sessionName });
    printChainResult(chainResult);
    if (!chainResult.success) throw new Error("Command failed");
    return;
  }

  // Pull --frame <value> out of the parts; everything else is script lines.
  let frame: string | undefined;
  const scriptLines: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '--frame' && parts[i + 1]) { frame = parts[i + 1]; i++; continue; }
    if (part === '--session' || part === '--cdp') { i++; continue; } // global flags, already extracted
    scriptLines.push(part);
  }
  const script = scriptLines.join('\n');
  if (!script.trim()) {
    console.error('Error: eval requires a script (usage: xbrowser eval <js...>)');
    throw new Error("Command failed");
  }
  const b64 = Buffer.from(script, 'utf8').toString('base64url');
  const chain = frame
    ? `eval --frame ${frame} --script-b64 ${b64}`
    : `eval --script-b64 ${b64}`;
  const chainResult = await executeChain(chain, { cdpEndpoint, sessionName });
  printChainResult(chainResult);
  if (!chainResult.success) throw new Error("Command failed");
}

async function handleChainInput(input: string, argv?: string[]): Promise<void> {
  const cdpEndpoint = argv ? extractCdpFromArgv(argv) : undefined;
  // Detect --json/--yaml from argv
  const hasJson = argv ? argv.some(a => a === '--json' || a.startsWith('--json=') || a.includes(' --json') || a.startsWith('--json')) || argv.includes('-j') : false;
  const hasYaml = argv ? argv.some(a => a === '--yaml' || a.startsWith('--yaml=')) : false;
  const mode = hasJson ? 'json' : hasYaml ? 'yaml' : 'text';
  const chainResult = await executeChain(input, { cdpEndpoint });
  if (mode === 'json' || mode === 'yaml') {
    outputEnvelope(
      {
        success: chainResult.success,
        data: {
          steps: chainResult.steps.map(s => ({
            command: s.raw,
            success: s.success,
            data: s.data,
            duration: s.duration,
            ...(s.hookOutputs?.length ? { hooks: s.hookOutputs } : {}),
          })),
        },
        duration: chainResult.totalDuration,
      },
      { command: 'chain', totalSteps: chainResult.steps.length },
      mode,
    );
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
  argvIn: string[],
  stdinCommands?: string[]
): Promise<void> {
  let argv = argvIn;
  // exitCode is set via process.exitCode so that cli.ts can read it after
  // routeCommand returns, without having to thread a return value through
  // every early-exit path. process.exitCode does NOT kill the process — it
  // only tells the runtime what code to use when the event loop drains.
  // cli.ts's finally block reads this and passes it to process.exit() after
  // running its own cleanup.
  process.exitCode = 0;
  try {
    if (stdinCommands && stdinCommands.length > 0) {
      await handleStdinMode(stdinCommands, argv);
      return;
    }

    // `xbrowser [flags] eval <js...>` must be intercepted before chain
    // parsing — see handleEvalScript. Runs after the -e branch so
    // `xbrowser -e` still wins when both forms are mixed.
    const evalStart = findEvalStart(argv);
    if (evalStart >= 0 && argv.length > evalStart + 1) {
      await handleEvalScript(argv.slice(evalStart + 1), argv);
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

    // Handle --json/--yaml before chain: parseArgs absorbs the chain string
    // as json's value. Detect this and re-route to handleChainInput.
    // But only for chain inputs (contain && || ; , + ->) — single commands
    // need argv splitting (handled later by the quoted arg block).
    const jsonBeforeChain = (argv[0] === '--json' || argv[0] === '--yaml') && argv[1] && isChainInput(argv[1]);
    if (jsonBeforeChain) {
      await handleChainInput(argv[1], argv);
      return;
    }

    // Handle --json/--yaml before single quoted command (e.g. --json "goto url")
    // Strip --json/--yaml early so it doesn't confuse argv splitting below.
    if (argv[0] === '--json' || argv[0] === '--yaml') {
      argv = argv.slice(1); // Remove --json/--yaml from front
    }

    // Handle --session/--cdp before chain (similar flag absorption)

    // Find the first quoted argument (contains space, starts with letter)
    // Skip global flags (--session, --cdp, --json, etc.) and their values
    // Defense (2026-08-15 real-sites smoke): the command-string heuristic must only
    // apply to the FIRST non-flag argument (xbrowser "goto url" style). A
    // space-containing arg that comes AFTER a command word (fill "#kw" "a b c")
    // is a VALUE — re-splitting it truncated fill values to the first word.
    const globalFlags = new Set(['--session', '--cdp', '--json', '--yaml', '--output', '--timeout', '--help', '-h', '--version']);
    let chainArgIdx = -1;
    let seenCommandWord = false;
    for (let i = 0; i < argv.length; i++) {
      if (globalFlags.has(argv[i])) continue; // skip flag
      if (globalFlags.has(argv[i]) || (i > 0 && globalFlags.has(argv[i-1]) && !argv[i].startsWith('-'))) continue; // skip flag value
      if (!seenCommandWord) {
        if (argv[i].includes(' ') && /^[a-zA-Z]/.test(argv[i])) {
          chainArgIdx = i;
          break;
        }
        seenCommandWord = true;
      }
    }

	    if (chainArgIdx >= 0) {
	      const chainArg = argv[chainArgIdx];
	      const spaceIdx = chainArg.indexOf(' ');
	      const possibleCmd = chainArg.substring(0, spaceIdx);
	      if (/^[a-zA-Z][\w-]*$/.test(possibleCmd)) {
	        const remainder = chainArg.substring(spaceIdx + 1);
	        let remainderParts = remainder.split(/\s+/).filter(Boolean);
	        // Also split on ; (chain separator) for cases like "goto url;title"
	        // where there's no space before the semicolon.
	        remainderParts = remainderParts.flatMap(part => part.split(';').filter(Boolean));
	        // Replace the chain arg with split parts, keep everything else
	        argv = [...argv.slice(0, chainArgIdx), possibleCmd, ...remainderParts, ...argv.slice(chainArgIdx + 1)];
	      }
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
    return;
  }

  // Detect --json/--yaml anywhere in argv
  const hasJsonFlag = argv.some(a => a === '--json' || a.startsWith('--json='));
  const hasYamlFlag = argv.some(a => a === '--yaml' || a.startsWith('--yaml='));

  // Use xcli-core 0.18.0 booleanFlags to prevent --json/--yaml from
  // absorbing the next positional arg as its value.
  const cleanArgv = argv.filter(a => a !== '--json' && a !== '--yaml');

  const parsed = parseArgs(cleanArgv, { booleanFlags: ['json', 'yaml'] });
  const { positional, options } = parsed;
  if (hasJsonFlag) options.json = true;
  if (hasYamlFlag) options.yaml = true;
  const command = positional[0];
  const cmdArgs = positional.slice(1);

  // Built-in commands (search, etc.) may have their own options.
  // Typo detection is handled at the command level.
  const mode = (options.json || hasJsonFlag) ? 'json' : (options.yaml || hasYamlFlag) ? 'yaml' : 'text';
  const sessionName = (options.session as string) || process.env.XBROWSER_SESSION || 'default';
  const cdpEndpoint = (options.cdp as string) || process.env.XBROWSER_CDP;

  if (options.version || (options.v && positional.length === 0)) {
    if (mode === 'json') {
      outputEnvelope(
        { success: true, data: { version, name: '@xbrowser/cli' } },
        { command: 'version' },
        mode,
      );
    } else {
      console.log(`xbrowser v${version}`);
    }
    return;
  }
  if (positional.length === 0) {
	    // --json before a chain string gets absorbed by parseArgs as json's value
	    // (parseArgs treats --json as a string flag, not boolean).
	    // Detect this: if we have json/yaml values that look like commands,
	    // treat them as positional args instead of flag values.
	    const chainHints = [options.json, options.yaml, options.session, options.cdp]
	      .filter(Boolean)
	      .find(v => typeof v === 'string' && /^[a-zA-Z]/.test(v as string));
	    if (chainHints) {
	      positional.push(chainHints as string);
	    } else {
	      showMainHelp();
	      return;
	    }
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
        const schema = asZodSchema(builtinCmd.parameters);
        const shape = schema?.shape ?? (schema?._def as Record<string, unknown>)?.shape as Record<string, unknown> | undefined;
        if (shape) {
          for (const [key, value] of Object.entries(shape)) {
            const fieldSchema = asZodSchema(value);
            const fieldDef = fieldSchema._def as Record<string, unknown> | undefined;
            const description = (fieldSchema.description as string) || (fieldDef?.description as string) || '';
            const typeName = (fieldDef?.typeName as string) || '';
            const isOptional = typeName === 'ZodOptional' || (typeof (fieldSchema as Record<string, unknown>).isOptional === 'function' && ((fieldSchema as Record<string, unknown>).isOptional as () => boolean)());
            const innerType = asZodSchema(fieldDef?.innerType);
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
        console.log(helpGenerator.generate(builtinCmd as Parameters<typeof helpGenerator.generate>[0], { color: true, emoji: false }));
      }
      return;
    }
    // Check for subcommand help (session, plugin, record, daemon, etc.)
    const SUBCOMMAND_HELP: Record<string, string> = {
      session: 'session open|close|kill|list [--session <name>] [--cdp <endpoint>]',
      plugin: 'plugin install|uninstall|list|reload|schema|search|info <name>',
      record: 'record start|stop|status [--url <url>] [--name <flow>]',
      daemon: 'daemon status [--port <port>]',
      replay: 'replay <file> [--slow-mo <ms>] [--stop-on-error]',
      create: 'create <name> [--template static|dynamic|login|api]',
      run: 'run <file>',
      serve: 'serve [--port <port>] [--token <token>]',
      remote: 'remote <url> [command] [--token <token>]',
      convert: 'convert <file> [--to js|py|sh]',
      extract: 'extract <file> [--format json|yaml]',
      filter: 'filter <file> [--include <type>] [--exclude <type>]',
      test: 'test <name> [--cdp <endpoint>]',
      viewer: 'viewer [--session <name>]',
      kill: 'kill [--all]',
      net: 'net [--cdp <endpoint>]',
    };
    const subHelp = SUBCOMMAND_HELP[command];
    if (subHelp) {
      console.log(`\n  Usage: xbrowser ${subHelp}\n`);
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
        await handleConvert(cmdArgs, mode);
        break;
      case 'extract':
        await handleExtract(cmdArgs, mode);
        break;
      case 'filter':
        await handleFilter(cmdArgs, mode, options);
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
      case 'knowledge':
      case 'know': {
        const builtin = allBuiltins.find((b) => b.name === 'knowledge');
        if (builtin) await builtin.execute(cmdArgs, options, { cwd: process.cwd() });
        break;
      }
      case 'viewer':
        await handleViewer(cmdArgs, options, mode, cdpEndpoint);
        break;
      case 'help':
        showMainHelp();
        break;
      case 'test':
        await handleTest(cmdArgs, options, mode, cdpEndpoint);
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
          // Build chain input from non-global-flag args only
          const globalFlagSet = new Set(['--session', '--cdp', '--json', '--yaml', '--help', '-h', '--version', '--output', '-o']);
          const cleanParts: string[] = [];
          for (let i = 0; i < argv.length; i++) {
            if (globalFlagSet.has(argv[i])) continue;
            // Skip the value of --session/--cdp/--output
            if (i > 0 && globalFlagSet.has(argv[i-1]) && !argv[i].startsWith('-')) continue;
            if (argv[i].startsWith('--session=') || argv[i].startsWith('--cdp=')) continue;
            cleanParts.push(argv[i]);
          }
          const fullInput = cleanParts.join(' ');
          if (isChainInput(fullInput)) {
            const chainResult = await executeChain(fullInput, { cdpEndpoint, sessionName });
            // Output as JSON if --json flag was set globally
            if (mode === 'json' || mode === 'yaml') {
              outputEnvelope(
                {
                  success: chainResult.success,
                  data: {
                    steps: chainResult.steps.map(s => ({
                      command: s.raw,
                      success: s.success,
                      data: s.data,
                      duration: s.duration,
                    })),
                    ...(chainResult.stoppedReason ? { stoppedReason: chainResult.stoppedReason } : {}),
                  },
                  duration: chainResult.totalDuration,
                },
                { command: 'chain', totalSteps: chainResult.steps.length },
                mode,
              );
              if (!chainResult.success) throw new Error('Command failed');
              return;
            }
            for (const step of chainResult.steps) {
              if (step.success) {
                console.log(`[OK] ${step.raw}`);
                // Print data fields (same format as printChainResult)
                if (step.data && typeof step.data === 'object') {
                  const d = step.data as Record<string, unknown>;
                  for (const [k, v] of Object.entries(d)) {
                    if (k !== 'ok' && k !== 'success')
                      console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
                  }
                }
                if (step.tips?.length) {
                  for (const tip of step.tips) {
                    const text = typeof tip === 'string' ? tip : (tip as { message?: string }).message;
                    if (text) console.log(`  💡 ${text}`);
                  }
                }
              } else {
                console.error(`[FAIL] ${step.raw}: ${step.message}`);
              }
            }
            if (chainResult.stoppedReason) {
              console.error(`Stopped: ${chainResult.stoppedReason}`);
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
            const schemaAny = asZodSchema(cmdEntry.parameters);
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
            const { forwardPluginExec } = await import('./client/daemon-client.js');
            const userTimeout = typeof params.timeout === 'number' && params.timeout > 0 ? params.timeout * 1000 + 30000 : undefined;
            const result = await forwardPluginExec(`${command}.${subCommand}`, params, sessionName, cdpEndpoint, userTimeout);
            const resultData = result && typeof result === 'object' && 'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
            if (result && result.success === false && resultData?.code === 'LOGIN_REQUIRED') {
              process.exitCode = 1;
              outputLoginRequired(result, mode);
              return;
            }
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

          let session: ManagedSession | undefined = undefined;
          if (needsBrowser) {
            session = await findOrRestoreSession(sessionName, cdpEndpoint);
            if (!session) {
              session = await createSession(sessionName, undefined, cdpEndpoint ? { cdpEndpoint } : {});
            }
          }

          // --tab <index>: switch to the specified tab for plugin commands
          const cmdTabIndex = options.tab !== undefined ? Number(options.tab) : undefined;
          if (cmdTabIndex !== undefined && session?.context) {
            const pages = session.context.pages();
            if (cmdTabIndex >= 0 && cmdTabIndex < pages.length) {
              const targetPage = pages[cmdTabIndex];
              await targetPage.bringToFront().catch(() => {});
              const { setActivePage } = await import('./browser.js');
              setActivePage(session, targetPage);
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
            cdpEndpoint: cdpEndpoint || (needsBrowser ? session?.cdpEndpoint : undefined),
            storage: getPluginStorage(command),
            output: { mode: mode as 'text' | 'json' | 'yaml', showTips: true, color: true, emoji: true },
            error: (msg: string) => { outputError(msg); },
            config: {},
            site,
            cliName: 'xbrowser',
            waitForHuman: async (_opts: Record<string, unknown>) => {
              return { solved: false, timedOut: true };
            },
            tips: new TipCollector(),
          };

          // Inject anti-bot detection capability (ctx.detectAntiBot) for plugins.
          // Plugins call ctx.detectAntiBot(page) instead of importing src/ directly
          // (which would break under global/npm installs).
          attachDetectAntiBot(ctx);

          try {
            const cmdStart = Date.now()
            const loginGuard = await checkPluginLoginRequired({
              site,
              command: cmdEntry,
              commandName: subCommand,
              ctx,
              page: needsBrowser ? session?.page : null,
              sessionName,
            });
            if (!loginGuard.ok) {
              process.exitCode = 1;
              const result = {
                success: false,
                data: loginGuard.data ?? null,
                message: loginGuard.message,
                tips: normalizeTips(loginGuard.tips),
              };
              if (mode === 'json' || mode === 'yaml') {
                outputLoginRequired(result, mode);
              } else {
                outputLoginRequired(result, mode);
              }
              return;
            }

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
            // Inject viewerUrl for login-related failures (custom fail() calls that bypass login-guard)
            let injectedViewerUrl: string | undefined;
            const LOGIN_FAIL_KEYWORDS = ['登录','login','Login','未登录','not logged in','cdp','CDP','验证码','验证','captcha','需要登录','requires login'];
            const tipTexts = (result.tips || []).map((t) => typeof t === 'string' ? t : t.message);
            const isLoginFail = isCommandResult(result) && result.success === false &&
              [result.message, ...tipTexts].filter(Boolean).join(' ').toLowerCase()
                .match(new RegExp(LOGIN_FAIL_KEYWORDS.join('|'), 'i'));
            if (isLoginFail) {
              injectedViewerUrl = buildViewerUrl(sessionName);
              if (injectedViewerUrl) {
                result.tips = [...(result.tips || []), makeTip.info(`Open viewer to complete login: ${injectedViewerUrl}`)];
              }
            }

            const outputData = isCommandResult(result) ? result.data : (result && typeof result === 'object' ? ((result as Record<string, unknown>).data ?? result) : result);
            const tips = isCommandResult(result) ? result.tips : ((result && typeof result === 'object') ? (result as Record<string, unknown>).tips as import('@dyyz1993/xcli-core').Tip[] | undefined : undefined);
            const resultSuccess = isCommandResult(result) ? result.success !== false : true;
            if (!resultSuccess) process.exitCode = 1;

            if (mode === 'json' || mode === 'yaml') {
              const resultMsg = isCommandResult(result) ? result.message : undefined;
              const duration = Date.now() - cmdStart;
              const envelopeMeta: Record<string, unknown> = { command: `${command} ${subCommand}` };
              if (injectedViewerUrl) envelopeMeta.viewerUrl = injectedViewerUrl;
              if (hookOutputs.length > 0) envelopeMeta.hooks = hookOutputs;
              outputEnvelope(
                { success: resultSuccess, data: outputData, message: resultMsg, tips, duration },
                envelopeMeta as { command: string; [key: string]: unknown },
                mode,
              );
            } else {
              console.log(outputFormatter.format(outputData, { mode: 'text', color: true, emoji: true }));
              if (tips?.length) {
                for (const tip of tips) console.log(`  \u{1F4A1} ${typeof tip === 'string' ? tip : tip.message}`);
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
      console.log(`  Auth: ${output.authRequired ? 'Enabled (Bearer token, except /health)' : 'Disabled (dev mode)'}\n`);
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
