/**
 * menu-interact 匹配器（设计 §5）。
 *
 * 触发信号：click 后 clickContext.appeared 非空（点了按钮弹出菜单/下拉）。
 * 置信度：medium（弹窗信号中等）。
 * 字段：menuItems(texts)、container(selector)。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

export const menuInteractMatcher: IntentMatcher = {
  intent: 'menu-interact',
  match(segment: Segment): MatchResult | null {
    const act = segment.actions.find(a =>
      a.type === 'click' && a.clickContext && a.clickContext.appeared.length > 0,
    );
    if (!act || !act.clickContext) return null;

    const items = act.clickContext.appeared.map(it => it.text).filter(Boolean);
    if (items.length === 0) return null;

    const fields: Record<string, FieldValue> = {
      menuItems: { kind: 'files', names: items },  // 复用 names 数组语义
    };
    if (act.element?.selector) {
      fields.container = {
        kind: 'selector',
        selector: act.element.selector,
        strategy: act.element.strategy ?? 'class',
        text: act.element.text ?? '',
      };
    }

    return {
      intent: 'menu-interact',
      confidence: 'medium',
      fields,
      reasoning: [`${items.length} menu items appeared after click#${act.id}: ${items.join(', ')}`],
    };
  },
};
