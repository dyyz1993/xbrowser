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
import os from 'os';

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
  healedCount: number;
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

  async function runLevel(
    level: string,
    round: number,
    opts: {
      expected?: Record<string, string>;
      recordingFactory?: (prefix: string, targetPath: string) =>
        { actions: UserAction[] } | Promise<{ actions: UserAction[] }>;
      preMutation?: string;
      healKnowledgeDir?: string;
    } = {},
  ): Promise<RoundReport> {
    const prefix = `p${round}_${level}`;
    const targetPath = path.join('/tmp', `arena-prod-${prefix}.html`);
    lastTargetPath = targetPath;
    fs.writeFileSync(targetPath, buildTargetPage(prefix, { preventSubmit: true }));
    await page.goto(`file://${targetPath}`);
    await page.waitForTimeout(300);

    const recording = opts.recordingFactory
      ? await opts.recordingFactory(prefix, targetPath)
      : buildRecording(prefix, targetPath);

    // 先施加攻击（录制的是变异前的选择器，攻击模拟站点改版）
    if (opts.preMutation) {
      await page.evaluate(`/* @xb-probe */ (function(){ ${opts.preMutation} })()`);
    }
    for (const key of LEVELS[level] ?? []) {
      const mut = MUTATIONS[key];
      if (mut) await page.evaluate(`/* @xb-probe */ (function(){ ${mut.fn} })()`);
    }
    await page.waitForTimeout(100);

    const healed: Array<{ index: number; strategy: string }> = [];
    const errors: Array<{ index: number; error: string }> = [];
    // 默认按轮次隔离知识库且每轮清空（防跨调用串扰改写策略断言）；
    // 显式传入可跨轮共享（r10 双轮回放），由调用方管理生命周期
    const kbDir = opts.healKnowledgeDir ?? path.join(ARCHIVE_DIR, 'heal-kb', String(round));
    if (!opts.healKnowledgeDir) fs.rmSync(kbDir, { recursive: true, force: true });
    const replayer = new SessionReplayer({
      page,
      selfHealing: true,
      stepDelay: 50,
      stepTimeout: 3000,
      healKnowledgeDir: kbDir,
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
    const expected = opts.expected ?? SEMANTIC_EXPECTED;
    const semanticKeys = Object.keys(expected);
    const semanticCorrect = semanticKeys.filter(
      k => (values as Record<string, string>)[k] === expected[k],
    ).length;

    const report: RoundReport = {
      level,
      round,
      actionResult,
      healedCount: actionResult.healed,
      healed,
      errors,
      values,
      semanticCorrect,
      semanticTotal: semanticKeys.length,
      semanticRate: semanticKeys.length ? Math.round(semanticCorrect / semanticKeys.length * 100) : 100,
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

  it('class-primary 录制 + class 后缀改版（partial-class 语义自愈）', async () => {
    // 无 id/name/placeholder、无 type 属性的字段——只有 class 带语义。
    // 无 partial-class 时全部候选 miss → 盲位置候选落进 form1 的 username
    // （0/2）；有修复时 class 核心 [class*="search-box"] 确定性命中（2/2）。
    const report = await runLevel('none', 30, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: (pfx, targetPath) => {
        let cid = 0;
        const mk = (type: UserAction['type'], selector: string, value?: string, text?: string): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: { tag: selector.endsWith('btn-secondary') ? 'button' : 'input', selector, text: text ?? '' },
            ...(value !== undefined ? { value } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', 'arena search'),
            mk('input', '.qty-box', '3'),
            mk('click', '.btn-secondary', undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className
            .replace('search-box', 'search-box-v2')
            .replace('qty-box', 'qty-box-v2')
            .replace('btn-secondary', 'btn-secondary-v2');
        });
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.semanticCorrect).toBe(2);
    expect(report.healed.some(h => h.strategy === 'partial-class')).toBe(true);
  });

  it('属性全灭（无 id/name/placeholder/type + 删 class）：坐标兜底恢复 fill', async () => {
    // 删 class 后 form2 字段的所有属性信号归零，录制的 x/y（元素中心）是
    // 唯一幸存信号。无坐标兜底时盲位置候选落进 form1（0/2）；有兜底时
    // elementFromPoint 反解路径确定性命中（2/2）。
    const report = await runLevel('none', 40, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        // 录制时刻取元素中心（真实录制器记录的就是 clientX/clientY）
        const centers = await page.evaluate<Record<string, { x: number; y: number }>>(`/* @xb-probe */ (function(){
          var out = {};
          ['search','qty','go'].forEach(function(k){
            var r = document.querySelector('[data-arena="' + k + '"]').getBoundingClientRect();
            out[k] = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          });
          return out;
        })()`);
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string,
          at?: { x: number; y: number }, value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: { tag: selector.endsWith('btn-secondary') ? 'button' : 'input', selector, text: text ?? '' },
            ...(value !== undefined ? { value } : {}),
            ...(at ? { x: at.x, y: at.y } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', centers.search, 'arena search'),
            mk('input', '.qty-box', centers.qty, '3'),
            mk('click', '.btn-secondary', centers.go, undefined, 'Go'),
          ],
        };
      },
      preMutation: `document.querySelectorAll('[class]').forEach(function(el){ el.removeAttribute('class'); });`,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.semanticCorrect).toBe(2);
    // r15 起文案锚点（干净命中）优先于坐标层接管 click：两个 fill 走 coords
    expect(report.healed.filter(h => h.strategy === 'coords').length).toBe(2);
    expect(report.healed[2].strategy).toBe('text-anchor');
  });

  it('布局位移 + 属性全灭：录制序号（ordinal）恢复定位', async () => {
    // 2000px spacer 插入使录制的视口坐标全部失效（elementFromPoint 指到
    // spacer，tag 守卫拒绝）；删 class 后结构序号是唯一幸存信号。
    const report = await runLevel('none', 50, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        // 录制时刻快照：元素中心坐标 + 结构序号（对齐 r6 录制器 describe 产物）
        const snap = await page.evaluate<Record<string, { x: number; y: number; formNth: number; tagNth: number }>>(`/* @xb-probe */ (function(){
          var out = {};
          ['search','qty','go'].forEach(function(k){
            var el = document.querySelector('[data-arena="' + k + '"]');
            var r = el.getBoundingClientRect();
            var form = el.closest('form');
            var formSibs = Array.prototype.filter.call(form.parentElement.children, function(c){ return c.tagName === 'FORM'; });
            var tagSibs = Array.prototype.filter.call(form.children, function(c){ return c.tagName === el.tagName; });
            out[k] = {
              x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
              formNth: formSibs.indexOf(form) + 1, tagNth: tagSibs.indexOf(el) + 1,
            };
          });
          return out;
        })()`);
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string,
          s: { x: number; y: number; formNth: number; tagNth: number },
          value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: {
              tag: selector.endsWith('btn-secondary') ? 'button' : 'input',
              selector, text: text ?? '',
              ordinal: { formNth: s.formNth, tagNth: s.tagNth },
            },
            ...(value !== undefined ? { value } : {}),
            x: s.x, y: s.y,
          };
        };
        return {
          actions: [
            mk('input', '.search-box', snap.search, 'arena search'),
            mk('input', '.qty-box', snap.qty, '3'),
            mk('click', '.btn-secondary', snap.go, undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){ el.removeAttribute('class'); });
        var sp = document.createElement('div'); sp.style.height = '2000px';
        document.body.insertBefore(sp, document.body.firstChild);
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.semanticCorrect).toBe(2);
    // r15 起文案锚点接管 click（干净命中优先）：两个 fill 仍走 ordinal
    expect(report.healed.filter(h => h.strategy === 'ordinal').length).toBe(2);
    expect(report.healed[2].strategy).toBe('text-anchor');
    expect(report.healed.filter(h => h.strategy === 'coords').length).toBe(0);
  });

  it('heal 指纹校验：decoy 间谍按钮（同类名异文案）不再静默吞点击', async () => {
    // class 后缀改版 + 页首注入 decoy（class 含 btn-secondary、文案 Cancel、
    // 点击清空全部字段）。无指纹校验时 partial-class 命中 decoy（文档序在前）
    // →字段被清空→语义 0/2；有校验时文案正性矛盾被拒，落到 meta-type/coords
    // 命中真 Go→语义 2/2。
    const report = await runLevel('none', 60, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        const centers = await page.evaluate<Record<string, { x: number; y: number }>>(`/* @xb-probe */ (function(){
          var out = {};
          ['search','qty','go'].forEach(function(k){
            var r = document.querySelector('[data-arena="' + k + '"]').getBoundingClientRect();
            out[k] = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          });
          return out;
        })()`);
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string,
          at?: { x: number; y: number }, value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: {
              tag: selector.endsWith('btn-secondary') ? 'button' : 'input',
              selector, text: text ?? '',
              ...(selector.endsWith('btn-secondary') ? { type: 'button' } : {}),
            },
            ...(value !== undefined ? { value } : {}),
            ...(at ? { x: at.x, y: at.y } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', undefined, 'arena search'),
            mk('input', '.qty-box', undefined, '3'),
            mk('click', '.btn-secondary', centers.go, undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className
            .replace('search-box', 'search-box-v2')
            .replace('qty-box', 'qty-box-v2')
            .replace('btn-secondary', 'btn-secondary-v2');
        });
        var f0 = document.createElement('form');
        f0.style.position = 'fixed'; f0.style.bottom = '0'; f0.style.left = '0';
        var d = document.createElement('button');
        d.className = 'btn-secondary-v2'; d.type = 'button'; d.textContent = 'Cancel';
        d.addEventListener('click', function(){
          document.querySelectorAll('[data-arena]').forEach(function(e){ e.value = ''; });
        });
        f0.appendChild(d);
        document.body.insertBefore(f0, document.body.firstChild);
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.semanticCorrect).toBe(2);
    // r25 起逐匹配消歧：partial-class 在 [诱饵(文案软), 真按钮(干净)] 中
    // 直接选中真按钮——三个动作全部 partial-class，无需落到 text-anchor
    expect(report.healed.filter(h => h.strategy === 'partial-class').length).toBe(3);
    expect(report.healed[2].strategy).toBe('partial-class');
  });

  it('文案改版 + 布局位移：text 软矛盾降级备选，不弃正确元素', async () => {
    // Go 按钮文案改为 'Sign in now'（text 指纹软矛盾）+ class 后缀改版 +
    // 2000px spacer（coords 失效）。硬拒时代点击全链耗尽而失败（healed=2）；
    // 软降级后 partial-class 命中真 Go（文案可疑但结构正确）→3/3、2/2。
    const report = await runLevel('none', 70, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        const centers = await page.evaluate<Record<string, { x: number; y: number }>>(`/* @xb-probe */ (function(){
          var out = {};
          ['search','qty','go'].forEach(function(k){
            var r = document.querySelector('[data-arena="' + k + '"]').getBoundingClientRect();
            out[k] = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          });
          return out;
        })()`);
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string,
          at?: { x: number; y: number }, value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: {
              tag: selector.endsWith('btn-secondary') ? 'button' : 'input',
              selector, text: text ?? '',
              ...(selector.endsWith('btn-secondary') ? { type: 'button' } : {}),
            },
            ...(value !== undefined ? { value } : {}),
            ...(at ? { x: at.x, y: at.y } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', undefined, 'arena search'),
            mk('input', '.qty-box', undefined, '3'),
            mk('click', '.btn-secondary', centers.go, undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className
            .replace('search-box', 'search-box-v2')
            .replace('qty-box', 'qty-box-v2')
            .replace('btn-secondary', 'btn-secondary-v2');
        });
        var go = document.querySelector('[data-arena="go"]');
        go.textContent = 'Sign in now';
        var sp = document.createElement('div'); sp.style.height = '2000px';
        document.body.insertBefore(sp, document.body.firstChild);
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.semanticCorrect).toBe(2);
    expect(report.healed.length).toBe(3);
    expect(report.healed[2].strategy).toBe('partial-class~soft');
  });

  it('遮挡层攻击：被盖克隆按钮被跳过，heal 找到未遮挡真目标', async () => {
    // 同类名同文案同 type 的克隆按钮被 mini-overlay 盖住（文档序在前）。
    // 无遮挡校验时 partial-class 命中克隆→resolve 成功→driver actionability
    // 拒绝→动作失败；有校验时克隆被即时跳过，meta-type 软备选（Login）未
    // 被盖→点击成功。判别点：actionResult.failed 1→0。
    const report = await runLevel('none', 80, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string, value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: {
              tag: selector.endsWith('btn-secondary') ? 'button' : 'input',
              selector, text: text ?? '',
              ...(selector.endsWith('btn-secondary') ? { type: 'button' } : {}),
            },
            ...(value !== undefined ? { value } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', 'arena search'),
            mk('input', '.qty-box', '3'),
            mk('click', '.btn-secondary', undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className
            .replace('search-box', 'search-box-v2')
            .replace('qty-box', 'qty-box-v2')
            .replace('btn-secondary', 'btn-secondary-v2');
        });
        var clone = document.createElement('button');
        clone.className = 'btn-secondary-v2'; clone.type = 'button'; clone.textContent = 'Go';
        clone.style.cssText = 'position:fixed;top:0;left:0;width:120px;height:40px;';
        document.body.insertBefore(clone, document.body.firstChild);
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:60px;z-index:9999;';
        ov.addEventListener('click', function(){
          document.querySelectorAll('[data-arena]').forEach(function(e){ e.value = ''; });
        });
        document.body.insertBefore(ov, document.body.children[1]);
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.actionResult.failed).toBe(0);
    expect(report.semanticCorrect).toBe(2);
    expect(report.healed.filter(h => h.strategy === 'partial-class').length).toBe(2);
  });

  it('heal 知识复用：二次回放 known-heal 零成本命中', async () => {
    // 同一场景回放两轮、共享知识库：首轮现场推理（partial-class）并写回；
    // 次轮主选择器一失效即查库直取已验证修复（known-heal×3）。
    const kbDir = path.join(os.tmpdir(), `heal-kb-r90-${Date.now()}`);
    const classOpts = (round: number) => ({
      expected: { search: 'arena search', qty: '3' },
      healKnowledgeDir: kbDir,
      recordingFactory: async (pfx: string, targetPath: string) => {
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string, value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000 + round,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: {
              tag: selector.endsWith('btn-secondary') ? 'button' : 'input',
              selector, text: text ?? '',
              ...(selector.endsWith('btn-secondary') ? { type: 'button' } : {}),
            },
            ...(value !== undefined ? { value } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', 'arena search'),
            mk('input', '.qty-box', '3'),
            mk('click', '.btn-secondary', undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className
            .replace('search-box', 'search-box-v2')
            .replace('qty-box', 'qty-box-v2')
            .replace('btn-secondary', 'btn-secondary-v2');
        });
      `,
    });

    const run1 = await runLevel('none', 91, classOpts(91));
    expect(run1.actionResult.failed).toBe(0);
    expect(run1.healed.length).toBe(3);
    expect(run1.healed.some(h => h.strategy === 'known-heal')).toBe(false);

    const run2 = await runLevel('none', 92, classOpts(92));
    expect(run2.actionResult.failed).toBe(0);
    expect(run2.semanticCorrect).toBe(2);
    expect(run2.healed.filter(h => h.strategy === 'known-heal').length).toBe(3);
    // r13: run() 返回值带 healed 统计（daemon 透传链路的源头）
    expect(run2.healedCount).toBe(3);

    expect(fs.existsSync(path.join(kbDir, 'heals-file.json'))).toBe(true);
    fs.rmSync(kbDir, { recursive: true, force: true });
  });

  it('知识库生命周期：陈旧映射遗忘后落入常规链并重新写回', async () => {
    // 预埋陈旧映射（healed 指向不存在的元素）：known-heal 校验失败应遗忘，
    // 常规链重新 heal（partial-class）并把正确映射写回同一键
    const kbDir = path.join(os.tmpdir(), `heal-kb-r100-${Date.now()}`);
    fs.mkdirSync(kbDir, { recursive: true });
    const craft = {
      '.search-box': { healed: '#nonexistent-xyz', strategy: 'partial-class', lastSeen: new Date().toISOString(), hits: 3 },
    };
    fs.writeFileSync(path.join(kbDir, 'heals-file.json'), JSON.stringify(craft, null, 2));

    const report = await runLevel('none', 100, {
      expected: { search: 'arena search', qty: '3' },
      healKnowledgeDir: kbDir,
      recordingFactory: async (pfx: string, targetPath: string) => {
        let cid = 0;
        const mk = (type: UserAction['type'], selector: string, value?: string): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: { tag: 'input', selector, text: '' },
            ...(value !== undefined ? { value } : {}),
          };
        };
        return {
          actions: [mk('input', '.search-box', 'arena search'), mk('input', '.qty-box', '3')],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className.replace('search-box', 'search-box-v2').replace('qty-box', 'qty-box-v2');
        });
      `,
    });

    expect(report.actionResult.failed).toBe(0);
    expect(report.semanticCorrect).toBe(2);
    // known-heal 未采用（陈旧映射被遗忘），常规链 partial-class 接管
    expect(report.healed.filter(h => h.strategy === 'partial-class').length).toBe(2);

    const kb = JSON.parse(fs.readFileSync(path.join(kbDir, 'heals-file.json'), 'utf8'));
    expect(kb['.search-box'].healed).toBe('[class*="search-box"]'); // 正确映射覆盖陈旧值
    fs.rmSync(kbDir, { recursive: true, force: true });
  });

  it('知识库生命周期：TTL 超期条目在写入时剪枝', async () => {
    const kbDir = path.join(os.tmpdir(), `heal-kb-r101-${Date.now()}`);
    fs.mkdirSync(kbDir, { recursive: true });
    const daysAgo = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString();
    fs.writeFileSync(path.join(kbDir, 'heals-file.json'), JSON.stringify({
      '.stale-old': { healed: '#old', strategy: 'partial-class', lastSeen: daysAgo(40), hits: 9 },
      '.fresh-entry': { healed: '#fresh', strategy: 'meta-type', lastSeen: daysAgo(1), hits: 2 },
    }, null, 2));

    await runLevel('none', 101, {
      expected: { search: 'arena search', qty: '3' },
      healKnowledgeDir: kbDir,
      recordingFactory: async (pfx: string, targetPath: string) => {
        let cid = 0;
        const mk = (type: UserAction['type'], selector: string, value?: string): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: { tag: 'input', selector, text: '' },
            ...(value !== undefined ? { value } : {}),
          };
        };
        return { actions: [mk('input', '.search-box', 'arena search'), mk('input', '.qty-box', '3')] };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className.replace('search-box', 'search-box-v2').replace('qty-box', 'qty-box-v2');
        });
      `,
    });

    const kb = JSON.parse(fs.readFileSync(path.join(kbDir, 'heals-file.json'), 'utf8'));
    expect(kb['.stale-old']).toBeUndefined();          // 40 天前 → 剪掉
    expect(kb['.fresh-entry'].healed).toBe('#fresh');  // 1 天前 → 保留
    fs.rmSync(kbDir, { recursive: true, force: true });
  });

  it('shadow DOM：探测层深查一致化——阴影内按钮可正常 heal', async () => {
    // 按钮在 open shadow root 内、id 加后缀变异。queryJS 深查支持 shadow，
    // 但裸 probe/指纹/遮挡 evaluate 只扫顶层文档——阴影内候选全部误判
    // miss，点击落到 soft 备选。深查一致化后 partial-id 干净命中。
    const report = await runLevel('none', 130, {
      expected: {},
      recordingFactory: async (pfx: string, targetPath: string) => {
        let cid = 0;
        const mk = (type: UserAction['type'], selector: string, text?: string): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: { tag: 'button', selector, text: text ?? '', type: 'button' },
          };
        };
        return { actions: [mk('click', '#sgobtn', 'Go')] };
      },
      preMutation: `
        var host = document.createElement('div');
        var sh = host.attachShadow({ mode: 'open' });
        sh.innerHTML = '<form><button id="sgobtn" type="button" class="sh-btn">Go</button></form>';
        document.body.appendChild(host);
        sh.querySelector('#sgobtn').id = 'sgobtn-v2';
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(1);
    expect(report.actionResult.failed).toBe(0);
    expect(report.healed.map(h => h.strategy)).toContain('partial-id');
  });

  it('文案锚点：class 全量替换（非后缀）后录制文案仍锁定按钮', async () => {
    // class 改成完全无关的名字（无子串关系）→ partial-class 全灭；form1 的
    // Login（同为 type=button）带点击清空陷阱——无 text-anchor 时 meta-type
    // 软备选命中 Login→清空→0/2；有锚点时文案 'Go' 精确锁定真按钮→2/2。
    const report = await runLevel('none', 110, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        const snap = await page.evaluate<Record<string, { x: number; y: number; formNth: number; tagNth: number }>>(`/* @xb-probe */ (function(){
          var out = {};
          ['search','qty'].forEach(function(k){
            var el = document.querySelector('[data-arena="' + k + '"]');
            var r = el.getBoundingClientRect();
            var form = el.closest('form');
            var formSibs = Array.prototype.filter.call(form.parentElement.children, function(c){ return c.tagName === 'FORM'; });
            var tagSibs = Array.prototype.filter.call(form.children, function(c){ return c.tagName === el.tagName; });
            out[k] = {
              x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
              formNth: formSibs.indexOf(form) + 1, tagNth: tagSibs.indexOf(el) + 1,
            };
          });
          return out;
        })()`);
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string, s?: { x: number; y: number; formNth: number; tagNth: number },
          value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: {
              tag: selector.endsWith('btn-secondary') ? 'button' : 'input',
              selector, text: text ?? '',
              ...(selector.endsWith('btn-secondary') ? { type: 'button' } : {}),
              ...(s ? { ordinal: { formNth: s.formNth, tagNth: s.tagNth } } : {}),
            },
            ...(value !== undefined ? { value } : {}),
            ...(s ? { x: s.x, y: s.y } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', snap.search, 'arena search'),
            mk('input', '.qty-box', snap.qty, '3'),
            mk('click', '.btn-secondary', undefined, undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className
            .replace('search-box', 'search-cta')
            .replace('qty-box', 'qty-cta')
            .replace('btn-secondary', 'btn-cta');
        });
        document.querySelector('[data-arena="submit"]').addEventListener('click', function(){
          document.querySelectorAll('[data-arena]').forEach(function(e){ e.value = ''; });
        });
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.semanticCorrect).toBe(2);
    expect(report.healed[0].strategy).toBe('ordinal');
    expect(report.healed[2].strategy).toBe('text-anchor');
  });

  it('label 锚点：表单行重排 + class 全量替换后 label 文本仍锁定控件', async () => {
    // label 包裹的表单行整体对调 + class 全量改名：ordinal/位置候选全部
    // 失效，label 文本随控件同行移动——label-anchor 是唯一幸存信号。
    const report = await runLevel('none', 120, {
      expected: { vsearch: 'arena search', vqty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        let cid = 0;
        const mk = (type: UserAction['type'], selector: string, labelText: string, value?: string): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: { tag: 'input', selector, text: '', labelText },
            ...(value !== undefined ? { value } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-row', 'Search product', 'arena search'),
            mk('input', '.qty-row', 'Order quantity', '3'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className.replace('search-row', 'row-x1').replace('qty-row', 'row-x2');
        });
        var f = document.getElementById('rows-p120_none');
        f.insertBefore(f.children[1], f.children[0]);
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(2);
    expect(report.semanticCorrect).toBe(2);
    expect(report.healed.filter(h => h.strategy === 'label-anchor').length).toBe(2);
  });

  it('重复动作去重收窄：人类连点不误杀，cdp 双生仍被去重', async () => {
    // 独立计数器页：Add 按钮点击计数。人类节奏（间隔 4s）的两次同位点击
    // 都应执行（count=2）；cdp 双生（真动作+无坐标回声，间隔 0.8s）仍应
    // 去重（count=1）——旧 15s 窗口下两者都只执行 1 次。
    const pagePath = '/tmp/arena-prod-counter.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html>
<html><body>
  <button id="add" onclick="document.getElementById('count').textContent =
    String(Number(document.getElementById('count').textContent) + 1)">Add</button>
  <div id="count">0</div>
</body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    const rect = await page.evaluate<{ x: number; y: number }>(`/* @xb-probe */ (function(){
      var r = document.getElementById('add').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    const mk = (id: number, type: UserAction['type'], ts: number, at?: { x: number; y: number }): UserAction => ({
      id, type, timestamp: ts,
      url: `file://${pagePath}`, pageTitle: 'counter',
      element: { tag: 'button', selector: '#add', text: 'Add' },
      ...(at ? { x: at.x, y: at.y } : {}),
    });
    const base = Date.now();

    // A. 人类节奏重复：间隔 4s、同位同选择器 → 两次都执行
    const rep = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(ARCHIVE_DIR, 'heal-kb', '140a'),
    });
    await rep.load({
      actions: [mk(1, 'click', base, rect), mk(2, 'click', base + 4000, rect)],
    } as never);
    const repResult = await rep.run();
    await rep.close();
    const countA = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('count').textContent`);

    await page.evaluate(`/* @xb-probe */ document.getElementById('count').textContent = '0'`);

    // B. cdp 双生：真动作（带坐标）+ 0.8s 后的无坐标回声 → 去重，只执行 1 次
    const twin = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(ARCHIVE_DIR, 'heal-kb', '140b'),
    });
    await twin.load({
      actions: [mk(1, 'click', base, rect), mk(2, 'cdp-click', base + 800)],
    } as never);
    const twinResult = await twin.run();
    await twin.close();
    const countB = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('count').textContent`);

    console.log(`[dedup] human-repeat count=${countA} (want 2)  twin count=${countB} (want 1)`);
    expect(repResult.failed).toBe(0);
    expect(twinResult.failed).toBe(0);
    expect(countA).toBe('2');
    expect(countB).toBe('1');
  });

  it('dblclick 接入自愈链：class 全量改名后双击仍命中', async () => {
    // 此前 dblclick 走 resolveSelector（无 heal/指纹/遮挡）——选择器失效
    // 即失败。接入 resolveAndWait 后经 text-anchor 干净命中。
    const pagePath = '/tmp/arena-prod-dbl.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html>
<html><head><script>var count=0; function bump(){document.getElementById('cnt').textContent=String(++count);}</script></head>
<body>
  <button class="dbl-btn" ondblclick="bump()">Double</button>
  <div id="cnt">0</div>
</body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    const rect = await page.evaluate<{ x: number; y: number }>(`/* @xb-probe */ (function(){
      var r = document.querySelector('.dbl-btn').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    await page.evaluate(`/* @xb-probe */ (function(){
      document.querySelectorAll('[class]').forEach(function(el){
        el.className = el.className.replace('dbl-btn', 'dbl-cta');
      });
    })()`);
    const recording = {
      actions: [{
        id: 1, type: 'dblclick' as const, timestamp: Date.now(),
        url: `file://${pagePath}`, pageTitle: 'dbl',
        element: { tag: 'button', selector: '.dbl-btn', text: 'Double' },
        x: rect.x, y: rect.y,
      }],
    };
    const healed: Array<{ index: number; strategy: string }> = [];
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      // 每次调用唯一知识库目录——固定路径会跨 vitest 调用串扰策略断言
      //（r10 同款教训）：上一轮写回的映射本轮被 known-heal 抢先命中
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-dbl-${Date.now()}`),
      onHealed: (action, strategy, index) => healed.push({ index, strategy }),
    });
    await replayer.load(recording);
    const result = await replayer.run();
    await replayer.close();
    const count = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('cnt').textContent`);

    expect(result.failed).toBe(0);
    expect(count).toBe('1');
    expect(healed.map(h => h.strategy)).toContain('text-anchor');
  });

  it('sup-s1 攻击：颜色卡 input[type=color] 回放填色（防御前红测/防御后绿）', async () => {
    // 点击色卡会请求 OS 原生取色面板（headful 弹系统面板，headless 无 UI
    // 但同样不设值），键盘输入对 color 类型无效——fill 路径（click+type）
    // 对色卡完全不设值。防御=JS 值注入 + input/change 事件。
    const pagePath = '/tmp/arena-prod-color.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html><html><body>
      <form>
        <input type="color" id="ink" data-arena="ink" value="#000000" />
        <div id="log">none</div>
      </form>
      <script>
        document.getElementById('ink').addEventListener('change', function() {
          document.getElementById('log').textContent = 'changed:' + this.value;
        });
      </script>
    </body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    const recording = {
      actions: [{
        id: 1, type: 'input' as const, timestamp: Date.now(),
        url: `file://${pagePath}`, pageTitle: 'color',
        element: { tag: 'input', selector: '#ink', text: '', type: 'color' },
        value: '#ff0000',
      }],
    };
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-color-${Date.now()}`),
    });
    await replayer.load(recording);
    const result = await replayer.run();
    await replayer.close();
    const ink = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('ink').value`);
    const log = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('log').textContent`);

    expect(result.failed).toBe(0);
    expect(ink).toBe('#ff0000');       // 值注入生效
    expect(log).toBe('changed:#ff0000'); // change 事件冒泡被页面监听捕获
  });

  it('sup-s3 攻击：日期/时间控件回放（fill 键盘路径值错乱，值注入防御）', async () => {
    // Chrome 日历弹层是浏览器内部 shadow popup（页面 DOM 不可及）；fill
    // 的键盘路径把 ISO 字符逐个打进日期分段（数字落错段、分隔符被吞），
    // 值大概率错乱。防御=date/datetime-local/month/week/time 家族值注入。
    const pagePath = '/tmp/arena-prod-date.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html><html><body>
      <form>
        <input type="date" id="d1" data-arena="d1" />
        <input type="datetime-local" id="d2" data-arena="d2" />
        <div id="log">none</div>
      </form>
      <script>
        document.getElementById('d1').addEventListener('change', function() {
          document.getElementById('log').textContent = 'd1:' + this.value;
        });
      </script>
    </body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    const mk = (id: number, sel: string, type: string, value: string) => ({
      id, type: 'input' as const, timestamp: Date.now() + id * 1000,
      url: `file://${pagePath}`, pageTitle: 'date',
      element: { tag: 'input', selector: sel, text: '', type },
      value,
    });
    const recording = {
      actions: [
        mk(1, '#d1', 'date', '2024-03-15'),
        mk(2, '#d2', 'datetime-local', '2024-03-15T10:30'),
      ],
    };
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-date-${Date.now()}`),
    });
    await replayer.load(recording);
    const result = await replayer.run();
    await replayer.close();
    const d1 = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('d1').value`);
    const d2 = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('d2').value`);
    const log = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('log').textContent`);

    expect(result.failed).toBe(0);
    expect(d1).toBe('2024-03-15');
    expect(d2).toBe('2024-03-15T10:30');
    expect(log).toBe('d1:2024-03-15');
  });

  it('sup-s5 拖拽上传录制→回放闭环：drop 动作经 dropFiles 重放', async () => {
    // Dropzone 类上传区无 input[type=file]，录制端此前对 OS 文件拖入
    // 零捕获（回放无据可依）。闭环=录制端内联 dataTransfer.files，回放
    // 端 'drop' 动作经 dropFiles（dragenter/over/drop 协议）重放。
    const pagePath = '/tmp/arena-prod-drop-replay.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html><html><body>
      <div id="zone" style="width:200px;height:100px;border:1px solid #ccc">Drop here</div>
      <div id="log">none</div>
      <script>
        var zone = document.getElementById('zone');
        zone.addEventListener('dragover', function(e) { e.preventDefault(); });
        zone.addEventListener('drop', function(e) {
          e.preventDefault();
          var f = e.dataTransfer.files[0];
          f.text().then(function(t) {
            document.getElementById('log').textContent = f.name + ':' + t + ':' + f.size;
          });
        });
      </script>
    </body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    const recording = {
      actions: [{
        id: 1, type: 'drop' as const, timestamp: Date.now(),
        url: `file://${pagePath}`, pageTitle: 'drop-replay',
        element: { tag: 'div', selector: '#zone', text: 'Drop here' },
        value: 'note.txt',
        files: {
          names: ['note.txt'], count: 1, isMultiple: false,
          fileData: [{
            name: 'note.txt', type: 'text/plain', size: 15,
            dataUrl: 'data:text/plain;base64,' + Buffer.from('dropped-content').toString('base64'),
          }],
        },
      }],
    };
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-drop-${Date.now()}`),
    });
    await replayer.load(recording);
    const result = await replayer.run();
    await replayer.close();
    const log = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('log').textContent`);

    expect(result.failed).toBe(0);
    expect(log).toBe('note.txt:dropped-content:15');
  });

  it('role=button 语义元素：class 全量改名后文案锚仍锁定（SPA div 按钮）', async () => {
    // SPA 主流形态：<div role="button"> 充当按钮——tagName 是 div，旧
    // text-anchor 门控（仅 button/a 标签）不会生成候选。文案锚扩展后
    // class 全量改名仍由 role+文案锁定，点击置 __confirmed 标记。
    const pagePath = '/tmp/arena-prod-role.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html><html><body>
      <div role="button" class="cta" onclick="document.getElementById('st').textContent='confirmed'">Confirm</div>
      <div id="st">idle</div>
    </body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    await page.evaluate(`/* @xb-probe */ (function(){
      document.querySelectorAll('[class]').forEach(function(el){
        el.className = el.className.replace('cta', 'btn-x9');
      });
    })()`);
    const recording = {
      actions: [{
        id: 1, type: 'click' as const, timestamp: Date.now(),
        url: `file://${pagePath}`, pageTitle: 'role',
        element: { tag: 'div', selector: '.cta', text: 'Confirm', role: 'button' },
      }],
    };
    const healed: Array<{ index: number; strategy: string }> = [];
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-role-${Date.now()}`),
      onHealed: (action, strategy, index) => healed.push({ index, strategy }),
    });
    await replayer.load(recording);
    const result = await replayer.run();
    await replayer.close();
    const st = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('st').textContent`);

    expect(result.failed).toBe(0);
    expect(st).toBe('confirmed');
    expect(healed[0].strategy).toBe('text-anchor');
  });

  it('JS 对话框自动压制：alert/confirm/prompt 不阻塞回放序列', async () => {
    // 三个按钮依次触发 alert/confirm/prompt——任一对话框挂起都会卡死
    // 回放序列。自动 dismiss 下：alert 置标后放行、confirm dismiss 返回
    // false（'no'）、prompt dismiss 返回 null（'null'），最终标记='null'
    // 证明三步全部执行且无挂起。
    const pagePath = '/tmp/arena-prod-dialog.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html><html><body>
      <button id="a" onclick="document.getElementById('m').textContent='alerted';alert('A')">A</button>
      <button id="c" onclick="document.getElementById('m').textContent=confirm('C')?'yes':'no'">C</button>
      <button id="p" onclick="document.getElementById('m').textContent=String(prompt('P','def'))">P</button>
      <div id="m">idle</div>
    </body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    const recording = {
      actions: (['a', 'c', 'p'] as const).map((id, i) => ({
        id: i + 1, type: 'click' as const, timestamp: Date.now() + (i + 1) * 1000,
        url: `file://${pagePath}`, pageTitle: 'dialog',
        element: { tag: 'button', selector: `#${id}`, text: id.toUpperCase() },
      })),
    };
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 100, stepTimeout: 5000,
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-dialog-${Date.now()}`),
    });
    await replayer.load(recording);
    const started = Date.now();
    const result = await replayer.run();
    await replayer.close();
    const elapsed = Date.now() - started;
    const mark = await page.evaluate<string>(`/* @xb-probe */ document.getElementById('m').textContent`);

    expect(result.failed).toBe(0);
    expect(mark).toBe('null'); // alert 置标 → confirm dismiss 'no' → prompt dismiss String(null)
    expect(elapsed).toBeLessThan(30_000); // 无挂起
  });

  it('same-origin iframe：回放穿透 iframe 填充，改名后 partial-id 自愈', async () => {
    // srcdoc iframe 内的表单——queryJS 深查可达、actionability 的
    // iframe 坐标偏移保证填充落点。锁定端到端能力（录制→回放→自愈）。
    const pagePath = '/tmp/arena-prod-iframe.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html><html><body>
      <iframe style="width:420px;height:120px" srcdoc='<form><input id="iuser" class="iu" data-arena="iuser" /><input id="iqty" class="iq" data-arena="iqty" /></form>'></iframe>
    </body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(300);
    const recording = {
      actions: [
        {
          id: 1, type: 'input' as const, timestamp: Date.now() + 1000,
          url: `file://${pagePath}`, pageTitle: 'iframe',
          element: { tag: 'input', selector: '#iuser', text: '' },
          value: 'iframe-user',
        },
        {
          id: 2, type: 'input' as const, timestamp: Date.now() + 2000,
          url: `file://${pagePath}`, pageTitle: 'iframe',
          element: { tag: 'input', selector: '#iqty', text: '' },
          value: '9',
        },
      ],
    };
    await page.evaluate(`/* @xb-probe */ (function(){
      var d = document.querySelector('iframe').contentDocument;
      d.getElementById('iuser').id = 'iuser-v2';
      d.getElementById('iqty').id = 'iqty-v2';
    })()`);
    const healed: Array<{ index: number; strategy: string }> = [];
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-iframe-${Date.now()}`),
      onHealed: (action, strategy, index) => healed.push({ index, strategy }),
    });
    await replayer.load(recording);
    const result = await replayer.run();
    await replayer.close();
    const values = await page.evaluate<Record<string, string>>(`/* @xb-probe */ (function(){
      var d = document.querySelector('iframe').contentDocument;
      return {
        iuser: d.querySelector('[data-arena="iuser"]').value,
        iqty: d.querySelector('[data-arena="iqty"]').value,
      };
    })()`);
    console.log(`[iframe] iuser=${values.iuser} iqty=${values.iqty} healed=${JSON.stringify(healed.map(h => h.strategy))}`);
    expect(result.failed).toBe(0);
    expect(values.iuser).toBe('iframe-user');
    expect(values.iqty).toBe('9');
    expect(healed.filter(h => h.strategy === 'partial-id').length).toBe(2);
  });

  it('row-anchor：表格行重排 + class 全量改名后行文本仍锁定单元格控件', async () => {
    // 无 label/placeholder/type 的表格行 input——行对调后 ordinal/位置候选
    // 全部失效，行文本（'张三'/'李四'）是唯一随内容移动的信号。
    const pagePath = '/tmp/arena-prod-rows.html';
    fs.writeFileSync(pagePath, `<!DOCTYPE html>
<html><body><table>
  <tr><td>张三</td><td><input class="name-input" data-arena="who" /></td></tr>
  <tr><td>李四</td><td><input class="city-input" data-arena="city" /></td></tr>
</table></body></html>`);
    await page.goto(`file://${pagePath}`);
    await page.waitForTimeout(200);
    const recording = {
      actions: [
        {
          id: 1, type: 'input' as const, timestamp: Date.now() + 1000,
          url: `file://${pagePath}`, pageTitle: 'rows',
          element: { tag: 'input', selector: '.name-input', text: '', rowText: '张三' },
          value: 'arena who',
        },
        {
          id: 2, type: 'input' as const, timestamp: Date.now() + 2000,
          url: `file://${pagePath}`, pageTitle: 'rows',
          element: { tag: 'input', selector: '.city-input', text: '', rowText: '李四' },
          value: 'arena city',
        },
      ],
    };
    await page.evaluate(`/* @xb-probe */ (function(){
      document.querySelectorAll('[class]').forEach(function(el){
        el.className = el.className.replace('name-input', 'col-x1').replace('city-input', 'col-x2');
      });
      var rows = document.querySelectorAll('table tr');
      var tb = rows[0].parentNode;
      tb.insertBefore(rows[1], rows[0]);
    })()`);
    const healed: Array<{ index: number; strategy: string }> = [];
    const replayer = new SessionReplayer({
      page, selfHealing: true, stepDelay: 50, stepTimeout: 3000,
      healKnowledgeDir: path.join(os.tmpdir(), `heal-kb-rows-${Date.now()}`),
      onHealed: (action, strategy, index) => healed.push({ index, strategy }),
    });
    await replayer.load(recording);
    const result = await replayer.run();
    await replayer.close();
    const values = await page.evaluate<Record<string, string>>(`/* @xb-probe */ (function(){
      var out = {};
      document.querySelectorAll('[data-arena]').forEach(function(el){ out[el.getAttribute('data-arena')] = el.value; });
      return out;
    })()`);
    console.log(`[row-anchor] who=${values.who} city=${values.city} healed=${JSON.stringify(healed.map(h => h.strategy))}`);
    expect(result.failed).toBe(0);
    expect(values.who).toBe('arena who');
    expect(values.city).toBe('arena city');
    expect(healed.filter(h => h.strategy === 'row-anchor').length).toBe(2);
  });

  it('尺寸指纹：同文案同 type 诱饵按尺寸消歧（probe 级多匹配评分）', async () => {
    // 诱饵与真按钮同 class 子串/同文案/type，仅尺寸不同（320x90 vs 实际），
    // 文档序在前、点击清空字段。无逐匹配评分时 partial-class 首匹配=诱饵
    // （指纹全过）→清空→0/2；有评分时真按钮（尺寸匹配 +1）胜出→2/2。
    const report = await runLevel('none', 150, {
      expected: { search: 'arena search', qty: '3' },
      recordingFactory: async (pfx, targetPath) => {
        const measured = await page.evaluate<{ w: number; h: number }>(`/* @xb-probe */ (function(){
          var r = document.querySelector('[data-arena="go"]').getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        })()`);
        let cid = 0;
        const mk = (
          type: UserAction['type'], selector: string,
          value?: string, text?: string,
        ): UserAction => {
          cid += 1;
          return {
            id: cid, type, timestamp: Date.now() + cid * 1000,
            url: `file://${targetPath}`, pageTitle: `Arena ${pfx}`,
            element: {
              tag: selector.endsWith('btn-secondary') ? 'button' : 'input',
              selector, text: text ?? '',
              ...(selector.endsWith('btn-secondary')
                ? { type: 'button', size: measured }
                : {}),
            },
            ...(value !== undefined ? { value } : {}),
          };
        };
        return {
          actions: [
            mk('input', '.search-box', 'arena search'),
            mk('input', '.qty-box', '3'),
            mk('click', '.btn-secondary', undefined, 'Go'),
          ],
        };
      },
      preMutation: `
        document.querySelectorAll('[class]').forEach(function(el){
          el.className = el.className
            .replace('search-box', 'search-box-v2')
            .replace('qty-box', 'qty-box-v2')
            .replace('btn-secondary', 'btn-secondary-v2');
        });
        var clone = document.createElement('button');
        clone.className = 'btn-secondary-v2'; clone.type = 'button'; clone.textContent = 'Go';
        clone.style.cssText = 'position:fixed;bottom:0;left:0;width:320px;height:90px;';
        clone.addEventListener('click', function(){
          document.querySelectorAll('[data-arena]').forEach(function(e){ e.value = ''; });
        });
        document.body.insertBefore(clone, document.body.firstChild);
      `,
    });
    expect(report.actionResult.success + report.actionResult.failed).toBe(3);
    expect(report.actionResult.failed).toBe(0);
    expect(report.semanticCorrect).toBe(2);
    expect(report.healed[2].strategy).toBe('partial-class');
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
