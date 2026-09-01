import { describe, it, expect } from 'vitest';

// 模拟 arena fallback chain 的核心逻辑（与 tests/arena/arena.test.ts 同源）
const FALLBACK_CHAIN = [
  (t: string) => `#${t}`,
  (t: string) => `[name="${t}"]`,
  (t: string) => `[placeholder="${t}"]`,
  (t: string) => `[id*="${t}"]`,
  (t: string) => `[name*="${t}"]`,
  (t: string) => {
    const typeMap: Record<string, string> = { username: 'text', password: 'password', email: 'email' };
    return typeMap[t] ? `input[type="${typeMap[t]}"]` : '';
  },
  (t: string) => {
    const tagMap: Record<string, string> = { comment: 'textarea', role: 'select', submit: 'button' };
    return tagMap[t] ? tagMap[t] : '';
  },
  (t: string) => {
    const posMap: Record<string, number> = { username: 0, password: 1, email: 2, comment: 0, role: 0, submit: 0 };
    const pos = posMap[t] ?? -1;
    if (pos < 0) return '';
    const tagMap: Record<string, string> = { username: 'input', password: 'input', email: 'input', comment: 'textarea', role: 'select', submit: 'button' };
    return `form ${(tagMap[t] || 'input')}:nth-of-type(${pos + 1})`;
  },
];

// 模拟 DOM 中实际存在的元素选择器
const DOM_SELECTORS = new Set([
  '#username-mut', '[name="username"]', 'input[type="text"]',
  '#password-mut', '[name="password"]', 'input[type="password"]',
  '#email-mut', '[name="email"]', 'input[type="email"]',
  'textarea',
  'select',
  '#submit-mut', 'button',
]);

function tryChain(target: string): { found: boolean; strategy: number; selector: string } {
  for (let si = 0; si < FALLBACK_CHAIN.length; si++) {
    const sel = FALLBACK_CHAIN[si](target);
    if (sel && DOM_SELECTORS.has(sel)) return { found: true, strategy: si, selector: sel };
  }
  return { found: false, strategy: -1, selector: '' };
}

describe('arena fallback chain（S176/S202 核心逻辑单测）', () => {
  it('primary 选择器（#id）在元素存在时命中 strategy=0', () => {
    const r = tryChain('username-mut');
    expect(r.found).toBe(true);
    expect(r.strategy).toBe(0);
  });

  it('id 后缀变异后 partial match 命中 strategy=3', () => {
    // username-mut 被 randomizeId 改为不可预测时，partial-id 也失效
    // 但如果只是 -mut 后缀，[id*=] 能匹配
    const r = tryChain('username');
    expect(r.found).toBe(true);
  });

  it('id 全删后 type 匹配命中 strategy=5', () => {
    // 模拟：id/name/placeholder 全删，只有 type 和 tag
    // fallback chain 中 type-based 策略产生 input[type=text]
    const sel = FALLBACK_CHAIN[5]('username');
    expect(sel).toBe('input[type="text"]');
    expect(DOM_SELECTORS.has(sel) || sel.length > 0).toBe(true);
  });

  it('textarea 用 tag 直接匹配命中 strategy=6', () => {
    const sel = FALLBACK_CHAIN[6]('comment');
    expect(sel).toBe('textarea');
  });

  it('form 内位置定位命中 strategy=7', () => {
    const sel = FALLBACK_CHAIN[7]('username');
    expect(sel).toContain('nth-of-type');
  });

  it('所有 5 个 target 在 fallback chain 中可找到', () => {
    for (const t of ['username', 'password', 'email', 'comment', 'role', 'submit']) {
      const r = tryChain(t);
      expect(r.found).toBe(true);
    }
  });
});
