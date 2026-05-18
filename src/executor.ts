import { ok, fail, isCommandResult, type CommandResult } from '@dyyz1993/xcli-core';
import { mapPositionalValues } from './utils/positional-params.js';
import { getCommand, getAllCommands } from './commands/index.js';
import type { BrowserCommandContext } from './context.js';
import { findOrRestoreSession, createSession, destroyBrowser, saveSessionDiskMeta, type ManagedSession, type BrowserLaunchOptions } from './browser.js';
import {
  parseCommandChain,
  splitCommand,
  parseCommandArgs,
} from './chain-parser.js';
import type { WSServer, CommandMessage } from './websocket-server.js';
import { getPluginLoader } from './utils/plugin-singleton.js';
import { getTipsManager } from './tips/index.js';

/**
 * Result of a single command execution.
 */
export interface ExecutionResult {
  success: boolean;
  data: unknown;
  message?: string;
  duration: number;
  tips?: string[];
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
  tips?: string[];
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
  const command = getCommand(commandName);
  if (!command) {
    const available = getAllCommands().map((c) => c.name);
    return errorResult(
      `Unknown command: ${commandName}. Available: ${available.join(', ')}`
    );
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

  // If daemon is running and CDP is being used, forward to daemon
  if (extraOpts?.cdpEndpoint && command.scope === 'page' && !process.env.XBROWSER_DAEMON_WORKER) {
    const { isDaemonRunning, forwardExec } = await import('./client/daemon-client.js');
    if (await isDaemonRunning()) {
      return forwardExec(commandName, params, sessionName, extraOpts.cdpEndpoint);
    }
  }

  let session: ManagedSession | undefined;
  let autoCreated = false;
  // Try in-memory first, then disk restore
  const existing = await findOrRestoreSession(sessionName, extraOpts?.cdpEndpoint);
  if (existing) {
    session = existing;
  } else if (command.scope === 'page' && params.url) {
    session = await createSession(sessionName, params.url as string, {
      cdpEndpoint: extraOpts?.cdpEndpoint,
    });
    autoCreated = true;
  } else if (command.scope !== 'project') {
    return errorResult(
      `Session '${sessionName}' not found. Run "xbrowser session open <url>" first.`
    );
  }

  const ctx: BrowserCommandContext = {
    page: session?.page as BrowserCommandContext['page'],
    browser: session?.context.browser() as BrowserCommandContext['browser'],
    browserContext: session?.context as BrowserCommandContext['browserContext'],
    sessionId: session?.id,
    cdpEndpoint: extraOpts?.cdpEndpoint || session?.cdpEndpoint,
    args: [],
    options: {},
    cwd: process.cwd(),
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
      keys: async () => [],
    },
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
    site: {} as never,
    cliName: 'xbrowser',
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

  try {
    const raw = await command.handler(params, ctx);
    const end = Date.now();
    const duration = end - start;

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
      const merged = [...(raw.tips || []), ...(smartTips || [])];
      return { ...ok(raw.data, merged.length > 0 ? merged : raw.tips), duration };
    }

    return { ...ok(raw, smartTips), duration };
  } catch (err) {
    const end = Date.now();
    const duration = end - start;
    const errorMessage = (err as Error).message;

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

    return { ...fail(errorMessage), duration };
  } finally {
    if (autoCreated && !extraOpts?.skipCleanup && !extraOpts?.cdpEndpoint) {
      await destroyBrowser();
    }
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
  let createdSession = false;
  if (!session) {
    const launchOpts: BrowserLaunchOptions = {};
    if (options?.cdpEndpoint) {
      launchOpts.cdpEndpoint = options.cdpEndpoint;
    }
    session = await createSession(sessionName, undefined, launchOpts);
    createdSession = true;
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
          const pluginParams: Record<string, unknown> = {};

          // Separate positional args from --flag args
          const positionalValues: string[] = [];
          for (let i = 0; i < pluginArgs.length; i++) {
            if (pluginArgs[i].startsWith('--')) {
              const key = pluginArgs[i].slice(2);
              const value = pluginArgs[i + 1];
              if (value && !value.startsWith('-')) {
                if (value === 'true') pluginParams[key] = true;
                else if (value === 'false') pluginParams[key] = false;
                else if (/^\d+$/.test(value)) pluginParams[key] = parseInt(value, 10);
                else pluginParams[key] = value;
                i++;
              } else {
                pluginParams[key] = true;
              }
            } else if (pluginArgs[i].startsWith('-') && pluginArgs[i].length === 2) {
              // short flag like -j for --json — skip (handled elsewhere)
            } else {
              positionalValues.push(pluginArgs[i]);
            }
          }

          // Map positional values to Zod schema params (with type coercion + unquoting)
          Object.assign(pluginParams, mapPositionalValues(cmdEntry.parameters!, positionalValues, pluginParams));

          const pluginCtx = {
            args: pluginArgs,
            options: pluginParams,
            cwd: process.cwd(),
            page: session!.page,
            browser: session!.context.browser()!,
            browserContext: session!.context,
            sessionId: session!.id,
            storage: {
              get: async <T>(_key: string): Promise<T | null> => null,
              set: async <T>(_key: string, _value: T): Promise<void> => {},
              delete: async (_key: string): Promise<void> => {},
              clear: async (): Promise<void> => {},
              keys: async (): Promise<string[]> => [],
            },
            output: { mode: 'text' as const, showTips: false, color: false, emoji: false },
            error: (msg: string) => { throw new Error(msg); },
            config: {},
            site,
            cliName: 'xbrowser',
          };

          const start = Date.now();
          try {
            const raw = await cmdEntry.handler(pluginParams, pluginCtx) as CommandResult;
            const duration = Date.now() - start;
            const data = raw?.data ?? raw;
            results.push({
              command: `${cmdName} ${subCommand}`,
              raw: cmdStr,
              ...ok(data),
              duration,
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
            const errorMessage = (err as Error).message;
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

        const { params } = parseCommandArgs(cmdName, cmdArgs);

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
    // CLI mode: always clean up so process can exit.
    // Daemon mode: keep sessions alive for reuse.
    if (process.env.XBROWSER_DAEMON_WORKER !== '1') {
      await destroyBrowser();
    } else if (createdSession) {
      // Daemon mode: only clean up if this chain created a new session
      // (sessions created by explicit 'session open' should persist)
      await destroyBrowser();
    }
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
  return /\s&&\s|\s;\s|\s,\s|\s\+\s|\s->\s/.test(input);
}
