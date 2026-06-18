import { describe, it, expect } from 'vitest';
import { preprocess } from '../../.xcli/plugins/summarize/pipeline/preprocess.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';

/** 造一个最小可用的 UserAction，用 over 覆盖关键字段。 */
const mkAction = (over: Partial<UserAction>): UserAction => ({
  id: 1,
  type: 'click',
  timestamp: 0,
  url: 'https://x.com',
  pageTitle: '',
  ...over,
});

describe('preprocess (去噪 + 合并)', () => {
  // ─── 去噪 ──────────────────────────────────────────
  it('drops noise actions: scroll/hover/keyup/focus/visibility/resize/touch', () => {
    const out = preprocess([
      mkAction({ id: 1, type: 'click' }),
      mkAction({ id: 2, type: 'scroll' }),
      mkAction({ id: 3, type: 'hover' }),
      mkAction({ id: 4, type: 'keyup', key: 'a' }),
      mkAction({ id: 5, type: 'focus', focus: { focusType: 'focus' } }),
      mkAction({ id: 6, type: 'visibility', visibility: { state: 'hidden' } }),
      mkAction({ id: 7, type: 'resize', resize: { width: 100, height: 100 } }),
      mkAction({ id: 8, type: 'touch', touch: { touchType: 'start', touches: [] } }),
      mkAction({ id: 9, type: 'click' }),
    ]);
    expect(out.map(a => a.id)).toEqual([1, 9]);
  });

  // ─── 合并相邻 input（同 selector） ─────────────────
  it('merges adjacent inputs on same selector, keeps last value', () => {
    const out = preprocess([
      mkAction({ id: 1, type: 'input', element: { tag: 'input', selector: '#u', text: '' }, value: 'a' }),
      mkAction({ id: 2, type: 'input', element: { tag: 'input', selector: '#u', text: '' }, value: 'ab' }),
      mkAction({ id: 3, type: 'input', element: { tag: 'input', selector: '#u', text: '' }, value: 'abc' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('abc');
    // 保留第一个的 id（稳定标识），但值取最新
    expect(out[0].id).toBe(1);
  });

  it('does NOT merge inputs on different selectors', () => {
    const out = preprocess([
      mkAction({ id: 1, type: 'input', element: { tag: 'input', selector: '#u', text: '' }, value: 'a' }),
      mkAction({ id: 2, type: 'input', element: { tag: 'input', selector: '#p', text: '' }, value: 'b' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does NOT merge inputs separated by another action', () => {
    const out = preprocess([
      mkAction({ id: 1, type: 'input', element: { tag: 'input', selector: '#u', text: '' }, value: 'a' }),
      mkAction({ id: 2, type: 'click' }), // 中间隔了 click
      mkAction({ id: 3, type: 'input', element: { tag: 'input', selector: '#u', text: '' }, value: 'b' }),
    ]);
    expect(out).toHaveLength(3);
  });

  // ─── 保留有意义的 action ───────────────────────────
  it('keeps click/input/navigation/filechooser/paste/keydown intact', () => {
    const out = preprocess([
      mkAction({ id: 1, type: 'click' }),
      mkAction({ id: 2, type: 'input', value: 'x' }),
      mkAction({ id: 3, type: 'navigation' }),
      mkAction({ id: 4, type: 'filechooser', files: { names: ['a.png'], count: 1, isMultiple: false } }),
      mkAction({ id: 5, type: 'paste', clipboard: { operation: 'paste' } }),
      mkAction({ id: 6, type: 'keydown', key: 'Enter' }),
    ]);
    expect(out).toHaveLength(6);
  });

  // ─── CDP 类型归一化 ────────────────────────────────
  it('normalizes cdp-fill→input, cdp-click→click, cdp-eval→eval', () => {
    const out = preprocess([
      mkAction({ id: 1, type: 'cdp-fill', element: { tag: 'input', selector: '#u', text: '' }, value: 'a' }),
      mkAction({ id: 2, type: 'cdp-click', element: { tag: 'button', selector: '#b', text: 'ok' } }),
      mkAction({ id: 3, type: 'cdp-eval', value: '1+1' }),
    ]);
    expect(out[0].type).toBe('input');
    expect(out[1].type).toBe('click');
    expect(out[2].type).toBe('eval');
  });

  // ─── 边界情况 ──────────────────────────────────────
  it('returns empty array for empty input', () => {
    expect(preprocess([])).toEqual([]);
  });

  it('returns single action unchanged', () => {
    const a = mkAction({ id: 1, type: 'click' });
    expect(preprocess([a])).toEqual([a]);
  });

  it('handles action with missing element gracefully (no merge crash)', () => {
    const out = preprocess([
      mkAction({ id: 1, type: 'input', value: 'a' }), // 无 element
      mkAction({ id: 2, type: 'input', value: 'b' }), // 无 element
    ]);
    // 无 element 时无法判断同 selector，不合并，各自保留
    expect(out).toHaveLength(2);
  });
});
