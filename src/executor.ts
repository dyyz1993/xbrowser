import {
  ok,
  fail,
  isCommandResult,
  type CommandResult,
  type Tip,
  type StorageContext,
  CompositeStorage,
  TipCollector,
  normalizeTips,
  configureArchiveStore,
  appendCommandToArchive,
  type CommandArchiveEntry,
  checkGuard,
  unquote,
} from '@dyyz1993/xcli-core';
import { parsePluginParams } from './utils/plugin-params.js';
import { errMsg } from './utils/error.js';
import { NoopSiteInstance } from './utils/stub-context.js';
import { getCommand, getAllCommands } from './commands/index.js';
import type { BrowserCommandContext } from './context.js';
import { findOrRestoreSession, createSession, saveSessionDiskMeta, closeSessionByName, type ManagedSession, type BrowserLaunchOptions } from './browser.js';
import {
  parseCommandChain,
  splitCommand,
  parseCommandArgs,
} from './chain-parser.js';
import type { WSServer, CommandMessage } from './websocket-server.js';
import { getPluginLoader } from './utils/plugin-singleton.js';
import { checkPluginLoginRequired } from './plugin/login-guard.js';
import { getTipsManager } from './tips/index.js';
import { resolveRefParams } from './utils/resolve-selector.js';
import { loadHooks } from './hooks/loader.js';
import { homedir } from 'os';

/** Simple Levenshtein distance for "Did you mean?" suggestions */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
import { join } from 'path';

const NAVIGATION_COMMANDS = new Set(['goto', 'back', 'forward', 'refresh']);
const snapshotHintShown = new WeakSet<ManagedSession>();

const CONFIG_DIR = join(homedir(), '.xbrowser');

export type SimpleStorage = StorageContext;

const storageCache = new Map<string, StorageContext>();

export function getPluginStorage(pluginName: string): StorageContext {
  if (!storageCache.has(pluginName)) {
    // CompositeStorage satisfies StorageContext (provides plugin/global/cache/tmp stores),
    // whereas the legacy PluginStorage class lacks those nested stores.
    storageCache.set(pluginName, new CompositeStorage(pluginName, CONFIG_DIR, 'xbrowser'));
  }
  return storageCache.get(pluginName)!;
}

let archiveInitialized = false;
function ensureArchiveInit(): void {
  if (!archiveInitialized) {
    try {
      configureArchiveStore({ archiveDir: join(homedir(), '.xbrowser', 'archives') });
    } catch { /* archive init failure is non-fatal */ }
    archiveInitialized = true;
  }
}

function recordArchive(sessionId: string | undefined, sessionName: string, entry: CommandArchiveEntry): void {
  if (!sessionId) return;
  try {
    ensureArchiveInit();
    appendCommandToArchive(sessionId, sessionName, entry);
  } catch { /* archive write failure is non-fatal */ }
}

async function guardCheck(commandName: string): Promise<{ blocked: boolean; message: string } | null> {
  try {
    const loader = await getPluginLoader();
    const core = loader.getCore();
    return checkGuard(core, commandName, process.env);
  } catch { /* guard check failure should not block */ return null; }
}

/**
 * Result of a single command execution.
 */
export interface HookOutput {
  _hook: string;
  [key: string]: unknown;
}

export interface ExecutionResult {
  success: boolean;
  data: unknown;
  message?: string;
  duration: number;
  tips?: Tip[];
  hookOutputs?: HookOutput[];
}

/**
 * Result of a single step within a command chain execution.
 */
export interface ChainStepResult {
  command: string;
  raw: string;
  success: boolean;
  data: unknown;
  message?: string;
  duration: number;
  tips?: Tip[];
  hookOutputs?: HookOutput[];
}

/**
 * Result of executing a command chain (multiple commands linked with &&, ||, etc.).
 */
export interface ChainExecutionResult {
  success: boolean;
  steps: ChainStepResult[];
  totalDuration: number;
  stoppedAt?: number;
  stoppedReason?: string;
}

function errorResult(message: string): ExecutionResult {
  return { ...fail(message), duration: 0 };
}

/**
 * Convert Tip[] back to string[] for the archive protocol (CommandArchiveEntry.result.tips).
 * xcli-core's CommandResult.tips is Tip[], but the archive stores plain strings.
 */
function tipsToMessages(tips: Tip[] | undefined): string[] {
  if (!tips || tips.length === 0) return [];
  return tips.map((t) => (typeof t === 'string' ? t : t.message));
}

let wsServer: WSServer | null = null;

/**
 * Set or clear the WebSocket server used for streaming command events.
 *
 * @param server - A WSServer instance to stream events to, or null to disable.
 */
export function setWSServer(server: WSServer | null): void {
  wsServer = server;
}

function streamCommandEvent(sessionId: string, message: CommandMessage): void {
  if (!wsServer || !wsServer.getRunning()) return;
  wsServer.broadcastToSession(sessionId, {
    type: 'command',
    data: message,
  });
}

/**
 * Execute a single browser command against an existing session.
 *
 * Looks up the command by name, validates parameters via Zod schema,
 * resolves the target session, and runs the command handler.
 * Streams before/after events to the configured WebSocket server.
 *
 * @param commandName - Registered command name (e.g. "goto", "click", "fill").
 * @param params - Key-value parameters forwarded to the command handler.
 * @param sessionName - Name of the target session. Defaults to "default".
 * @returns An {@link ExecutionResult} with success status, data, and duration.
 *
 * @example
 * ```ts
 * const result = await executeCommand('click', { selector: '#submit' }, 'default');
 * if (result.success) console.log('Clicked!', result.data);
 * ```
 */
export async function executeCommand(
  commandName: string,
  params: Record<string, unknown>,
  sessionName: string = 'default',
  extraOpts?: { cdpEndpoint?: string; skipCleanup?: boolean }
): Promise<ExecutionResult> {
  const guardResult = await guardCheck(commandName);
  if (guardResult?.blocked) {
    return errorResult(guardResult.message);
  }

  const command = getCommand(commandName);
  if (!command) {
    const available = getAllCommands().map((c) => c.name);
    // Find closest match for "Did you mean?" suggestion
    const suggestions = available
      .map(name => ({ name, dist: levenshtein(commandName, name) }))
      .filter(s => s.dist <= 3)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map(s => s.name);
    const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(' or ')}?` : '';
    return errorResult(
      `Unknown command: ${commandName}.${hint} Available: ${available.join(', ')}`
    );
  }

  // --target: extract and resolve before Zod validation
  const _target = params._target as string | undefined;
  // Remove _target from params so Zod schemas don't complain about unknown keys
  if (_target) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _target: _u, ...rest } = params;
    params = rest;
  }

  let targetPageOverride: { url: string; title: string } | null = null;
  if (_target && extraOpts?.cdpEndpoint) {
    const { findTargetPage } = await import('./browser.js');
    targetPageOverride = await findTargetPage(extraOpts.cdpEndpoint, _target);
    if (!targetPageOverride) {
      return errorResult(`Target "${_target}" not found. Use 'xbrowser targets --cdp ${extraOpts.cdpEndpoint}' to list available pages.`);
    }
    // Override URL with target page URL so commands navigate to the right place
    params = { ...params, url: targetPageOverride.url };
  }

  if (command.parameters) {
    const result = command.parameters.safeParse(params);
    if (!result.success) {
      return errorResult(
        `Invalid parameters: ${result.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')}`
      );
    }
    params = result.data as Record<string, unknown>;
  }

  // Forward browser-dependent commands to daemon (auto-starts daemon if not running).
  if (command.scope !== 'cli' && !process.env.XBROWSER_DAEMON_WORKER) {
    const { forwardExec } = await import('./client/daemon-client.js');
    const result = await forwardExec(commandName, params, sessionName, extraOpts?.cdpEndpoint);
    if (result) return result;
    // forwardExec returned null/undefined (e.g. daemon unreachable) — fall through to local execution
  }

  let session: ManagedSession | undefined;

  // Try in-memory first, then disk restore
  const existing = await findOrRestoreSession(sessionName, extraOpts?.cdpEndpoint);
  if (existing) {
    session = existing;
    if (session.page) {
      try {
        await Promise.race([
          session.page.evaluate(() => true),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
      } catch {
        await closeSessionByName(session.name);
        session = undefined;
      }
    }
    if (session && targetPageOverride && session.page) {
      const currentUrl = session.page.url();
      if (currentUrl !== targetPageOverride.url) {
        await session.page.goto(targetPageOverride.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }
  } else if (command.scope !== 'project') {
    // Auto-create session for all browser/page/element scope commands
    // No need for explicit session creation — sessions are auto-created via --session
    session = await createSession(sessionName, params.url as string | undefined, {
      cdpEndpoint: extraOpts?.cdpEndpoint,
    });
  }

  const ctx: BrowserCommandContext = {
    page: session?.page as BrowserCommandContext['page'],
    browser: session?.context.browser() as BrowserCommandContext['browser'],
    browserContext: session?.context as BrowserCommandContext['browserContext'],
    sessionId: session?.id,
    cdpEndpoint: session?.cdpEndpoint || extraOpts?.cdpEndpoint,
    args: [],
    options: {},
    cwd: process.cwd(),
    storage: getPluginStorage(commandName),
    output: {
      mode: 'text' as const,
      showTips: false,
      color: false,
      emoji: false,
    },
    error: (msg: string) => {
      throw new Error(msg);
    },
    config: {},
    site: new NoopSiteInstance(),
    cliName: 'xbrowser',
    tips: new TipCollector(),
  };

  const start = Date.now();

  if (session) {
    streamCommandEvent(session.id, {
      sessionId: session.id,
      command: commandName,
      args: Object.values(params),
      phase: 'before',
      timestamp: start,
    });
  }

  const tipsManager = getTipsManager();
  if (session?.page) {
    await tipsManager.beforeCommand(session.page, commandName, params);
  }

  let refTips: Tip[] = [];
  if (session?.page && command.selectorParams && command.selectorParams.length > 0) {
    const cache = new Map<string, string>();
    const resolved = await resolveRefParams(session.page, params, command.selectorParams, cache, session.id);
    if (resolved.tips.length > 0) {
      refTips = normalizeTips(resolved.tips);
      params = resolved.params;
    }
  }

  try {
    const hooks = await loadHooks();
    if (hooks.length > 0 && session?.page) {
      await Promise.all(hooks.map(h => h.onBeforeCommand?.({ page: session.page!, command: commandName, params })));
    }

    const raw = await command.handler(params, ctx);
    const end = Date.now();
    const duration = end - start;

    let hookOutputs: HookOutput[] | undefined;
    if (hooks.length > 0 && session?.page) {
      const outputs: HookOutput[] = [];
      for (const h of hooks) {
        const output = await h.onAfterCommand?.({ page: session.page!, command: commandName, params, result: raw, duration });
        if (output) outputs.push({ _hook: h.name, ...output });
      }
      if (outputs.length > 0) hookOutputs = outputs;
    }

    // Save conversationUrl to session disk metadata when a command returns it
    if (session && isCommandResult(raw)) {
      const resultData = raw.data as Record<string, unknown> | undefined;
      const convUrl = resultData?.conversationUrl as string | undefined;
      if (convUrl) {
        saveSessionDiskMeta(sessionName, { conversationUrl: convUrl });
      }
    }

    if (session) {
      const phaseData = {
        sessionId: session.id,
        command: commandName,
        args: Object.values(params),
        phase: 'after' as const,
        timestamp: end,
        duration,
      };
      if (isCommandResult(raw)) {
        streamCommandEvent(session.id, { ...phaseData, result: raw.data });
      } else {
        streamCommandEvent(session.id, { ...phaseData, result: raw });
      }
    }

    let smartTips: string[] | undefined;
    if (session?.page) {
      const tips = await tipsManager.afterCommand();
      if (tips.length > 0) {
        smartTips = tipsManager.formatTips(tips);
      }
    }

    if (isCommandResult(raw)) {
      let snapshotHint: string | undefined;
      if (session && NAVIGATION_COMMANDS.has(commandName) && !snapshotHintShown.has(session)) {
        snapshotHintShown.add(session);
        snapshotHint = '💡 使用 snapshot 命令获取页面快照和 ref 编号，然后用 ref 快速定位元素（如 click --selector e1）';
      }
      // raw.tips is already Tip[] (from CommandResult); smartTips/snapshotHint/refTips are string[]
      // from internal helpers — normalize them to Tip[] before merging.
      const merged: Tip[] = [
        ...(raw.tips || []),
        ...normalizeTips(smartTips),
        ...(snapshotHint ? normalizeTips([snapshotHint]) : []),
        ...refTips,
      ];
      const isSuccess = raw.success !== false;
      const mergedOrRaw = merged.length > 0 ? merged : (raw.tips || []);
      recordArchive(session?.id, sessionName, {
        step: 0,
        command: commandName,
        params,
        result: { success: isSuccess, data: raw.data, message: raw.message, tips: tipsToMessages(mergedOrRaw) },
        toolCalls: [],
        duration: duration,
        timestamp: start,
      });
      if (isSuccess) {
        return { ...ok(raw.data, merged.length > 0 ? merged : raw.tips), duration, ...(hookOutputs ? { hookOutputs } : {}) };
      }
      return { success: false, data: raw.data, message: raw.message, tips: mergedOrRaw, duration, ...(hookOutputs ? { hookOutputs } : {}) };
    }

    const smartTipNormalized = normalizeTips(smartTips);
    recordArchive(session?.id, sessionName, {
      step: 0,
      command: commandName,
      params,
      result: { success: true, data: raw, tips: tipsToMessages(smartTipNormalized) },
      toolCalls: [],
      duration: duration,
      timestamp: start,
    });
    return { ...ok(raw, smartTipNormalized), duration, ...(hookOutputs ? { hookOutputs } : {}) };
  } catch (err) {
    const end = Date.now();
    const duration = end - start;
    const errorMessage = errMsg(err);

    if (session) {
      streamCommandEvent(session.id, {
        sessionId: session.id,
        command: commandName,
        args: Object.values(params),
        phase: 'after',
        error: errorMessage,
        timestamp: end,
        duration,
      });
    }

    recordArchive(session?.id, sessionName, {
      step: 0,
      command: commandName,
      params,
      result: { success: false, data: null, message: errorMessage, tips: [] },
      toolCalls: [],
      duration: duration,
      timestamp: start,
    });
    return { ...fail(errorMessage), duration };
  } finally {
    // Session lifecycle is managed by:
    //   1. process.on('exit') — cleanup on process exit (CDP: disconnect only; non-CDP: close browser)
    //   2. "session close/kill" — explicit destruction by user
    // Do NOT destroy here — executeCommand is just a command executor, not a lifecycle manager.
  }
}

/**
 * Execute a chain of browser commands parsed from a string expression.
 *
 * Supports `&&` (and-chain, stops on first failure), `||` (or-chain, stops on
 * first success), `;` (sequence separator), `->`, `,`, and `+` operators.
 * Automatically creates a browser session if none exists and destroys it
 * afterwards.
 *
 * @param input - Raw chain expression (e.g. `"goto https://example.com && click #btn"`).
 * @param options - Optional configuration for CDP endpoint, session name, and file mode.
 * @returns A {@link ChainExecutionResult} with per-step results and total duration.
 *
 * @example
 * ```ts
 * const result = await executeChain('goto https://example.com && click #btn');
 * console.log(result.success, result.steps.length);
 * ```
 */
export async function executeChain(
  input: string,
  options?: { cdpEndpoint?: string; sessionName?: string; fileMode?: boolean }
): Promise<ChainExecutionResult> {
  const pipelines = parseCommandChain(input, { fileMode: options?.fileMode });
  const sessionName = options?.sessionName || 'default';
  const results: ChainStepResult[] = [];
  const totalStart = Date.now();

  let session = await findOrRestoreSession(sessionName, options?.cdpEndpoint);
  if (!session) {
    const launchOpts: BrowserLaunchOptions = {};
    if (options?.cdpEndpoint) {
      launchOpts.cdpEndpoint = options.cdpEndpoint;
    }
    session = await createSession(sessionName, undefined, launchOpts);
    // Persist session to disk for cross-CLI-invocation recovery (CDP mode)
    saveSessionDiskMeta(sessionName, {
      id: session.id,
      name: sessionName,
      url: session.page.url(),
      createdAt: session.createdAt,
      cdpEndpoint: session.cdpEndpoint,
    });
  }

  try {
    for (const pipeline of pipelines) {
      const { type, pipeline: commands } = pipeline;

      for (const cmdStr of commands) {
        const parts = splitCommand(cmdStr);
        if (parts.length === 0) continue;

        const cmdName = parts[0];
        const cmdArgs = parts.slice(1);

        const loader = await getPluginLoader();
        const internalLoader = loader.getCore().loader;
        const site = internalLoader.getSite(cmdName);

        if (site) {
          const subCommand = cmdArgs[0];
          if (!subCommand) {
            results.push({
              command: cmdName,
              raw: cmdStr,
              ...fail(`Plugin "${cmdName}" requires a sub-command`),
              duration: 0,
            });
            if (type === 'and') {
              return {
                success: false,
                steps: results,
                totalDuration: Date.now() - totalStart,
                stoppedAt: results.length,
                stoppedReason: `Command '${cmdName}' failed (&& chain): no sub-command`,
              };
            }
            continue;
          }

          const cmdEntry = site.getCommand(subCommand);
          if (!cmdEntry) {
            results.push({
              command: cmdName,
              raw: cmdStr,
              ...fail(`Unknown command "${subCommand}" for plugin "${cmdName}"`),
              duration: 0,
            });
            if (type === 'and') {
              return {
                success: false,
                steps: results,
                totalDuration: Date.now() - totalStart,
                stoppedAt: results.length,
                stoppedReason: `Command '${cmdName}' failed (&& chain): unknown sub-command "${subCommand}"`,
              };
            }
            continue;
          }

          const pluginArgs = cmdArgs.slice(1);
          const pluginParams = parsePluginParams(pluginArgs, cmdEntry.parameters!);

          const pluginCtx = {
            args: pluginArgs,
            options: pluginParams,
            cwd: process.cwd(),
            page: session!.page,
            browser: session!.context.browser()!,
            browserContext: session!.context,
            sessionId: session!.id,
            storage: getPluginStorage(cmdName),
            output: { mode: 'text' as const, showTips: false, color: false, emoji: false },
            error: (msg: string) => { throw new Error(msg); },
            config: {},
            site,
            cliName: 'xbrowser',
            tips: new TipCollector(),
          };

          const start = Date.now();
          try {
            const loginGuard = await checkPluginLoginRequired({
              site,
              command: cmdEntry,
              commandName: subCommand,
              ctx: pluginCtx,
              page: session?.page,
              sessionName,
            });
            if (!loginGuard.ok) {
              const duration = Date.now() - start;
              const data = loginGuard.data ?? null;
              recordArchive(session!.id, sessionName, {
                step: results.length,
                command: `${cmdName} ${subCommand}`,
                params: pluginParams,
                result: { success: false, data, message: loginGuard.message, tips: loginGuard.tips || [] as string[] },
                toolCalls: [],
                duration,
                timestamp: start,
              });
              results.push({
                command: `${cmdName} ${subCommand}`,
                raw: cmdStr,
                success: false,
                data,
                message: loginGuard.message,
                tips: normalizeTips(loginGuard.tips),
                duration,
              });
              if (type === 'and') {
                return {
                  success: false,
                  steps: results,
                  totalDuration: Date.now() - totalStart,
                  stoppedAt: results.length,
                  stoppedReason: `Command '${cmdName} ${subCommand}' failed (&& chain): ${loginGuard.message}`,
                };
              }
              continue;
            }

            const hooks = await loadHooks();
            if (hooks.length > 0) {
              await Promise.all(hooks.map(h => h.onBeforeCommand?.({ page: session!.page!, command: `${cmdName} ${subCommand}`, params: pluginParams })));
            }

            const raw = await cmdEntry.handler(pluginParams, pluginCtx) as CommandResult;
            const duration = Date.now() - start;

            let hookOutputs: HookOutput[] | undefined;
            if (hooks.length > 0) {
              const outputs: HookOutput[] = [];
              for (const h of hooks) {
                const output = await h.onAfterCommand?.({ page: session!.page!, command: `${cmdName} ${subCommand}`, params: pluginParams, result: raw, duration });
                if (output) outputs.push({ _hook: h.name, ...output } as HookOutput);
              }
              if (outputs.length > 0) hookOutputs = outputs;
            }

            const data = raw?.data ?? raw;
            recordArchive(session!.id, sessionName, {
              step: results.length,
              command: `${cmdName} ${subCommand}`,
              params: pluginParams,
              result: { success: true, data, tips: tipsToMessages(raw?.tips) },
              toolCalls: [],
              duration,
              timestamp: start,
            });
            results.push({
              command: `${cmdName} ${subCommand}`,
              raw: cmdStr,
              ...ok(data),
              duration,
              ...(hookOutputs ? { hookOutputs } : {}),
            });
            if (type === 'or') {
              return {
                success: true,
                steps: results,
                totalDuration: Date.now() - totalStart,
                stoppedAt: results.length,
                stoppedReason: `Command '${cmdName} ${subCommand}' succeeded (|| chain)`,
              };
            }
          } catch (err) {
            const duration = Date.now() - start;
            const errorMessage = errMsg(err);
            recordArchive(session!.id, sessionName, {
              step: results.length,
              command: `${cmdName} ${subCommand}`,
              params: pluginParams,
              result: { success: false, data: null, message: errorMessage, tips: [] },
              toolCalls: [],
              duration,
              timestamp: start,
            });
            results.push({
              command: `${cmdName} ${subCommand}`,
              raw: cmdStr,
              ...fail(errorMessage),
              duration,
            });
            if (type === 'and') {
              return {
                success: false,
                steps: results,
                totalDuration: Date.now() - totalStart,
                stoppedAt: results.length,
                stoppedReason: `Command '${cmdName} ${subCommand}' failed (&& chain): ${errorMessage}`,
              };
            }
          }
          continue;
        }

        const { params } = parseCommandArgs(cmdName, cmdArgs, unquote);

        if (cmdName === 'goto' && params.url) {
          const existing2 = await findOrRestoreSession(sessionName, options?.cdpEndpoint);
          if (!existing2) {
            session = await createSession(sessionName, params.url as string, {
              cdpEndpoint: options?.cdpEndpoint,
            });
          }
        }

        const start = Date.now();
        const result = await executeCommand(cmdName, params, sessionName, {
          cdpEndpoint: options?.cdpEndpoint,
          skipCleanup: true, // executeChain's finally handles cleanup
        });
        const duration = Date.now() - start;

        const stepResult: ChainStepResult = {
          command: cmdName,
          raw: cmdStr,
          success: result.success,
          data: result.data,
          message: result.message,
          duration,
          tips: result.tips,
          ...(result.hookOutputs ? { hookOutputs: result.hookOutputs } : {}),
        };
        results.push(stepResult);

        if (type === 'and' && !result.success) {
          return {
            success: false,
            steps: results,
            totalDuration: Date.now() - totalStart,
            stoppedAt: results.length,
            stoppedReason: `Command '${cmdName}' failed (&& chain): ${result.message}`,
          };
        }

        if (type === 'or' && result.success) {
          return {
            success: true,
            steps: results,
            totalDuration: Date.now() - totalStart,
            stoppedAt: results.length,
            stoppedReason: `Command '${cmdName}' succeeded (|| chain)`,
          };
        }
      }
    }

    const anyFailed = results.some((r) => !r.success);
    return {
      success: !anyFailed,
      steps: results,
      totalDuration: Date.now() - totalStart,
    };
  } finally {
    // Session lifecycle is managed by:
    //   1. process.on('exit') — cleanup on process exit (CDP: disconnect only; non-CDP: close browser)
    //   2. "session close/kill" — explicit destruction by user
    // Do NOT destroy here — executeChain is just a command executor, not a lifecycle manager.
    // Daemon mode keeps sessions alive for reuse across requests.
  }
}

/**
 * Check whether the given input string contains chain operators.
 *
 * Detects `&&`, `;`, `,`, `+`, and `->` surrounded by whitespace.
 *
 * @param input - The raw input string to test.
 * @returns `true` if chain operators are present.
 */
export function isChainInput(input: string): boolean {
  return /\s&&\s|\|\|\s|\s;\s|\s,\s|\s\+\s|\s->\s/.test(input);
}
