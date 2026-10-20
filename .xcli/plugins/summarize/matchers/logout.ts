/**
 * logout 匹配器（设计 §5）。
 *
 * 触发信号：click 元素 text 含 退出/登出/logout/sign out（中英覆盖）。
 * 置信度：high（文案信号强）。
 * 字段：trigger(selector)。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

const LOGOUT_PATTERNS = ['退出', '登出', 'logout', 'sign out', 'signout'];

export const logoutMatcher: IntentMatcher = {
  intent: 'logout',
  match(segment: Segment): MatchResult | null {
    const act = segment.actions.find(a => {
      if (a.type !== 'click') return false;
      const text = (a.element?.text ?? '').toLowerCase();
      return LOGOUT_PATTERNS.some(p => text.includes(p));
    });
    if (!act || !act.element?.selector) return null;

    const fields: Record<string, FieldValue> = {
      trigger: {
        kind: 'selector',
        selector: act.element.selector,
        strategy: act.element.strategy ?? 'class',
        text: act.element.text ?? '',
      },
    };
    return {
      intent: 'logout',
      confidence: 'high',
      fields,
      reasoning: [`matched logout text "${act.element.text}" at action#${act.id}`],
    };
  },
};
