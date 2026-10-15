import {
  fail,
  ok,
  TipCollector,
  normalizeTips,
  unquote,
  type CommandContext,
  type CommandResult,
  type SiteInstance,
} from '@dyyz1993/xcli-core';
import {
  findOrRestoreSession,
  createSession,
  saveSessionDiskMeta,
  type BrowserLaunchOptions,
  type ManagedSession,
} from '../browser.js';
import { parseCommandChain, splitCommand, parseCommandArgs } from '../chain-parser.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';
import { checkPluginLoginRequired } from '../plugin/login-guard.js';
import { loadHooks } from '../hooks/loader.js';
import { parsePluginParams } from '../utils/plugin-params.js';
import { errMsg } from '../utils/error.js';
import { getPluginStorage, recordArchive, tipsToMessages } from './foundation.js';
import type { ChainExecutionResult, ChainStepResult, HookOutput } from './types.js';

export async function executeChain(
  input: string,
  options?: { cdpEndpoint?: string; sessionName?: string; fileMode?: boolean },
  executeCommand?: (name: string, params: Record<string, unknown>, session: string, opts?: { cdpEndpoint?: string; skipCleanup?: boolean }) => Promise<{ success: boolean; data: unknown; message?: string; tips?: ChainStepResult['tips']; hookOutputs?: HookOutput[] }>
): Promise<ChainExecutionResult> {
  const pipelines = parseCommandChain(input, { fileMode: options?.fileMode });
  const sessionName = options?.sessionName || 'default';
  const results: ChainStepResult[] = [];
  const totalStart = Date.now();

  let session = await findOrRestoreSession(sessionName, options?.cdpEndpoint);
  if (!session) {
    const launchOpts: BrowserLaunchOptions = {};
    if (options?.cdpEndpoint) launchOpts.cdpEndpoint = options.cdpEndpoint;
    session = await createSession(sessionName, undefined, launchOpts);
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
        if (process.env.XBROWSER_CHAIN_PACE === 'human' && results.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1700));
        }
        const parts = splitCommand(cmdStr);
        if (parts.length === 0) continue;
        const cmdName = parts[0];
        const cmdArgs = parts.slice(1);

        const loader = await getPluginLoader();
        const internalLoader = loader.getCore().loader;
        const resolvedName = loader.resolveSiteName(cmdName);
        const site = resolvedName ? internalLoader.getSite(resolvedName) : undefined;
        if (site) {
          const pluginHandled = await executePluginChainStep({
            site,
            cmdName,
            cmdArgs,
            cmdStr,
            type,
            results,
            totalStart,
            session,
            sessionName,
          });
          if (pluginHandled) return pluginHandled;
          continue;
        }

        const { params } = parseCommandArgs(cmdName, cmdArgs, unquote);
        if (cmdName === 'goto' && params.url) {
          const existing = await findOrRestoreSession(sessionName, options?.cdpEndpoint);
          if (!existing) {
            session = await createSession(sessionName, params.url as string, {
              cdpEndpoint: options?.cdpEndpoint,
            });
          }
        }

        const result = await executeCommand!(cmdName, params, sessionName, {
          cdpEndpoint: options?.cdpEndpoint,
          skipCleanup: true,
        });
        results.push({
          command: cmdName,
          raw: cmdStr,
          success: result.success,
          data: result.data,
          message: result.message,
          duration: 0,
          tips: result.tips,
          ...(result.hookOutputs ? { hookOutputs: result.hookOutputs } : {}),
        });
        if (type === 'and' && !result.success) {
          return stoppedChain(false, results, totalStart, results.length, `Command '${cmdName}' failed (&& chain): ${result.message}`);
        }
        if (type === 'or' && result.success) {
          return stoppedChain(true, results, totalStart, results.length, `Command '${cmdName}' succeeded (|| chain)`);
        }
      }
    }
    return {
      success: !results.some((result) => !result.success),
      steps: results,
      totalDuration: Date.now() - totalStart,
    };
  } finally {
    // Session lifecycle remains owned by browser process/daemon.
  }
}

function stoppedChain(
  success: boolean,
  steps: ChainStepResult[],
  totalStart: number,
  stoppedAt: number,
  reason: string
): ChainExecutionResult {
  return {
    success,
    steps,
    totalDuration: Date.now() - totalStart,
    stoppedAt,
    stoppedReason: reason,
  };
}

interface PluginChainContext {
  site: SiteInstance;
  cmdName: string;
  cmdArgs: string[];
  cmdStr: string;
  type: string;
  results: ChainStepResult[];
  totalStart: number;
  session: ManagedSession;
  sessionName: string;
}

async function executePluginChainStep(context: PluginChainContext): Promise<ChainExecutionResult | undefined> {
  const { site, cmdName, cmdArgs, cmdStr, type, results, totalStart, session, sessionName } = context;
  const subCommand = cmdArgs[0];
  if (!subCommand) {
    results.push({ command: cmdName, raw: cmdStr, ...fail(`Plugin "${cmdName}" requires a sub-command`), duration: 0 });
    if (type === 'and') return stoppedChain(false, results, totalStart, results.length, `Command '${cmdName}' failed (&& chain): no sub-command`);
    return undefined;
  }

  const cmdEntry = site.getCommand(subCommand);
  if (!cmdEntry) {
    results.push({ command: cmdName, raw: cmdStr, ...fail(`Unknown command "${subCommand}" for plugin "${cmdName}"`), duration: 0 });
    if (type === 'and') return stoppedChain(false, results, totalStart, results.length, `Command '${cmdName}' failed (&& chain): unknown sub-command "${subCommand}"`);
    return undefined;
  }

  const pluginArgs = cmdArgs.slice(1);
  const pluginParams = parsePluginParams(pluginArgs, cmdEntry.parameters!);
  if (cmdEntry.parameters) {
    const schemaCheck = cmdEntry.parameters.safeParse(pluginParams);
    if (schemaCheck.success) {
      for (const [key, value] of Object.entries(schemaCheck.data as Record<string, unknown>)) {
        if (!(key in pluginParams)) pluginParams[key] = value;
      }
    }
  }

  const pluginCtx = {
    args: pluginArgs,
    options: pluginParams,
    cwd: process.cwd(),
    page: session.page,
    browser: session.context.browser()!,
    browserContext: session.context,
    sessionId: session.id,
    storage: getPluginStorage(cmdName),
    output: { mode: 'text' as const, showTips: false, color: false, emoji: false },
    error: (message: string) => { throw new Error(message); },
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
      page: session.page,
      sessionName,
    });
    if (!loginGuard.ok) {
      const duration = Date.now() - start;
      const data = loginGuard.data ?? null;
      recordArchive(session.id, sessionName, {
        step: results.length,
        command: `${cmdName} ${subCommand}`,
        params: pluginParams,
        result: { success: false, data, message: loginGuard.message, tips: loginGuard.tips || [] },
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
      if (type === 'and') return stoppedChain(false, results, totalStart, results.length, `Command '${cmdName} ${subCommand}' failed (&& chain): ${loginGuard.message}`);
      return undefined;
    }

    const hooks = await loadHooks();
    if (hooks.length > 0) {
      await Promise.all(hooks.map((hook) => hook.onBeforeCommand?.({ page: session.page!, command: `${cmdName} ${subCommand}`, params: pluginParams })));
    }
    const raw = await cmdEntry.handler(pluginParams, pluginCtx as unknown as CommandContext) as CommandResult;
    const duration = Date.now() - start;
    let hookOutputs: HookOutput[] | undefined;
    if (hooks.length > 0) {
      const outputs: HookOutput[] = [];
      for (const hook of hooks) {
        const output = await hook.onAfterCommand?.({ page: session.page!, command: `${cmdName} ${subCommand}`, params: pluginParams, result: raw, duration });
        if (output) outputs.push({ _hook: hook.name, ...output } as HookOutput);
      }
      if (outputs.length > 0) hookOutputs = outputs;
    }
    const data = raw?.data ?? raw;
    recordArchive(session.id, sessionName, {
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
    if (type === 'or') return stoppedChain(true, results, totalStart, results.length, `Command '${cmdName} ${subCommand}' succeeded (|| chain)`);
  } catch (error) {
    const duration = Date.now() - start;
    const message = errMsg(error);
    recordArchive(session.id, sessionName, {
      step: results.length,
      command: `${cmdName} ${subCommand}`,
      params: pluginParams,
      result: { success: false, data: null, message, tips: [] },
      toolCalls: [],
      duration,
      timestamp: start,
    });
    results.push({ command: `${cmdName} ${subCommand}`, raw: cmdStr, ...fail(message), duration });
    if (type === 'and') return stoppedChain(false, results, totalStart, results.length, `Command '${cmdName} ${subCommand}' failed (&& chain): ${message}`);
  }
  return undefined;
}
