import { describe, it, expect, beforeEach } from 'vitest';
import { recognizeIntent, _resetMatchersForTest, registerMatcher } from '../../.xcli/plugins/summarize/matchers/index.js';
import '../../.xcli/plugins/summarize/matchers/register-builtin.js';  // 自注册内置匹配器
import type { Segment } from '../../.xcli/plugins/summarize/types.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';

const mkSeg = (actions: Partial<UserAction>[]): Segment => ({
  id: 's1', site: 'x.com', boundaries: [],
  startUrl: 'https://x.com', endUrl: 'https://x.com',
  actions: actions.map((a, i) => ({
    id: i + 1, type: 'click', timestamp: i * 100, url: 'https://x.com', pageTitle: '', ...a,
  })) as UserAction[],
  durationMs: 1000,
});

describe('login matcher', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches password input + submit (high confidence), extracts fields', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'input', type: 'text', selector: '#user', text: '', placeholder: '账号' }, value: 'bob' },
      { type: 'input', element: { tag: 'input', type: 'password', selector: '#pw', text: '' }, value: 'secret123' },
      { type: 'click', element: { tag: 'button', selector: '#sub', text: '登录' } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('login');
    expect(r.confidence).toBe('high');
    expect(r.fields.username).toMatchObject({ kind: 'text', value: 'bob', selector: '#user' });
    expect(r.fields.passwordInput).toMatchObject({ kind: 'selector', selector: '#pw' });
    expect(r.fields.submitBtn).toMatchObject({ kind: 'selector', selector: '#sub' });
    // 密码值脱敏：不落明文
    expect(JSON.stringify(r.fields)).not.toContain('secret123');
  });

  it('does not match without password input', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'input', type: 'text', selector: '#x', text: '' }, value: 'hi' },
      { type: 'click', element: { tag: 'button', selector: '#b', text: 'ok' } },
    ]);
    // 无 password → 不该判成 login（可能被 form-submit 接走，但绝不是 login）
    const r = recognizeIntent(seg);
    expect(r.intent).not.toBe('login');
  });
});

describe('logout matcher', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches click element with logout text', () => {
    for (const text of ['退出', '登出', 'logout', 'Sign Out', '退出登录']) {
      const seg = mkSeg([{ type: 'click', element: { tag: 'a', selector: '.out', text } }]);
      const r = recognizeIntent(seg);
      expect(r.intent).toBe('logout');
      expect(r.fields.trigger).toMatchObject({ kind: 'selector', selector: '.out' });
    }
  });
});

describe('search matcher', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches search by placeholder + Enter', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'input', selector: '#q', text: '', placeholder: '搜索内容' }, value: 'react hooks' },
      { type: 'keydown', key: 'Enter' },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('search');
    expect(r.fields.query).toMatchObject({ kind: 'text', value: 'react hooks', selector: '#q' });
  });

  it('matches search by url containing /search', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'input', selector: '#q', text: '' }, value: 'vue', url: 'https://x.com/search?q=vue' },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('search');
  });
});

describe('upload matcher', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches filechooser, extracts file names', () => {
    const seg = mkSeg([
      { type: 'click', element: { tag: 'button', selector: '.add', text: '添加' } },
      { type: 'filechooser', files: { names: ['a.png', 'b.jpg'], count: 2, isMultiple: true } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('upload');
    expect(r.confidence).toBe('high');
    expect(r.fields.files).toMatchObject({ kind: 'files', names: ['a.png', 'b.jpg'] });
    expect(r.fields.trigger).toMatchObject({ kind: 'selector', selector: '.add' });
  });

  it('matches input with files property', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'input', type: 'file', selector: '#f', text: '' }, files: { names: ['doc.pdf'], count: 1, isMultiple: false } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('upload');
  });
});
