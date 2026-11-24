import { parseArgs, splitCommand, unquote } from '@dyyz1993/xcli-core';
import { isChainInput } from './executor.js';
import { splitOutsideQuotes } from './chain-parser.js';
import { getCommandNames } from './commands/command-registry.js';
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
import { GLOBAL_VALUE_FLAGS, handlePluginOrChainRoute } from './router/plugin-routing.js';

/** 该段文本（`;` 之后的一截）是否以已注册的内置命令开头 */
function startsWithCommand(part: string): boolean {
  const first = part.trim().split(/\s+/)[0] ?? '';
  return getCommandNames().includes(first);
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
  // Inclusive token range of the quoted chain string after argv rewriting.
  // The default branch's chain reassembly strips global flags from argv, but
  // tokens INSIDE this region belong to the chain itself and must survive —
  // otherwise `screenshot --output P` inside a chain loses both the flag and
  // its value (2026-09-12-08: screenshots silently rerouted to the temp dir).
  let chainTokenStart = -1;
  let chainTokenEnd = -1;
  // 链区重写前的原始带引号命令串。链区 token 是 unquote 过的裸词；当它后面还
  // 跟着独立操作符 token 时（`xbrowser "fill '#q' 'a b'" '&&' title`），只有把
  // 原始串拼回链字符串才能保住值里的空格与分隔符。
  let chainRaw: string | undefined;
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
    const evalParts = evalStart >= 0 ? argv.slice(evalStart + 1) : [];
    // `eval --help` / `eval -h` asks for the eval command's help, not for a
    // script literally named "--help" (it was evaluated as JS → ReferenceError,
    // plus archive/ledger side effects). Exact tokens only: a script that
    // merely contains the word "help" still runs as a script. Help is then
    // handled by the regular `options.help` branch below.
    const evalHelpRequested = evalParts.includes('--help') || evalParts.includes('-h');
    if (evalStart >= 0 && evalParts.length > 0 && !evalHelpRequested) {
      await handleEvalScript(evalParts, argv);
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
    const globalFlags = new Set([...GLOBAL_VALUE_FLAGS, '--json', '--yaml', '--help', '-h', '--version', '--bridge']);
    // Only GLOBAL_VALUE_FLAGS take a value: the token right after a boolean flag (--json,
    // --help, …) is the next argument (e.g. the quoted chain), not a flag value.
    let chainArgIdx = -1;
    let seenCommandWord = false;
    for (let i = 0; i < argv.length; i++) {
      if (globalFlags.has(argv[i])) continue; // skip flag
      if (globalFlags.has(argv[i]) || (i > 0 && GLOBAL_VALUE_FLAGS.has(argv[i-1]) && !argv[i].startsWith('-'))) continue; // skip flag value
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
	      // A quoted CHAIN ("goto A; goto B") must reach the chain executor
	      // verbatim even when other flags are on the command line. Tokenizing
	      // below deletes every `;` (and splits quoted args), so the rewritten
	      // argv no longer contained a chain operator and only the first
	      // command ran, silently (2026-11-23).
	      if (isChainInput(chainArg)) {
	        // argvIn, not the --json/--yaml-stripped argv: the output mode flag must survive
	        await handleChainInput(chainArg, argvIn);
	        return;
	      }
	      // `"goto url;title"`：`;` 后没有空白，isChainInput 的正则看不到它；继续往下
	      // 拆词会把 title 并成 goto 的多余参数，静默丢掉。`;` 之后每一段都以已注册
	      // 命令开头才按链处理——`https://x/a;jsessionid=1` 的后半段不是命令，仍是值。
	      const semicolonParts = splitOutsideQuotes(chainArg, ';');
	      if (semicolonParts.length > 1 && semicolonParts.slice(1).every(startsWithCommand)) {
	        await handleChainInput(semicolonParts.map(part => part.trim()).join(' ; '), argvIn);
	        return;
	      }
	      const spaceIdx = chainArg.indexOf(' ');
	      const possibleCmd = chainArg.substring(0, spaceIdx);
	      if (/^[a-zA-Z][\w-]*$/.test(possibleCmd)) {
	        const remainder = chainArg.substring(spaceIdx + 1);
	        // Quote-aware, like the chain parser: a quoted value keeps its spaces and
	        // loses its quotes (`click '#btn'` → #btn). splitCommand keeps the quotes on
	        // its tokens, so they are stripped here.
	        // 不在 `;` 处切：带 `;` 的链在上面已经按链处理并返回，走到这里说明 `;`
	        // 后面不是命令，它是值的一部分（`goto https://x/a;jsessionid=1` 曾被截成
	        // /a）。
	        const remainderParts = splitCommand(remainder).map(unquote);
	        // Replace the chain arg with split parts, keep everything else
	        chainTokenStart = chainArgIdx;
	        chainTokenEnd = chainArgIdx + remainderParts.length; // possibleCmd + remainder tokens
	        chainRaw = chainArg;
	        argv = [...argv.slice(0, chainArgIdx), possibleCmd, ...remainderParts, ...argv.slice(chainArgIdx + 1)];
	      }
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
    return;
  }

  // `--` 之后一律是位置参数——值以 - 开头时的标准写法（`fill -- '#q' '- item'`）。
  // parseArgs 会把它们收进 result['--'] 而无人读取，这里截出来直接追加到 positional。
  const doubleDash = argv.indexOf('--');
  const optionTokens = doubleDash === -1 ? argv : argv.slice(0, doubleDash);
  const literalArgs = doubleDash === -1 ? [] : argv.slice(doubleDash + 1);

  // Detect --json/--yaml before `--` (a literal value may spell either)
  const hasJsonFlag = optionTokens.some(a => a === '--json' || a.startsWith('--json='));
  const hasYamlFlag = optionTokens.some(a => a === '--yaml' || a.startsWith('--yaml='));

  // Use xcli-core 0.18.0 booleanFlags to prevent --json/--yaml from
  // absorbing the next positional arg as its value.
  const cleanArgv = optionTokens.filter(a => a !== '--json' && a !== '--yaml');

  // 负数保护：parseArgs 把 `-10` 当短旗标组（'1','0'）吃掉，位置参数永远
  // 收不到 —— `mouse move -10 -20` 报 usage 错，`--x -10` 更是静默变成
  // Number(true)=1。解析前把纯负数 token 换成占位形态（不以 - 开头，
  // parseArgs 才会当位置参数/旗标值保留），解析后按原样还原。
  const NEGATIVE_NUMBER = /^-\d+(?:\.\d+)?$/;
  const protectedArgv = cleanArgv.map(a => (NEGATIVE_NUMBER.test(a) ? `\x00${a}` : a));

  const parsed = parseArgs(protectedArgv, { booleanFlags: ['json', 'yaml', 'bridge', 'headless'] });
  const { positional, options } = parsed;
  // 还原被保护的负数（positional 与旗标值两条通道都可能承载）
  for (let i = 0; i < positional.length; i++) {
    if (positional[i].startsWith('\x00')) positional[i] = positional[i].slice(1);
  }
  for (const key of Object.keys(options)) {
    const v = options[key];
    if (typeof v === 'string' && v.startsWith('\x00')) options[key] = v.slice(1);
  }
  positional.push(...literalArgs);
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
      chainRaw,
    });
    if (handled) return;


        // `--` 之后有字面量位置参数时多传一个 true：内置命令处理器据此不再把
        // 以 - 开头的位置参数当旗标筛掉。没有 `--` 时调用形状不变。
        await handleBrowserCommand(
          command,
          cmdArgs,
          options,
          sessionName,
          mode,
          cdpEndpoint,
          ...(literalArgs.length > 0 ? [true as const] : []),
        );

  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}