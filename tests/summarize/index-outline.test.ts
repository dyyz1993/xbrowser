import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIndexOutline, renderIndex, renderOutline } from '../../.xcli/plugins/summarize/render/index-outline.js';
import { writeFlow, initKb } from '../../.xcli/plugins/summarize/kb/store.js';
import type { Topic, ChangeEntry } from '../../.xcli/plugins/summarize/types.js';

const today = new Date().toISOString().slice(0, 10);
const mkTopic = (intent: string): Topic => ({
  id: `x.com-${intent}-0`, site: 'x.com', intent: intent as Topic['intent'],
  confidence: 'high', segments: [], fields: {},
});
const change = (over: Partial<ChangeEntry> = {}): ChangeEntry => ({
  date: today, version: 1, command: 'summarize', type: 'created', summary: 'x', ...over,
});

describe('index-outline (模板生成)', () => {
  let kbRoot: string;
  beforeEach(() => {
    kbRoot = mkdtempSync(join(tmpdir(), 'kb-io-'));
    initKb(kbRoot, 'x.com');
  });
  afterEach(() => rmSync(kbRoot, { recursive: true, force: true }));

  it('INDEX has header with date/count/sources + one-line summary', () => {
    writeFlow(kbRoot, mkTopic('login'), '正文', [change({ sourceSession: 'sess-a' })], ['sess-a']);
    writeFlow(kbRoot, mkTopic('upload'), '正文', [change({ sourceSession: 'sess-a' })], ['sess-a']);
    const idx = renderIndex(kbRoot, 'x.com', ['login', 'upload']);
    expect(idx).toContain(`最后更新：${today}`);
    expect(idx).toContain('2 个功能');
    expect(idx).toContain('sess-a');
    expect(idx).toContain('登录');
    expect(idx).toContain('上传');
  });

  it('OUTLINE groups by category with links', () => {
    writeFlow(kbRoot, mkTopic('login'), '正文', [change()]);
    writeFlow(kbRoot, mkTopic('logout'), '正文', [change()]);
    writeFlow(kbRoot, mkTopic('search'), '正文', [change()]);
    const out = renderOutline(kbRoot, 'x.com', ['login', 'logout', 'search']);
    expect(out).toContain('## 账号');
    expect(out).toContain('## 浏览');
    expect(out).toContain('[登录](flows/login.md)');
    expect(out).toContain('[登出](flows/logout.md)');
    expect(out).toContain('[搜索](flows/search.md)');
  });

  it('writeIndexOutline writes both files', () => {
    writeFlow(kbRoot, mkTopic('login'), '正文', [change()]);
    writeIndexOutline(kbRoot, 'x.com', ['login']);
    const { readFileSync } = require('node:fs');
    expect(readFileSync(join(kbRoot, 'x.com', 'INDEX.md'), 'utf8')).toContain('操作索引');
    expect(readFileSync(join(kbRoot, 'x.com', 'OUTLINE.md'), 'utf8')).toContain('功能大纲');
  });

  it('empty flows → graceful placeholder', () => {
    const idx = renderIndex(kbRoot, 'x.com', []);
    expect(idx).toContain('暂无');
  });
});
