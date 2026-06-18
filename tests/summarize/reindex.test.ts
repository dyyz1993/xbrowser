import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reindex, assessAlign, diffTopicVsFlow } from '../../.xcli/plugins/summarize/pipeline/reindex.js';
import { writeFlow, readFlow, initKb } from '../../.xcli/plugins/summarize/kb/store.js';
import type { Topic, ChangeEntry } from '../../.xcli/plugins/summarize/types.js';

const today = new Date().toISOString().slice(0, 10);
const mkTopic = (over: Partial<Topic> = {}): Topic => ({
  id: 'x.com-login-0', site: 'x.com', intent: 'login', confidence: 'high',
  segments: [], fields: {}, ...over,
});
const change = (v = 1): ChangeEntry => ({
  date: today, version: v, command: 'summarize', type: 'created', summary: '首次', sourceSession: 'sess-a',
});

describe('reindex (改版重建)', () => {
  let kbRoot: string;
  beforeEach(() => { kbRoot = mkdtempSync(join(tmpdir(), 'kb-rix-')); initKb(kbRoot, 'x.com'); });
  afterEach(() => rmSync(kbRoot, { recursive: true, force: true }));

  it('assessAlign: same intent + url overlap → high', () => {
    writeFlow(kbRoot, mkTopic(), '## 登录\n\n### 关键元素\n\n| submitBtn | .btn | class |', [change()], ['sess-a']);
    const flow = readFlow(kbRoot, 'x.com', 'login');
    const topic = mkTopic({ segments: [{ id: 's', site: 'x.com', boundaries: [], startUrl: 'https://x.com/login', endUrl: 'https://x.com/login', actions: [], durationMs: 0 }] });
    expect(assessAlign(topic, flow)).toBe('high');
  });

  it('assessAlign: different intent → none', () => {
    writeFlow(kbRoot, mkTopic(), '正文', [change()]);
    const flow = readFlow(kbRoot, 'x.com', 'login');
    const topic = mkTopic({ intent: 'upload' });
    expect(assessAlign(topic, flow)).toBe('none');
  });

  it('diffTopicVsFlow: detects selector drift', () => {
    writeFlow(kbRoot, mkTopic(), '## 登录\n\n### 关键元素\n\n| submitBtn | .login-btn | class | 登录 |', [change()]);
    const flow = readFlow(kbRoot, 'x.com', 'login');
    const newTopic = mkTopic({
      fields: { submitBtn: { kind: 'selector', selector: '#sign-in-btn', strategy: 'id', text: '登录' } },
    });
    const diff = diffTopicVsFlow(newTopic, flow);
    expect(diff.selectorChanges).toHaveLength(1);
    expect(diff.selectorChanges[0]).toMatchObject({
      role: 'submitBtn', oldSelector: '.login-btn', newSelector: '#sign-in-btn',
    });
  });

  it('reindex: updates existing flow on align, appends change with version bump', () => {
    writeFlow(kbRoot, mkTopic(), '## 登录\n\n### 关键元素\n\n| submitBtn | .login-btn | class | 登录 |', [change()], ['sess-a']);
    const newTopic = mkTopic({
      intent: 'login',
      fields: { submitBtn: { kind: 'selector', selector: '#sign-in-btn', strategy: 'id', text: '登录' } },
      segments: [{ id: 's', site: 'x.com', boundaries: [], startUrl: 'https://x.com/login', endUrl: 'https://x.com/login', actions: [], durationMs: 0 }],
    });
    const result = reindex(kbRoot, 'x.com', [newTopic], ['login'], 'sess-b');
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].flow).toBe('login');
    expect(result.updated[0].diff.selectorChanges[0].newSelector).toBe('#sign-in-btn');

    const updated = readFlow(kbRoot, 'x.com', 'login');
    expect(updated.frontmatter.version).toBe(2);
    expect(updated.changes).toHaveLength(2);
    expect(updated.changes[1].type).toBe('auto-reindex');
    expect(updated.changes[1].summary).toContain('#sign-in-btn');
  });

  it('reindex: unaligned intent → created (not touching old)', () => {
    writeFlow(kbRoot, mkTopic({ intent: 'login' }), '正文', [change()]);
    const newTopic = mkTopic({ intent: 'search' });
    const result = reindex(kbRoot, 'x.com', [newTopic], ['login'], 'sess-b');
    expect(result.created).toContain('search');
    expect(result.updated).toHaveLength(0);
  });
});
