/**
 * S203 生产竞技场 — 直连生产 SessionReplayer 的真实自愈率测量
 *
 * 此前 8 级攻击 100% 自愈率的结论测的是测试文件内部重新实现的影子链
 * （tests/arena/arena.test.ts 的 FALLBACK_CHAIN），生产代码 healResolve
 * 从未被竞技场攻击打过。本文件修正这一点：
 *
 *   1. 构造真实 recording JSON（原始选择器 = 变异前的 #username-<pfx> 等）
 *   2. 对页面施加 DOM 攻击
 *   3. 用 new SessionReplayer({ page, selfHealing: true }) 真回放
 *   4. 度量两个指标：
 *        actionSuccess   — replayAction 不抛错的比例（传统指标）
 *        semanticCorrect — 值真正落进对的字段的比例（wrong-target 检测）
 *
 * 已知生产链缺陷（本文件存在的原因，修复后此处指标应上升）：
 *   - resolveAndWait 的 tag 兜底（element.tag='input' 恒可解析）会拦截
 *     healResolve，且把值填进页面第一个同 tag 元素 → wrong-target
 *   - 文档承诺的 x/y 坐标兜底未实现
 *   - extractSemanticCore 对 class 类选择器返回空
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';
import { SessionReplayer } from '../../src/recorder/session-replayer.js';
import type { UserAction } from '../../src/recorder/recording-types.js';
import { buildTargetPage, MUTATIONS, LEVELS, SEMANTIC_EXPECTED } from './shared.js';
import fs from 'fs';
import path from 'path';

const TIMEOUT = 180_000;
const ARCHIVE_DIR = 'output/arena';

// ── 录制 JSON 构造（模拟录制器的真实产物：element.tag 必填）──

function buildRecording(prefix: string, targetPath: string): { actions: UserAction[] } {
  let id = 0;
  const mk = (
    type: UserAction['type'],
    selector: string,
    tag: string,
    value?: string,
    text?: string,
    meta?: { type?: string; placeholder?: string },
  ): UserAction => {
    id += 1;
    return {
      id, type, timestamp: Date.now() + id * 1000,
      url: `file://${targetPath}`, pageTitle: `Arena ${prefix}`,
      element: { tag, selector, text: text ?? '', ...meta },
      ...(value !== undefined ? { value } : {}),
    };
  };
  return {
    actions: [
      // meta 与真实录制器一致：实捕 type/placeholder 属性快照（cron r2 起参与 heal）
      mk('input', `#username-${prefix}`, 'input', 'arena-user', undefined, { type: 'text', placeholder: 'Username' }),
      mk('input', `#password-${prefix}`, 'input', 'arena-pass-123', undefined, { type: 'password', placeholder: 'Password' }),
      mk('input', `#email-${prefix}`, 'input', 'arena@test.com', undefined, { type: 'email', placeholder: 'Email' }),
      mk('input', `#comment-${prefix}`, 'textarea', 'arena comment'),
      mk('change', `#role-${prefix}`, 'select', 'admin'),
      mk('click', `#submit-${prefix}`, 'button', undefined, 'Login', { type: 'button' }),
    ],
  };
}

interface RoundReport {
  level: string;
  round: number;
  actionResult: { success: number; failed: number; skipped: number };
  healed: Array<{ index: number; strategy: string }>;
  errors: Array<{ index: number; error: string }>;
  values: Record<string, string>;
  semanticCorrect: number;
  semanticTotal: number;
  semanticRate: number;
  at: string;
}

describe('生产竞技场：SessionReplayer 直连', { timeout: TIMEOUT }, () => {
  let browser: XBBrowser;
  let page: XBPage;
  let lastTargetPath = '';

  beforeAll(async () => {
    const result = await launch({ headless: true, args: ['--no-sandbox'] });
    browser = result.browser;
    const context = await browser.newContext();
    page = await context.newPage();
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
    try { fs.unlinkSync(lastTargetPath); } catch { /* best-effort */ }
  }, 30_000);

  async function runLevel(level: string, round: number): Promise<RoundReport> {
    const prefix = `p${round}_${level}`;
    const targetPath = path.join('/tmp', `arena-prod-${prefix}.html`);
    lastTargetPath = targetPath;
    fs.writeFileSync(targetPath, buildTargetPage(prefix, { preventSubmit: true }));
    await page.goto(`file://${targetPath}`);
    await page.waitForTimeout(300);

    const recording = buildRecording(prefix, targetPath);

    // 先施加攻击（录制的是变异前的选择器，攻击模拟站点改版）
    for (const key of LEVELS[level] ?? []) {
      const mut = MUTATIONS[key];
      if (mut) await page.evaluate(`/* @xb-probe */ (function(){ ${mut.fn} })()`);
    }
    await page.waitForTimeout(100);

    const healed: Array<{ index: number; strategy: string }> = [];
    const errors: Array<{ index: number; error: string }> = [];
    const replayer = new SessionReplayer({
      page,
      selfHealing: true,
      stepDelay: 50,
      stepTimeout: 3000,
      onHealed: (action, strategy, index) => healed.push({ index, strategy }),
      onError: (action, err, index) => errors.push({ index, error: err.message }),
    });
    await replayer.load(recording);
    const actionResult = await replayer.run();
    await replayer.close();

    // 语义校验：值是否落进对的字段（data-arena 变异不会触碰）
    const values = await page.evaluate<Record<string, string>>(`/* @xb-probe */ (function(){
      var out = {};
      document.querySelectorAll('[data-arena]').forEach(function(el){ out[el.getAttribute('data-arena')] = el.value; });
      return out;
    })()`);
    const semanticKeys = Object.keys(SEMANTIC_EXPECTED);
    const semanticCorrect = semanticKeys.filter(
      k => (values as Record<string, string>)[k] === SEMANTIC_EXPECTED[k],
    ).length;

    const report: RoundReport = {
      level,
      round,
      actionResult,
      healed,
      errors,
      values,
      semanticCorrect,
      semanticTotal: semanticKeys.length,
      semanticRate: Math.round(semanticCorrect / semanticKeys.length * 100),
      at: new Date().toISOString(),
    };
    fs.mkdirSync(path.resolve(ARCHIVE_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(ARCHIVE_DIR, `production-${level}.json`),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `[production:${level}] actions ${actionResult.success}/${actionResult.success + actionResult.failed}` +
      `  semantic ${report.semanticCorrect}/${report.semanticTotal} (${report.semanticRate}%)` +
      `  healed=${healed.length} errors=${errors.length}`,
    );
    return report;
  }

  it('基线：无攻击时动作与语义双 100%', async () => {
    const report = await runLevel('none', 0);
    expect(report.actionResult.failed).toBe(0);
    expect(report.semanticCorrect).toBe(report.semanticTotal);
  });

  it('light 攻击（仅改 id）：partial-id 语义自愈接住全部 input', async () => {
    const report = await runLevel('light', 1);
    expect(report.actionResult.success + report.actionResult.failed).toBe(6);
    // tag 兜底收紧后（cron r1）：#id 变异 → healResolve partial-id 命中，
    // 三个 input 全部找对字段
    expect(report.semanticCorrect).toBe(5);
  });

  it('medium 攻击（改 id+class+包裹层）', async () => {
    const report = await runLevel('medium', 2);
    expect(report.actionResult.success + report.actionResult.failed).toBe(6);
    expect(report.semanticCorrect).toBe(5);
  });

  it('aggressive 攻击（+删 name+删 placeholder）', async () => {
    const report = await runLevel('aggressive', 3);
    expect(report.actionResult.success + report.actionResult.failed).toBe(6);
    expect(report.semanticCorrect).toBe(5);
  });

  it('extreme2 攻击（id 随机化+删 id+name 随机化）', async () => {
    const report = await runLevel('extreme2', 10);
    expect(report.actionResult.success + report.actionResult.failed).toBe(6);
    // cron r2：coreId 全灭后 meta-type 候选（input[type=password/email/text]）
    // 确定性消歧三个 input
    expect(report.semanticCorrect).toBe(5);
  });

  it('nuclear 攻击（全变异叠加）', async () => {
    const report = await runLevel('nuclear', 20);
    expect(report.actionResult.success + report.actionResult.failed).toBe(6);
    expect(report.semanticCorrect).toBe(5);
  });

  it('apocalypse 攻击（全变异+重排+删 class+元素替换）', async () => {
    const report = await runLevel('apocalypse', 21);
    expect(report.actionResult.success + report.actionResult.failed).toBe(6);
    // meta-type 是内容定位不依赖文档序，shuffleForm 随机重排不影响
    expect(report.semanticCorrect).toBe(5);
  });

  it('生产归档完整（含 semanticRate 与 healed 明细）', () => {
    const files = fs.readdirSync(path.resolve(ARCHIVE_DIR)).filter(f => f.startsWith('production-'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8')) as Partial<RoundReport>;
      expect(data).toHaveProperty('semanticRate');
      expect(data).toHaveProperty('healed');
      expect(data).toHaveProperty('actionResult');
    }
  });
});
