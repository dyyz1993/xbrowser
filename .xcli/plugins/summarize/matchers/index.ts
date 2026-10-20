/**
 * 规则层意图匹配 —— 注册机制 + 调度（设计 §5）。
 *
 * 所有意图匹配器（IntentMatcher）注册到这里，recognizeIntent 按优先级遍历：
 *   - 命中非 low confidence 即返回
 *   - 全部未命中或都是 low → 返回 unknown
 *
 * 注册顺序 = 优先级 = 信号强度（password 最独特，login 排最前；navigate 最弱，兜底）。
 * 站点专属匹配器通过 prepend 插到最前（设计 §5.4，进阶）。
 *
 * 这是整个方案的"确定性智能核心"：所有切分、合并、对齐都依赖这里产出的
 * intent 和 fields，可单测、可调试。
 */
import type { Segment, IntentMatcher, MatchResult } from '../types.js';

/** 内置匹配器注册表（按优先级，index 0 最高）。 */
const builtins: IntentMatcher[] = [];

/** 用户/测试临时注入的匹配器（prepend 到最前，优先级高于内置）。 */
const injected: IntentMatcher[] = [];

export interface RegisterOptions {
  /** 插到最前（优先级最高）。默认 false（追加到末尾）。 */
  prepend?: boolean;
}

/**
 * 注册一个匹配器。主要用于测试注入和（未来）站点专属匹配器加载。
 * 内置匹配器在各自模块文件里调用此函数自注册。
 */
export function registerMatcher(m: IntentMatcher, opts: RegisterOptions = {}): void {
  if (opts.prepend) {
    injected.unshift(m);
  } else {
    builtins.push(m);
  }
}

/** 仅供测试重置（避免用例间污染）。 */
export function _resetMatchersForTest(): void {
  injected.length = 0;
  // builtins 不清空（内置的稳定）
}

/**
 * 对单个 Segment 跑意图识别。
 * 按优先级遍历匹配器，命中非 low confidence 即返回；否则 unknown 兜底。
 */
export function recognizeIntent(segment: Segment): MatchResult {
  const chain = [...injected, ...builtins];
  for (const m of chain) {
    const r = m.match(segment);
    if (r && r.confidence !== 'low') {
      return r;
    }
  }
  return {
    intent: 'unknown',
    confidence: 'low',
    fields: {},
    reasoning: ['no matcher matched'],
  };
}
