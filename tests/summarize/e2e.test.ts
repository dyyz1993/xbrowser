import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSummarize } from '../../.xcli/plugins/summarize/pipeline/run.js';
import '../../.xcli/plugins/summarize/matchers/register-builtin.js';
import '../../.xcli/plugins/summarize/matchers/register-more.js';
import { _resetMatchersForTest } from '../../.xcli/plugins/summarize/matchers/index.js';

const __dirname_e2e = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname_e2e, 'fixtures');

describe('summarize 端到端', () => {
  let kbRoot: string;
  beforeEach(() => {
    _resetMatchersForTest();
    kbRoot = mkdtempSync(join(tmpdir(), 'kb-e2e-'));
  });
  afterEach(() => rmSync(kbRoot, { recursive: true, force: true }));

  it('--dry-run：识别出 login + upload 两个主题，不写库', async () => {
    const result = await runSummarize({
      session: 'e2e-sample',
      sessionsRoot: FIXTURE_DIR,
      kbRoot,
      noLlm: true,
      dryRun: true,
    });
    expect(result.totalActions).toBe(6);
    expect(result.topics).toHaveLength(2);
    const intents = result.topics.map(t => t.intent);
    expect(intents).toEqual(expect.arrayContaining(['login', 'upload']));
    expect(result.written).toEqual([]);  // dry-run 不写
  });

  it('正式跑：写库 + 生成 flows/INDEX/OUTLINE + frontmatter + 变更历史', async () => {
    const result = await runSummarize({
      session: 'e2e-sample',
      sessionsRoot: FIXTURE_DIR,
      kbRoot,
      noLlm: true,  // 测试环境无 LLM
    });
    expect(result.written).toEqual(expect.arrayContaining(['login', 'upload']));

    // flow 文件存在
    const loginPath = join(kbRoot, 'juejin.cn', 'flows', 'login.md');
    expect(existsSync(loginPath)).toBe(true);
    const loginContent = readFileSync(loginPath, 'utf8');
    expect(loginContent).toContain('flow: login');
    expect(loginContent).toContain('intent: login');
    expect(loginContent).toContain('version: 1');
    expect(loginContent).toContain('## 变更历史');
    expect(loginContent).toContain('首次沉淀');

    // INDEX/OUTLINE 存在
    expect(existsSync(join(kbRoot, 'juejin.cn', 'INDEX.md'))).toBe(true);
    expect(existsSync(join(kbRoot, 'juejin.cn', 'OUTLINE.md'))).toBe(true);
    const index = readFileSync(join(kbRoot, 'juejin.cn', 'INDEX.md'), 'utf8');
    expect(index).toContain('juejin.cn');
    expect(index).toContain('2 个功能');
    expect(index).toContain('登录');
  });

  it('脱敏：密码明文不落库', async () => {
    await runSummarize({
      session: 'e2e-sample', sessionsRoot: FIXTURE_DIR, kbRoot, noLlm: true,
    });
    const loginContent = readFileSync(join(kbRoot, 'juejin.cn', 'flows', 'login.md'), 'utf8');
    expect(loginContent).not.toContain('testpass123');
  });
});
