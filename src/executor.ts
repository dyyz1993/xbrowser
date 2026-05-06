import { isCommandResult } from '@dyyz1993/xcli-core';
import { getCommand, getAllCommands } from './commands/index.js';
import type { BrowserCommandContext } from './context.js';
import { findSession, createSession, destroyBrowser, type ManagedSession, type BrowserLaunchOptions } from './browser.js';
import {
  parseCommandChain,
  splitCommand,
  parseCommandArgs,
} from './chain-parser.js';
import type { WSServer, CommandMessage } from './websocket-server.js';

/**
 * Result of a single command execution.
 */
export interface ExecutionResult {
  success: boolean;
  data: unknown;
  message?: string;
  duration: number;
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
  return { success: false, data: null, message, duration: 0 };
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
  sessionName: string = 'default'
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
  }

  let session: ManagedSession;
  const existing = findSession(sessionName);
  if (!existing) {
    return errorResult(
      `Session '${sessionName}' not found. Run "xbrowser session open <url>" first.`
    );
  }
  session = existing;

  const ctx: BrowserCommandContext = {
    page: session.page,
    browser: session.context.browser()!,
    browserContext: session.context,
    sessionId: session.id,
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

  streamCommandEvent(session.id, {
    sessionId: session.id,
    command: commandName,
    args: Object.values(params),
    phase: 'before',
    timestamp: start,
  });

  try {
    const raw = await command.handler(params, ctx);
    const end = Date.now();
    const duration = end - start;

    if (isCommandResult(raw)) {
      streamCommandEvent(session.id, {
        sessionId: session.id,
        command: commandName,
        args: Object.values(params),
        phase: 'after',
        result: raw.data,
        timestamp: end,
        duration,
      });
      return { ...raw, duration };
    }

    streamCommandEvent(session.id, {
      sessionId: session.id,
      command: commandName,
      args: Object.values(params),
      phase: 'after',
      result: raw,
      timestamp: end,
      duration,
    });
    return { success: true, data: raw, duration };
  } catch (err) {
    const end = Date.now();
    const duration = end - start;
    const errorMessage = (err as Error).message;

    streamCommandEvent(session.id, {
      sessionId: session.id,
      command: commandName,
      args: Object.values(params),
      phase: 'after',
      error: errorMessage,
      timestamp: end,
      duration,
    });

    return {
      success: false,
      data: null,
      message: errorMessage,
      duration,
    };
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

  let session = findSession(sessionName);
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
        const { params } = parseCommandArgs(cmdName, cmdArgs);

        if (cmdName === 'goto' && params.url) {
          const existing2 = findSession(sessionName);
          if (!existing2) {
            session = await createSession(sessionName, params.url as string, {
              cdpEndpoint: options?.cdpEndpoint,
            });
          }
        }

        const start = Date.now();
        const result = await executeCommand(cmdName, params, sessionName);
        const duration = Date.now() - start;

        const stepResult: ChainStepResult = {
          command: cmdName,
          raw: cmdStr,
          success: result.success,
          data: result.data,
          message: result.message,
          duration,
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
    if (createdSession) {
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
