/**
 * Shared utility: extract user-written code from CDP messages
 *
 * Playwright wraps ALL user code in `utilityScript.evaluate(...args)`.
 * The actual user code is serialized as a string VALUE in the arguments array.
 *
 * Arguments structure:
 *   [utilityScript_ref, returnByValue?, generatePreview?, userCode, ...]
 *
 * For string expressions (page.evaluate('expr')), userCode is just the string.
 * For functions (page.evaluate(() => {...})), userCode is "() => {...}".
 *
 * This utility extracts ALL string values from args so rules can check them.
 *
 * IMPORTANT: Playwright internally injects large utility scripts via
 * Runtime.evaluate (e.g., __commonJS, module.exports bundles). These must
 * be filtered out so we don't false-positive on Playwright's own code.
 */

import type { RuleContext } from '../types.js';

const PLAYWRIGHT_INTERNAL_MARKERS = [
  '__commonJS',
  'module.exports',
  '__require',
  '__toESM',
  'inject_utils',
];

function isPlaywrightInternal(code: string): boolean {
  return PLAYWRIGHT_INTERNAL_MARKERS.some(marker => code.includes(marker));
}

export function extractUserCode(ctx: RuleContext): string | null {
  if (ctx.method === 'Runtime.evaluate') {
    const expr = ctx.params.expression;
    if (typeof expr === 'string') {
      if (isPlaywrightInternal(expr)) return null;
      return expr;
    }
  }

  if (ctx.method === 'Runtime.callFunctionOn') {
    const decl = ctx.params.functionDeclaration;
    if (typeof decl === 'string' && decl.includes('utilityScript.evaluate')) {
      return extractAllStrings(ctx.params.arguments);
    }
    if (typeof decl === 'string') return decl;
  }

  return null;
}

function extractAllStrings(rawArgs: unknown): string | null {
  if (!Array.isArray(rawArgs)) return null;

  const strings: string[] = [];

  for (const arg of rawArgs) {
    if (arg && typeof arg === 'object' && 'value' in arg) {
      const val = (arg as Record<string, unknown>).value;
      if (typeof val === 'string' && val.length > 5 && !['true', 'false'].includes(val)) {
        strings.push(val);
      }
    }
  }

  return strings.length > 0 ? strings.join('\n') : null;
}

/**
 * S190: 探针标记检测——测试/观测流量显式声明 `/* @xb-probe *\/`，
 * 规则引擎跳过对应字面量拦截（探针目的即验证伪装行为）。
 * 生产流量不应使用此标记。
 */
export function isProbeMarked(code: string): boolean {
  return code.includes('/* @xb-probe */');
}
