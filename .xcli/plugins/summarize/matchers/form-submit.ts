/**
 * form-submit 匹配器（设计 §5）。
 *
 * 触发信号：≥2 个 input 填充 + 后续 submit/click button。
 * 置信度：medium（表单信号中等，可能是任意填报）。
 * 字段：fields（各 input 的 label+value+selector）。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

export const formSubmitMatcher: IntentMatcher = {
  intent: 'form-submit',
  match(segment: Segment): MatchResult | null {
    const acts = segment.actions;
    const inputs = acts.filter(a =>
      a.type === 'input' && a.element?.tag === 'input' && a.element?.type !== 'password',  // 排除密码（归 login）
    );
    if (inputs.length < 2) return null;

    // 末尾要有 submit 动作（click button）
    const lastClick = [...acts].reverse().find(a => a.type === 'click' && a.element?.tag === 'button');
    if (!lastClick) return null;

    const fields: Record<string, FieldValue> = {};
    const fieldList: Array<{ label: string; value: string; selector?: string }> = [];
    for (const inp of inputs) {
      fieldList.push({
        label: inp.element?.placeholder || inp.element?.ariaLabel || inp.element?.name || inp.element?.selector || 'field',
        value: inp.value ?? '',
        selector: inp.element?.selector,
      });
    }
    fields.fields = { kind: 'text', value: JSON.stringify(fieldList), confidence: 'medium' };

    return {
      intent: 'form-submit',
      confidence: 'medium',
      fields,
      reasoning: [`${inputs.length} inputs + submit click at action#${lastClick.id}`],
    };
  },
};
