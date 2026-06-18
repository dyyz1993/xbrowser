import { describe, it, expect, beforeEach } from 'vitest';
import { recognizeIntent, _resetMatchersForTest } from '../../.xcli/plugins/summarize/matchers/index.js';
import '../../.xcli/plugins/summarize/matchers/register-builtin.js';
import '../../.xcli/plugins/summarize/matchers/register-more.js';
import type { Segment } from '../../.xcli/plugins/summarize/types.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';

const mkSeg = (actions: Partial<UserAction>[], url = 'https://chatgpt.com/c/1'): Segment => ({
  id: 's1', site: 'chatgpt.com', boundaries: [],
  startUrl: url, endUrl: url,
  actions: actions.map((a, i) => ({
    id: i + 1, type: 'click', timestamp: i * 100, url, pageTitle: '', ...a,
  })) as UserAction[],
  durationMs: 1000,
});

describe('chat matcher (发消息/AI 对话)', () => {
  beforeEach(() => _resetMatchersForTest());

  it('matches textarea input + send button click', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'textarea', selector: '#prompt-textarea', text: '' }, value: '你好' },
      { type: 'click', element: { tag: 'button', selector: '#composer-submit-button', text: '发送' } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('chat');
    expect(r.fields.message).toMatchObject({ kind: 'text', value: '你好', selector: '#prompt-textarea' });
    expect(r.fields.sendBtn).toMatchObject({ kind: 'selector', selector: '#composer-submit-button' });
  });

  it('matches input + Enter keydown', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'textarea', selector: '#input', text: '' }, value: '问题' },
      { type: 'keydown', key: 'Enter' },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('chat');
    expect(r.fields.sendMethod).toMatchObject({ kind: 'text', value: 'Enter' });
  });

  it('does not match without send action (just typing)', () => {
    const seg = mkSeg([
      { type: 'input', element: { tag: 'textarea', selector: '#input', text: '' }, value: '写了没发' },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).not.toBe('chat');
  });

  it('chat takes priority over form-submit (has send button/Enter)', () => {
    // 单个 input + 发送：chat 比 form-submit 更具体（form-submit 要 ≥2 input）
    const seg = mkSeg([
      { type: 'input', element: { tag: 'textarea', selector: '#msg', text: '' }, value: 'hi' },
      { type: 'click', element: { tag: 'button', selector: '#send', text: '发送' } },
    ]);
    const r = recognizeIntent(seg);
    expect(r.intent).toBe('chat');
  });
});
