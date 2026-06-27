import { outputFormatter, OutputFormatter, type Tip } from '@dyyz1993/xcli-core';

const formatter = new OutputFormatter();

/**
 * 统一输出函数 — 委托给 xcli-core 的 outputFormatter。
 *
 * 默认 mode="text"（框架控制），只有 --json / --yaml 时才切换。
 * 应用层不需要感知默认值，也不应该自己实现格式化逻辑。
 */
export function outputResult(result: unknown, mode: string = 'text'): void {
  // 错误结果统一走 outputError
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if (r.success === false) {
      outputError(r.message ? String(r.message) : 'Unknown error');
    }
    if (r.ok === false) {
      outputError(r.error ? String(r.error) : 'Unknown error');
    }
  }

  const output = outputFormatter.format(result, {
    mode: mode as 'text' | 'json' | 'yaml',
    color: mode === 'text',
    emoji: false,
  });
  console.log(output);
}

export function outputError(message: string): void {
  const formatted = formatter.formatError(message, { color: true, emoji: false });
  console.error(formatted);
  // Use process.exitCode instead of process.exit(1): process.exit() doesn't
  // halt synchronous execution — cli.ts's finally block still runs and would
  // override the exit code to 0 with its own process.exit(). process.exitCode
  // communicates the intent without exiting, so cli.ts can pick it up in its
  // final cleanup via process.exit(process.exitCode || exitCode).
  process.exitCode = 1;
}

/**
 * Output a success message with optional formatting.
 * Uses xcli-core 0.9.0 OutputFormatter.formatSuccess().
 */
export function outputSuccess(message: string): void {
  const formatted = formatter.formatSuccess(message, { color: true, emoji: false });
  console.log(formatted);
}

/**
 * Metadata for the outputEnvelope wrapper.
 */
export interface OutputEnvelopeMeta {
  /** Command name (e.g. "goto", "click", "session list") */
  command: string;
  /** Active tab index, if applicable */
  tab?: number;
  /** Additional meta fields (viewerUrl, totalSteps, etc.) */
  [key: string]: unknown;
}

/**
 * 统一 JSON 信封输出——所有 --json / --yaml 输出的唯一入口。
 *
 * 委托给 xcli-core 0.19.0 的 `OutputFormatter.formatEnvelope()`（底层 issue #47），
 * 保证所有基于 xcli-core 的 CLI 工具信封格式一致。
 *
 * 产生一致的信封格式：
 * ```json
 * {
 *   "success": true,
 *   "command": "goto",
 *   "data": { ... },
 *   "error": null,
 *   "meta": { "duration": 1234 }
 * }
 * ```
 *
 * - text 模式：退化为当前 behavior（成功输出 data，失败输出 error）
 * - json/yaml 模式：包装成统一信封后输出
 * - tips 始终输出到 stderr（不混入 stdout）
 */
export function outputEnvelope(
  result: {
    success: boolean;
    data: unknown;
    message?: string;
    tips?: Array<Tip | string>;
    duration?: number;
    hookOutputs?: Array<Record<string, unknown>>;
  },
  meta: OutputEnvelopeMeta,
  mode: string,
): void {
  if (mode !== 'json' && mode !== 'yaml') {
    // Text mode: current behavior (data on success, error on failure)
    if (!result.success) {
      outputError(result.message || 'Unknown error');
      return;
    }
    outputResult(result.data, mode);
    return;
  }

  // JSON/YAML mode: delegate to xcli-core 0.19.0 formatEnvelope
  // xbrowser's ExecutionResult has top-level `duration`, but CommandResult.meta
  // expects it under `meta`. Map it here.
  const { command, ...extraMeta } = meta;
  const commandResult = {
    success: result.success,
    data: result.data,
    message: result.message,
    tips: [],
    meta: {
      duration: result.duration ?? 0,
      ...extraMeta,
    },
  };

  const formatted = outputFormatter.formatEnvelope(commandResult, {
    command,
    extraMeta,
    mode: mode as 'json' | 'yaml',
  });
  console.log(formatted);

  // Tips always go to stderr in JSON/YAML mode
  if (result.tips?.length) {
    for (const tip of result.tips) {
      const text = typeof tip === 'string' ? tip : (tip as { message?: string }).message;
      if (text) console.error(`  \u{1F4A1} ${text}`);
    }
  }
}
