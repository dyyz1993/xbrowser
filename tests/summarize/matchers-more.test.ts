import { describe, it, expect, beforeEach } from 'vitest';
import { recognizeIntent, _resetMatchersForTest } from '../../.xcli/plugins/summarize/matchers/index.js';
import '../../.xcli/plugins/summarize/matchers/register-builtin.js';
import '../../.xcli/plugins/summarize/matchers/register-more.js';  // Task 6 的三个
import type { Segment } from '../../.xcli/plugins/summarize/types.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';

const mkSeg = (actions: Partial<UserAction>[], url = 'https://x.com'): Segment => ({
  id: 's1', site: 'x.com', boundaries: [],
  startUrl: url, endUrl: url,
  actions: actions.map((a, i) => ({
    id: i + 1, type: 'click', timestamp: i * 100, url, pageTitle: '', ...a,
  })) as UserAction[],
  durationMs: 1000,
});

describe('form-submit matcher', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches 2+ inputs + submit (medium confidence)', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'input', selector: '#name', text: '', placeholder: '姓名' }, value: '张三' },
      { type: 'input', element: { tag: 'input', selector: '#email', text: '', placeholder: '邮箱' }, value: 'a@b.com' },
      { type: 'click', element: { tag: 'button', selector: '#save', text: '保存' } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('form-submit');
    expect(r.confidence).toBe('medium');
    expect(r.fields.fields).toBeDefined();
  });

  it('does NOT match single input (not a form)', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'input', selector: '#x', text: '' }, value: 'hi' },
      { type: 'click', element: { tag: 'button', selector: '#b', text: 'ok' } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).not.toBe('form-submit');
  });
});

describe('navigate matcher', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches pure navigation segment (medium confidence fallback)', () => {
    const seg = mkSeg([
      { type: 'navigation', url: 'https://x.com/a' },
      { type: 'navigation', url: 'https://x.com/b' },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('navigate');
    expect(r.confidence).toBe('medium');
  });

  it('extracts from/to', () => {
    const seg: Segment = {
      id: 's1', site: 'x.com', boundaries: [],
      startUrl: 'https://x.com/a', endUrl: 'https://x.com/b',
      actions: [{ id: 1, type: 'navigation', timestamp: 0, url: 'https://x.com/b', pageTitle: '' }],
      durationMs: 0,
    };
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('navigate');
    expect(r.fields.from).toMatchObject({ kind: 'url', value: 'https://x.com/a' });
    expect(r.fields.to).toMatchObject({ kind: 'url', value: 'https://x.com/b' });
  });
});

describe('menu-interact matcher', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches click followed by popup context (medium)', () => {
    const seg = mkSeg([
      { type: 'click', element: { tag: 'button', selector: '.menu', text: '菜单' },
        clickContext: { appeared: [{ tag: 'a', text: '编辑', href: '#' }, { tag: 'a', text: '删除', href: '#' }], disappeared: [], stateChanges: [] } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('menu-interact');
    expect(r.confidence).toBe('medium');
    expect(r.fields.menuItems).toBeDefined();
    const items = (r.fields.menuItems as { kind: string; names: string[] }).names;
    expect(items).toEqual(expect.arrayContaining(['编辑', '删除']));
  });

  it('does NOT match click without popup context', () => {
    const seg = mkSeg([
      { type: 'click', element: { tag: 'button', selector: '.btn', text: '点我' } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).not.toBe('menu-interact');
  });
});
