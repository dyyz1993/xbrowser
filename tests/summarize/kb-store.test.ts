import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeFlow, readFlow, appendChange, listFlows, initKb,
} from '../../.xcli/plugins/summarize/kb/store.js';
import type { Topic, ChangeEntry } from '../../.xcli/plugins/summarize/types.js';

const mkTopic = (over: Partial<Topic> = {}): Topic => ({
  id: 'x.com-login-0',
  site: 'x.com',
  intent: 'login',
  confidence: 'high',
  segments: [],
  fields: {
    username: { kind: 'text', value: 'bob', selector: '#user', confidence: 'high' },
    passwordInput: { kind: 'selector', selector: '#pw', strategy: 'attribute', text: '' },
    submitBtn: { kind: 'selector', selector: '#sub', strategy: 'class', text: '登录' },
  },
  ...over,
});

describe('kb/store (知识库读写)', () => {
  let kbRoot: string;
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    kbRoot = mkdtempSync(join(tmpdir(), 'kb-test-'));
    initKb(kbRoot, 'x.com');
  });
  afterEach(() => {
    rmSync(kbRoot, { recursive: true, force: true });
  });

  it('writeFlow creates file with correct frontmatter + body + 变更历史', () => {
    const change: ChangeEntry = {
      date: today, version: 1, command: 'summarize', type: 'created',
      sourceSession: 'sess-a', summary: '首次沉淀：识别为 login',
    };
    writeFlow(kbRoot, mkTopic(), '示例正文', [change]);

    const flowPath = join(kbRoot, 'x.com', 'flows', 'login.md');
    expect(existsSync(flowPath)).toBe(true);
    const content = readFileSync(flowPath, 'utf8');
    // frontmatter
    expect(content).toContain('flow: login');
    expect(content).toContain('site: x.com');
    expect(content).toContain('intent: login');
    expect(content).toContain('version: 1');
    expect(content).toContain(`lastVerified: ${today}`);
    expect(content).toContain('sources:');
    // 正文
    expect(content).toContain('示例正文');
    // 变更历史
    expect(content).toContain('## 变更历史');
    expect(content).toContain('summarize');
    expect(content).toContain('首次沉淀');
  });

  it('readFlow parses frontmatter + body + changes', () => {
    const change: ChangeEntry = {
      date: today, version: 1, command: 'summarize', type: 'created',
      sourceSession: 'sess-a', summary: '首次沉淀',
    };
    writeFlow(kbRoot, mkTopic(), '正文内容', [change]);
    const parsed = readFlow(kbRoot, 'x.com', 'login');
    expect(parsed.frontmatter.flow).toBe('login');
    expect(parsed.frontmatter.site).toBe('x.com');
    expect(parsed.frontmatter.intent).toBe('login');
    expect(parsed.frontmatter.version).toBe(1);
    expect(parsed.body).toContain('正文内容');
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.changes[0].type).toBe('created');
  });

  it('appendChange increments version and adds row', () => {
    const c1: ChangeEntry = {
      date: today, version: 1, command: 'summarize', type: 'created',
      sourceSession: 'sess-a', summary: '首次',
    };
    writeFlow(kbRoot, mkTopic(), '正文', [c1]);

    const c2: ChangeEntry = {
      date: today, version: 2, command: 'reindex', type: 'auto-reindex',
      sourceSession: 'sess-b', summary: 'selector 漂移：.btn→#btn',
    };
    appendChange(kbRoot, 'x.com', 'login', c2);

    const parsed = readFlow(kbRoot, 'x.com', 'login');
    expect(parsed.frontmatter.version).toBe(2);
    expect(parsed.changes).toHaveLength(2);
    expect(parsed.changes[1].summary).toContain('selector 漂移');
  });

  it('listFlows returns flow names', () => {
    writeFlow(kbRoot, mkTopic(), '正文', [{
      date: today, version: 1, command: 'summarize', type: 'created', summary: 'x',
    }]);
    writeFlow(kbRoot, mkTopic({ id: 'x.com-upload-1', intent: 'upload' }), '正文2', [{
      date: today, version: 1, command: 'summarize', type: 'created', summary: 'x',
    }]);
    const flows = listFlows(kbRoot, 'x.com');
    expect(flows).toEqual(expect.arrayContaining(['login', 'upload']));
  });

  it('脱敏：password 明文不入文件（fields 不含密码值）', () => {
    // Topic 的 fields 里本来就不该有密码明文（login matcher 已脱敏），
    // 但 store 写入时再兜底检查一次：正文里不应出现疑似密码值
    const topic = mkTopic({
      fields: {
        passwordInput: { kind: 'selector', selector: '#pw', strategy: 'attribute', text: '' },
      },
    });
    writeFlow(kbRoot, topic, '正文（无密码）', [{
      date: today, version: 1, command: 'summarize', type: 'created', summary: 'x',
    }]);
    const content = readFileSync(join(kbRoot, 'x.com', 'flows', 'login.md'), 'utf8');
    // 没有 kind:'text' 的 password 字段
    expect(content).not.toMatch(/password.*secret/i);
  });
});
