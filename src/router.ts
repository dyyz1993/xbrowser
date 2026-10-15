import { parseArgs, outputFormatter, isCommandResult, type CommandResult, type CommandContext, TipCollector, normalizeTips, tip as makeTip } from '@dyyz1993/xcli-core';
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
import { getPluginLoader } from './utils/plugin-singleton.js';
import { checkPluginLoginRequired } from './plugin/login-guard.js';
import { findOrRestoreSession, createSession, saveSessionDiskMeta, type ManagedSession } from './browser.js';
import { buildViewerUrl } from './utils/viewer-url.js';
import { attachDetectAntiBot } from './context.js';
import {
  findEvalStart,
  handleChainInput,
  handleEvalMode,
  handleEvalScript,
  handleStdinMode,
  parseEvalFlags,
} from './router/input-modes.js';
import { outputLoginRequired, showCommandHelp } from './router/help.js';
import { handleCommandHelp } from './router/help-routing.js';
import { handleRemote, handleServe, startMcpServer } from './router/services.js';

function handleConfig(
  args: string[],
  options: Record<string, unknown>
): void {
  const builtin = allBuiltins.find((b) => b.name === 'config');
  if (builtin) builtin.execute(args, options, { cwd: process.cwd() });
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
      case 'mcp':
        await startMcpServer();
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
        // 目录名别名兜底：plugin list 显示目录名，路由按 site.name 匹配——
        // 不一致时（目录 alibaba-1688 / site 名 1688）按 list 显示名敲命令
        // 不该 404。resolveSiteName 把目录名解析为真实 site 名。
        const resolvedSiteName = loader.resolveSiteName(command);
        const site = resolvedSiteName ? internalLoader.getSite(resolvedSiteName) : undefined;
        if (site && resolvedSiteName !== command) {
          // 告知真实命令名，帮用户下次直敲（json 模式保持机器可读不注入提示）
          if (mode !== 'json' && mode !== 'yaml') {
            process.stderr.write(`ℹ️ "${command}" 的命令名是 "${resolvedSiteName}"（插件目录名与站点名不一致，已自动映射）\n`);
          }
        }

        // Only fall through to chain parsing if NOT a registered plugin site
        if (!site) {
          // Build chain input from non-global-flag args only
          const globalFlagSet = new Set(['--session', '--cdp', '--json', '--yaml', '--help', '-h', '--version', '--output', '-o']);
          const cleanParts: string[] = [];
          for (let i = 0; i < argv.length; i++) {
            // Tokens split out of the quoted chain string are chain content:
            // in-chain per-command flags (e.g. `screenshot --output P`) must
            // survive reassembly; only global flags OUTSIDE the chain region
            // are stripped (2026-09-12-8 fix).
            if (chainTokenStart >= 0 && i >= chainTokenStart && i <= chainTokenEnd) {
              cleanParts.push(argv[i]);
              continue;
            }
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

          // 转发前补齐 zod 默认值：daemon 侧可能不会补 .default()。
          // 只回填缺失键、不整体替换——zod 会剥 schema 外的键（session 等
          // 全局选项必须保留在 params 里）。
          if (cmdEntry.parameters) {
            const schemaFill = cmdEntry.parameters.safeParse(params);
            if (schemaFill.success) {
              for (const [k, v] of Object.entries(schemaFill.data as Record<string, unknown>)) {
                if (!(k in params)) (params as Record<string, unknown>)[k] = v;
              }
            }
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

            const result = await cmdEntry.handler(params, ctx as unknown as CommandContext) as CommandResult;

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
