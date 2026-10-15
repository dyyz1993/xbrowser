import { parseArgs } from '@dyyz1993/xcli-core';
import { isChainInput } from './executor.js';
import { version } from './version.js';

import { handleBrowserCommand } from './cli/index.js';
import { outputEnvelope, outputError } from './cli/output.js';
import { showMainHelp } from './cli/help.js';
import {
  findEvalStart,
  handleChainInput,
  handleEvalMode,
  handleEvalScript,
  handleStdinMode,
  parseEvalFlags,
} from './router/input-modes.js';
import { handleCommandHelp } from './router/help-routing.js';
import { dispatchSubcommand } from './router/subcommands.js';
import { handlePluginOrChainRoute } from './router/plugin-routing.js';

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
  // Inclusive token range of the quoted chain string after argv rewriting.
  // The default branch's chain reassembly strips global flags from argv, but
  // tokens INSIDE this region belong to the chain itself and must survive —
  // otherwise `screenshot --output P` inside a chain loses both the flag and
  // its value (2026-09-12-08: screenshots silently rerouted to the temp dir).
  let chainTokenStart = -1;
  let chainTokenEnd = -1;
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
	        chainTokenStart = chainArgIdx;
	        chainTokenEnd = chainArgIdx + remainderParts.length; // possibleCmd + remainder tokens
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
    await handleCommandHelp(command, positional, mode);
    return;
  }

  try {
    const dispatched = await dispatchSubcommand({
      command,
      cmdArgs,
      options,
      mode,
      cdpEndpoint,
      sessionName,
    });
    if (dispatched) return;

    const handled = await handlePluginOrChainRoute({
      command,
      cmdArgs,
      argv,
      options,
      mode,
      cdpEndpoint,
      sessionName,
      chainTokenStart,
      chainTokenEnd,
    });
    if (handled) return;


        await handleBrowserCommand(command, cmdArgs, options, sessionName, mode, cdpEndpoint);

  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}