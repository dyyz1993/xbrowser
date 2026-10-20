/**
 * search 匹配器（设计 §5）。
 *
 * 触发信号（任一）：
 *   - input 的 placeholder/ariaLabel 含 搜索/search
 *   - url 含 /search
 * 置信度：medium（信号中等，搜索框也可能用于他途）。
 * 字段：query(value)、searchBox(selector)。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

const SEARCH_HINTS = ['搜索', 'search'];

export const searchMatcher: IntentMatcher = {
  intent: 'search',
  match(segment: Segment): MatchResult | null {
    const acts = segment.actions;

    // 信号1：input 的 placeholder/ariaLabel/selector 含搜索关键词
    const inputAct = acts.find(a => {
      if (a.type !== 'input' || !a.element) return false;
      const hints = [a.element.placeholder, a.element.ariaLabel, a.element.selector]
        .filter(Boolean) as string[];
      return hints.some(h => SEARCH_HINTS.some(s => h.toLowerCase().includes(s)));
    });

    // 信号2：url 含 /search
    const urlAct = !inputAct ? acts.find(a => {
      try { return new URL(a.url).pathname.toLowerCase().includes('search'); } catch { return false; }
    }) : undefined;

    const source = inputAct ?? urlAct;
    if (!source) return null;

    const fields: Record<string, FieldValue> = {};
    if (source.element?.selector) {
      fields.searchBox = {
        kind: 'selector',
        selector: source.element.selector,
        strategy: source.element.strategy ?? 'attribute',
        text: source.element.text ?? '',
      };
    }
    if (source.value) {
      fields.query = { kind: 'text', value: source.value, selector: source.element?.selector, confidence: 'high' };
    }

    const reason = inputAct
      ? `search input by placeholder/aria-label at action#${inputAct.id}`
      : `search by url path at action#${urlAct!.id}`;
    return { intent: 'search', confidence: 'medium', fields, reasoning: [reason] };
  },
};
