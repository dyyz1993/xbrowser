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
import { getPluginLoader } from '../utils/plugin-singleton.js';
import { checkPluginLoginRequired } from '../plugin/login-guard.js';
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
}

export const KNOWN_GLOBAL_OPTIONS = new Set([
  'json', 'yaml', 'session', 'cdp', 'cdp-endpoint', 'version', 'v',
  'help', 'h', 'target', 'port', 'token', 'timeout', 'headless', 'tab',
]);

export async function handlePluginOrChainRoute(request: PluginRouteRequest): Promise<boolean> {
  const { command, cmdArgs, argv, options, mode, cdpEndpoint, sessionName, chainTokenStart, chainTokenEnd } = request;
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
            const result = await forwardPluginExec(`${command}.${subCommand}`, params, sessionName, cdpEndpoint, userTimeout);
            const resultData = result && typeof result === 'object' && 'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
            if (result && result.success === false && resultData?.code === 'LOGIN_REQUIRED') {
              process.exitCode = 1;
              outputLoginRequired(result, mode);
              return true;
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
              return true;
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
              const { setActivePage } = await import('../browser.js');
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
              return true;
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
