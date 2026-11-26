import {
  isCommandResult,
  tip as makeTipSafe,
  normalizeTips,
  outputFormatter,
  TipCollector,
  type CommandContext,
  type CommandResult,
  type SiteInstance,
} from '@dyyz1993/xcli-core';
import { parsePluginParams } from '../utils/plugin-params.js';
import { asZodSchema } from '../utils/zod-internal.js';
import { executeChain, getPluginStorage, isChainInput } from '../executor.js';
import { CHAIN_OPERATOR_TOKENS, quoteChainToken } from '../chain-parser.js';
import { getCommand } from '../commands/command-registry.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';
import { checkPluginLoginRequired } from '../plugin/login-guard.js';
import {
  requestHumanWait,
  finishHumanWait,
  markTaskNeedsHuman,
  isHumanWaitRequiredError,
  buildNeedsHumanResult,
} from '../plugin/human-wait.js';
import {
  createSession,
  findOrRestoreSession,
  saveSessionDiskMeta,
  type ManagedSession,
} from '../browser.js';
import { buildViewerUrl } from '../utils/viewer-url.js';
import { attachDetectAntiBot } from '../context.js';
import { loadHooks } from '../hooks/loader.js';
import { outputEnvelope, outputError, outputResult } from '../cli/output.js';
import { outputLoginRequired, showCommandHelp } from './help.js';

export interface PluginRouteRequest {
  command: string;
  cmdArgs: string[];
  argv: string[];
  options: Record<string, unknown>;
  mode: string;
  cdpEndpoint?: string;
  sessionName: string;
  chainTokenStart: number;
  chainTokenEnd: number;
  /** 链区重写前的原始带引号命令串（router 拆 token 前的那一段）；无链区时缺省 */
  chainRaw?: string;
}

export const KNOWN_GLOBAL_OPTIONS = new Set([
  'json', 'yaml', 'session', 'cdp', 'cdp-endpoint', 'version', 'v',
  'help', 'h', 'target', 'port', 'token', 'timeout', 'headless', 'tab',
  // --bridge（2026-11-18 起的全局 flag）：插件命令首次把会话建在用户浏览器里也要用它
  'bridge',
]);

/**
 * Global flags that take a value — the one definition, shared with router.ts.
 * Every other global flag is boolean (--json, --help, …): the token right after
 * it is the next argument (e.g. the plugin name), never a flag value.
 */
export const GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--session', '--cdp', '--output', '-o', '--timeout', '--frame', '--target', '--tab',
]);

export async function handlePluginOrChainRoute(request: PluginRouteRequest): Promise<boolean> {
  const { command, cmdArgs, argv, options, mode, cdpEndpoint, sessionName, chainTokenStart, chainTokenEnd, chainRaw } = request;
        // Check plugin site BEFORE chain parsing to avoid --content with +/, being misinterpreted
        const loader = await getPluginLoader();
        const internalLoader = loader.getCore().loader;
        // 目录名别名兜底：plugin list 显示目录名，路由按 site.name 匹配——
        // 不一致时（目录 alibaba-1688 / site 名 1688）按 list 显示名敲命令
        // 不该 404。resolveSiteName 把目录名解析为真实 site 名。
        const resolvedSiteName = loader.resolveSiteName(command);
        const site: SiteInstance | undefined = resolvedSiteName ? internalLoader.getSite(resolvedSiteName) : undefined;
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
          // 链区在 cleanParts 中的位置（regionLast 为排他端点）：链区 token 已被
          // router unquote，重组时要用原始串（chainRaw）替换，见下方 fullInput。
          let regionFirst = -1;
          let regionLast = -1;
          // `--` 之后的 token 是字面量位置参数：丢掉 `--` 本身，值逐个强制加引号，
          // 免得恰好拼成操作符或旗标（`fill '#q' -- '&&'`）
          let literal = false;
          for (let i = 0; i < argv.length; i++) {
            // Tokens split out of the quoted chain string are chain content:
            // in-chain per-command flags (e.g. `screenshot --output P`) must
            // survive reassembly; only global flags OUTSIDE the chain region
            // are stripped (2026-09-12-8 fix).
            if (chainTokenStart >= 0 && i >= chainTokenStart && i <= chainTokenEnd) {
              if (regionFirst < 0) regionFirst = cleanParts.length;
              cleanParts.push(argv[i]);
              regionLast = cleanParts.length;
              continue;
            }
            if (argv[i] === '--') {
              literal = true;
              continue;
            }
            if (globalFlagSet.has(argv[i])) continue;
            // Skip the value of the value-taking flags (--session/--cdp/--output …).
            // Only those: `--json plugin "a && b"` used to lose the plugin name.
            if (i > 0 && GLOBAL_VALUE_FLAGS.has(argv[i-1]) && !argv[i].startsWith('-')) continue;
            if (argv[i].startsWith('--session=') || argv[i].startsWith('--cdp=')) continue;
            cleanParts.push(literal ? quoteChainToken(argv[i], true) : argv[i]);
          }
          // 链操作符只有自成一个 argv token 时才是操作符（`goto a '&&' title`、
          // `goto a -> title`）：shell 已经切好词，藏在单个 token 里的 ` + ` / ` ; `
          // 是值的一部分。所以这一路的链字符串里，带空白或操作符的 token 重新加
          // 引号，链解析器才不会把它拆开（`fill '#q' 'a + b' '&&' title`）；操作符
          // token 本身是链结构，原样保留。
          const hasOperatorToken = cleanParts.some((part) => CHAIN_OPERATOR_TOKENS.has(part));
          const spliced = chainRaw !== undefined && regionFirst >= 0;
          // 另一路沿用旧行为：对「裸 token 拼接结果」跑正则。只保留给两种情形——
          // 有链区（判定与改动前一致），或命令名未注册（`someplugin cmd1 && cmd2`，
          // 没有参数定义可依）。已注册命令 token 内的分隔符是值，落回内置命令路径。
          const legacyChainLike = (spliced || getCommand(command) === undefined)
            && isChainInput(cleanParts.join(' '));
          if (hasOperatorToken || legacyChainLike) {
            // 旧行为那一路连执行串也保持原样：裸 token 拼回去，交给链解析器拆。
            // 有独立操作符时，链区用 router 传来的原始串逐字放回（引号不丢）。
            const quoteStructure = (parts: string[]): string => parts
              .map((part) => (CHAIN_OPERATOR_TOKENS.has(part) ? part : quoteChainToken(part)))
              .join(' ');
            const fullInput = !hasOperatorToken
              ? cleanParts.join(' ')
              : spliced
                ? [
                    quoteStructure(cleanParts.slice(0, regionFirst)),
                    chainRaw,
                    quoteStructure(cleanParts.slice(regionLast)),
                  ].filter(part => part.length > 0).join(' ')
                : quoteStructure(cleanParts);
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
              return true;
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
            return true;
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
                return true;
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
            return true;
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
              return true;
            }
          }

          if (cmdArgsForPlugin.includes('--help') || cmdArgsForPlugin.includes('-h')) {
            showCommandHelp(command, cmdEntry, { description: site.config.description, name: site.name, url: site.url }, mode);
            return true;
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
                return true;
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
            const { forwardPluginExec } = await import('../client/daemon-client.js');
            const userTimeout = typeof params.timeout === 'number' && params.timeout > 0 ? params.timeout * 1000 + 30000 : undefined;
            // --bridge / XBROWSER_BRIDGE=1：首次把会话建在用户浏览器里（与内置命令同一个开关）
            const bridgeFlag = options.bridge === true || String(options.bridge) === 'true' || process.env.XBROWSER_BRIDGE === '1';
            // daemon 原样返回插件的结果，不带耗时；用这次转发的往返时间兜底
            const forwardStart = Date.now();
            const result = await forwardPluginExec(`${command}.${subCommand}`, params, sessionName, cdpEndpoint, userTimeout, bridgeFlag);
            const resultData = result && typeof result === 'object' && 'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
            if (result && result.success === false && resultData?.code === 'LOGIN_REQUIRED') {
              process.exitCode = 1;
              outputLoginRequired(result, mode);
              return true;
            }
            if (result && result.success === false && resultData?.code === 'NEEDS_HUMAN') {
              // daemon 已 fail-closed：本地不要再跑一遍，避免重复副作用
              process.exitCode = 1;
              if (mode === 'json' || mode === 'yaml') {
                outputEnvelope(
                  {
                    success: false,
                    data: result.data,
                    message: result.message,
                    tips: result.tips,
                    duration: Date.now() - forwardStart,
                  },
                  { command: `${command} ${subCommand}` },
                  mode,
                );
              } else {
                outputError(result.message || '需要人工协助');
                for (const tip of result.tips ?? []) {
                  const text = typeof tip === 'string' ? tip : (tip as { message?: string }).message;
                  if (text) console.error(`  \u{1F4A1} ${text}`);
                }
              }
              return true;
            }
            if (result && result.success !== false) {
              // 与本地执行路径同一个信封：以前这里在 --json / --yaml 下直接打印 data，
              // 失败时却打印信封，同一个命令成功和失败的输出形状不一样。
              if (mode === 'json' || mode === 'yaml') {
                outputEnvelope(
                  {
                    success: true,
                    data: result.data,
                    message: result.message,
                    tips: result.tips,
                    duration: result.duration || Date.now() - forwardStart,
                  },
                  { command: `${command} ${subCommand}` },
                  mode,
                );
              } else {
                console.log(outputFormatter.format(result.data, { mode: 'text', color: true, emoji: true }));
                if (result.tips?.length) {
                  for (const tip of result.tips) {
                    const text = typeof tip === 'string' ? tip : (tip as { message?: string }).message;
                    if (text) console.log(`  \u{1F4A1} ${text}`);
                  }
                }
              }
              return true;
            }
          }

          let session: ManagedSession | undefined = undefined;
          if (needsBrowser) {
            // 粘性路由：会话首次用 --bridge 建在用户浏览器里，之后的插件命令也必须落在同一个
            // 浏览器——否则同一条 --session，内置命令走真浏览器、插件命令走无头
            // 动态 import：与下方 setActivePage 同理，不在模块加载期把 browser 模块图拉进来
            const { findOrCreateBridgeSession } = await import('../browser/bridge-session.js');
            const bridgeSession = await findOrCreateBridgeSession(sessionName, {
              preferBridge: options.bridge === true || String(options.bridge) === 'true' || process.env.XBROWSER_BRIDGE === '1',
            }).catch(() => null);
            session = bridgeSession ?? await findOrRestoreSession(sessionName, cdpEndpoint);
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
              const { setActivePage } = await import('../browser.js');
              setActivePage(session, targetPage);
            }
          }

          let humanWaitRequested = false;
          let humanWaitReason = '';
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
            // 不等待：标记 bridge 任务组后抛 HumanWaitRequiredError，命令 fail-closed
            waitForHuman: async (opts?: Record<string, unknown>) => {
              humanWaitRequested = true;
              humanWaitReason = String(opts?.reason || '').trim();
              return requestHumanWait(opts, session);
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
              // 命令在这里停下（LOGIN_REQUIRED）：bridge 任务组标题要让人看得出是在等登录
              if (session?.bridge) await markTaskNeedsHuman(session, `需要登录后才能执行 ${command}.${subCommand}`);
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
              return true;
            }

            const cmdHooks = await loadHooks();
            if (cmdHooks.length > 0 && session?.page) {
              await Promise.all(cmdHooks.map(h => h.onBeforeCommand?.({ page: session.page!, command: `${command} ${subCommand}`, params })));
            }

            const result = await cmdEntry.handler(params, ctx as unknown as CommandContext) as CommandResult;
            if (humanWaitRequested) {
              const reason = humanWaitReason || '需要人工协助';
              await markTaskNeedsHuman(session, reason);
              // 插件把 HumanWaitRequiredError 吞掉后继续执行：不能报成功
              if (!result || typeof result !== 'object' || (result as { success?: boolean }).success !== false) {
                process.exitCode = 1;
                outputEnvelope(
                  buildNeedsHumanResult(reason, {
                    taskName: session?.bridge?.taskName,
                    tips: (result as { tips?: Array<string | import('@dyyz1993/xcli-core').Tip> } | null)?.tips,
                  }),
                  { command: `${command} ${subCommand}` },
                  mode,
                );
                return true;
              }
              const record = result as { data?: unknown; tips?: Array<string | import('@dyyz1993/xcli-core').Tip> };
              record.data = {
                ...(record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}),
                code: 'NEEDS_HUMAN',
                reason,
              };
              record.tips = normalizeTips([
                ...(Array.isArray(record.tips) ? record.tips : []),
                makeTipSafe.warn(`需要人工协助：${reason}`),
              ]);
            }

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
                result.tips = [...(result.tips || []), makeTipSafe.info(`Open viewer to complete login: ${injectedViewerUrl}`)];
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
            if (isHumanWaitRequiredError(e)) {
              await markTaskNeedsHuman(session, e.reason);
              process.exitCode = 1;
              outputEnvelope(
                buildNeedsHumanResult(e.reason, {
                  taskName: e.taskName ?? session?.bridge?.taskName,
                }),
                { command: `${command} ${subCommand}` },
                mode,
              );
              return true;
            }
            if (humanWaitRequested) await finishHumanWait(session, false, e instanceof Error ? e.message : String(e));
            outputError(e instanceof Error ? e.message : String(e));
          } finally {
            // Session lifecycle is managed by:
            //   1. process.on('exit') — cleanup on process exit
            //   2. "session close/kill" — explicit destruction by user
            // Do NOT destroy here — plugin commands are just command executors, not lifecycle managers.
          }
          return true;
        }
  return false;
}
