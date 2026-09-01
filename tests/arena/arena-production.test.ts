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
    expect(report.healed.filter(h => h.strategy === 'partial-class').length).toBe(2);
    // r15 起文案锚点（'Go' 不匹配 decoy 的 'Cancel'）干净命中真按钮
    expect(report.healed[2].strategy).toBe('text-anchor');
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
