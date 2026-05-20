import { outputFormatter, OutputFormatter } from '@dyyz1993/xcli-core';

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
  process.exit(1);
}

/**
 * Output a success message with optional formatting.
 * Uses xcli-core 0.9.0 OutputFormatter.formatSuccess().
 */
export function outputSuccess(message: string): void {
  const formatted = formatter.formatSuccess(message, { color: true, emoji: false });
  console.log(formatted);
}
