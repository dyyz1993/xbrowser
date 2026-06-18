/**
 * navigate 匹配器（设计 §5）—— 兜底匹配器。
 *
 * 触发信号：纯 navigation/goto，无其他强操作。
 * 置信度：medium（导航是明确意图，优先级低只因信号弱——它排最后兜底，
 *   但置信度不该是 low，否则 recognizeIntent 的"非 low 才返回"规则会让它
 *   永远落到 unknown）。
 * 字段：from（段起始 url）、to（段结束 url）。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

export const navigateMatcher: IntentMatcher = {
  intent: 'navigate',
  match(segment: Segment): MatchResult | null {
    const acts = segment.actions;
    const navCount = acts.filter(a => a.type === 'navigation' || a.type === 'goto').length;
    // 纯导航：导航动作占主体，且没有 input/click 等强操作
    const hasStrong = acts.some(a =>
      a.type === 'input' || a.type === 'filechooser' ||
      (a.type === 'click' && a.element?.type !== undefined),
    );
    if (navCount === 0 || hasStrong) return null;

    const fields: Record<string, FieldValue> = {
      from: { kind: 'url', value: segment.startUrl },
      to: { kind: 'url', value: segment.endUrl },
    };
    return {
      intent: 'navigate',
      confidence: 'medium',
      fields,
      reasoning: [`${navCount} navigation action(s), no strong ops`],
    };
  },
};
