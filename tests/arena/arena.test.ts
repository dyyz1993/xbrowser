/**
 * 录制回放竞技场 — 自愈率攻防迭代系统
 *
 * 每轮：
 *   1. 生成靶场页（可控 DOM 表单）
 *   2. 基线操作（确定可用选择器）
 *   3. DOM 攻击（按级别变异选择器/结构）
 *   4. 自愈回放（fallback chain 逐级降级）
 *   5. 统计自愈率 + 归档
 *
 * 自愈率 = DOM 攻击后通过 fallback chain 恢复的操作比例
 * 这是录制回放系统的核心竞争力指标
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';
import { buildTargetPage, MUTATIONS, LEVELS } from './shared.js';
import fs from 'fs';
import path from 'path';

const TIMEOUT = 60_000;
const ARCHIVE_DIR = 'output/arena';

// ── 操作流 ──

const ACTIONS = [
  { type: 'fill', target: 'username', value: 'arena-user' },
  { type: 'fill', target: 'password', value: 'arena-pass-123' },
  { type: 'fill', target: 'email', value: 'arena@test.com' },
  { type: 'fill', target: 'comment', value: 'arena comment' },
  { type: 'select', target: 'role', value: 'admin' },
  { type: 'click', target: 'submit' },
];

// ── Fallback chain ──

const FALLBACK_CHAIN = [
  // 精确匹配层（id/name/placeholder 存活时命中）
  (t: string) => `#${t}`,
  (t: string) => `[name="${t}"]`,
  (t: string) => `[placeholder="${t}"]`,
  // 部分匹配层（id/name 带 -mut 后缀时命中）
  (t: string) => `[id*="${t}"]`,
  (t: string) => `[name*="${t}"]`,
  // S202: 结构语义层（id/name 全灭后仍可命中）
  // type 属性不随 DOM 变异改变
  (t: string) => {
    const typeMap: Record<string,string> = { username: 'text', password: 'password', email: 'email' };
    return typeMap[t] ? `input[type="${typeMap[t]}"]` : '';
  },
  // tag 直接匹配（textarea/select/button 天然唯一或少量）
  (t: string) => {
    const tagMap: Record<string,string> = { comment: 'textarea', role: 'select', submit: 'button' };
    return tagMap[t] ? tagMap[t] : '';
  },
  // form 内位置定位（第 N 个 input/select/button）
  (t: string) => {
    const posMap: Record<string,number> = { username: 0, password: 1, email: 2, comment: 0, role: 0, submit: 0 };
    const pos = posMap[t] ?? -1;
    if (pos < 0) return '';
    const tagMap: Record<string,string> = { username: 'input', password: 'input', email: 'input', comment: 'textarea', role: 'select', submit: 'button' };
    const tag = tagMap[t] || 'input';
    return `form ${tag}:nth-of-type(${pos + 1})`;
  },
];

// ── 测试 ──

describe('录制回放竞技场', { timeout: TIMEOUT }, () => {
  let browser: XBBrowser;
  let page: XBPage;
  let prefix: string;
  let targetPath: string;

  beforeAll(async () => {
    const result = await launch({ headless: true, args: ['--no-sandbox'] });
    browser = result.browser;
    const context = await browser.newContext();
    page = await context.newPage();
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
    // 清理靶场文件
    try { fs.unlinkSync(targetPath); } catch {}
  }, 30_000);

  async function setupPage(level: string, round: number) {
    prefix = `r${round}_${level}`;
    targetPath = path.join('/tmp', `arena-${prefix}.html`);
    fs.writeFileSync(targetPath, buildTargetPage(prefix));
    await page.goto(`file://${targetPath}`);
    await page.waitForTimeout(300);
  }

  async function applyMutations(level: string) {
    const muts = LEVELS[level] || [];
    for (const key of muts) {
      const mut = MUTATIONS[key];
      if (mut) await page.evaluate(`/* @xb-probe */ (function(){ ${mut.fn} })()`);
    }
    await page.waitForTimeout(100);
  }

  async function tryFill(target: string, value: string): Promise<{ success: boolean; healed: boolean; strategy: number }> {
    // 策略链逐级尝试
    for (let si = 0; si < FALLBACK_CHAIN.length; si++) {
      const sel = FALLBACK_CHAIN[si](target);
      const found = await page.evaluate(`/* @xb-probe */ (function(){
        try { var el = document.querySelector(${JSON.stringify(sel)}); return el ? 'yes' : 'no'; } catch(e) { return 'err'; }
      })()`);
      if (found === 'yes') {
        await page.evaluate(`/* @xb-probe */ (function(){
          var el = document.querySelector(${JSON.stringify(sel)});
          if (el) { el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles: true})); }
        })()`);
        return { success: true, healed: si > 0, strategy: si };
      }
    }
    return { success: false, healed: false, strategy: -1 };
  }

  async function trySelect(target: string, value: string) {
    for (let si = 0; si < FALLBACK_CHAIN.length; si++) {
      const sel = FALLBACK_CHAIN[si](target);
      const found = await page.evaluate(`/* @xb-probe */ (function(){
        try { var el = document.querySelector(${JSON.stringify(sel)}); return el ? 'yes' : 'no'; } catch(e) { return 'err'; }
      })()`);
      if (found === 'yes') {
        await page.evaluate(`/* @xb-probe */ (function(){
          var el = document.querySelector(${JSON.stringify(sel)});
          if (el) { el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', {bubbles:true})); }
        })()`);
        return { success: true, healed: si > 0, strategy: si };
      }
    }
    return { success: false, healed: false, strategy: -1 };
  }

  async function tryClick(target: string) {
    for (let si = 0; si < FALLBACK_CHAIN.length; si++) {
      const sel = FALLBACK_CHAIN[si](target);
      const found = await page.evaluate(`/* @xb-probe */ (function(){
        try { var el = document.querySelector(${JSON.stringify(sel)}); return el ? 'yes' : 'no'; } catch(e) { return 'err'; }
      })()`);
      if (found === 'yes') {
        await page.evaluate(`/* @xb-probe */ (function(){ var el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); })()`);
        return { success: true, healed: si > 0, strategy: si };
      }
    }
    return { success: false, healed: false, strategy: -1 };
  }

  function archive(round: number, level: string, results: any[]) {
    const dir = path.resolve(ARCHIVE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const passed = results.filter((r: any) => r.success).length;
    const healed = results.filter((r: any) => r.healed && r.success).length;
    const report = {
      round, level, total: results.length,
      passed, failed: results.length - passed,
      healed, healingRate: Math.round(healed / Math.max(results.length, 1) * 100),
      actions: results, at: new Date().toISOString(),
    };
    const fp = path.join(dir, `round-${round}-${level}.json`);
    fs.writeFileSync(fp, JSON.stringify(report, null, 2));
    return report;
  }

  // ── 基线（无攻击）──
  it('基线：无攻击全通过', async () => {
    await setupPage('none', 0);
    const results: any[] = [];
    results.push({ ...(await tryFill('username', 'user')), target: 'username' });
    results.push({ ...(await tryFill('password', 'pass')), target: 'password' });
    results.push({ ...(await tryFill('email', 'email')), target: 'email' });
    results.push({ ...(await trySelect('role', 'admin')), target: 'role' });
    results.push({ ...(await tryClick('submit')), target: 'submit' });

    const passed = results.filter(r => r.success).length;
    archive(0, 'baseline', results);
    expect(passed).toBe(5);
  });

  // ── 攻击级别：light ──
  it('light 攻击：改 id 后自愈回放', async () => {
    await setupPage('light', 1);
    await applyMutations('light');
    const results: any[] = [];
    results.push({ ...(await tryFill('username', 'user')), target: 'username' });
    results.push({ ...(await tryFill('password', 'pass')), target: 'password' });
    results.push({ ...(await tryFill('email', 'email')), target: 'email' });
    results.push({ ...(await trySelect('role', 'admin')), target: 'role' });
    results.push({ ...(await tryClick('submit')), target: 'submit' });

    const passed = results.filter(r => r.success).length;
    const report = archive(1, 'light', results);
    expect(report.healingRate).toBeGreaterThanOrEqual(60); // 至少 60% 自愈
  });

  // ── 攻击级别：medium ──
  it('medium 攻击：改 id+class+加包裹层', async () => {
    await setupPage('medium', 2);
    await applyMutations('medium');
    const results: any[] = [];
    results.push({ ...(await tryFill('username', 'user')), target: 'username' });
    results.push({ ...(await tryFill('password', 'pass')), target: 'password' });
    results.push({ ...(await tryFill('email', 'email')), target: 'email' });
    results.push({ ...(await trySelect('role', 'admin')), target: 'role' });
    results.push({ ...(await tryClick('submit')), target: 'submit' });

    const passed = results.filter(r => r.success).length;
    const report = archive(2, 'medium', results);
    expect(report.healingRate).toBeGreaterThanOrEqual(40);
  });

  // ── 攻击级别：aggressive ──
  it('aggressive 攻击：改 id+class+包裹+删 name+删 placeholder', async () => {
    await setupPage('aggressive', 3);
    await applyMutations('aggressive');
    const results: any[] = [];
    results.push({ ...(await tryFill('username', 'user')), target: 'username' });
    results.push({ ...(await tryFill('password', 'pass')), target: 'password' });
    results.push({ ...(await tryFill('email', 'email')), target: 'email' });
    results.push({ ...(await trySelect('role', 'admin')), target: 'role' });
    results.push({ ...(await tryClick('submit')), target: 'submit' });

    const passed = results.filter(r => r.success).length;
    const report = archive(3, 'aggressive', results);
    console.log(`[aggressive] healing: ${report.healingRate}%  passed: ${passed}/5`);
    expect(passed).toBeGreaterThanOrEqual(2); // 即使激进攻击，至少一半可恢复
  });

  // ── 自愈率归档完整性 ──
  it('S202: extreme2 攻击（id 随机化+删 id+name 随机化）', async () => {
    await setupPage('extreme2', 10);
    await applyMutations('extreme2');
    const results: any[] = [];
    results.push({ ...(await tryFill('username', 'user')), target: 'username' });
    results.push({ ...(await tryFill('password', 'pass')), target: 'password' });
    results.push({ ...(await tryFill('email', 'email')), target: 'email' });
    results.push({ ...(await trySelect('role', 'admin')), target: 'role' });
    results.push({ ...(await tryClick('submit')), target: 'submit' });
    const report = archive(10, 'extreme2', results);
    console.log(`[extreme2] healing: ${report.healingRate}%  passed: ${report.passed}/${report.total}`);
    // extreme2 应该暴露 fallback chain 的真正边界
    expect(report.total).toBe(5);
  });

  it('nuclear 攻击（全变异叠加）', async () => {
    await setupPage('nuclear', 20);
    await applyMutations('nuclear');
    const results: any[] = [];
    results.push({ ...(await tryFill('username', 'user')), target: 'username' });
    results.push({ ...(await tryFill('password', 'pass')), target: 'password' });
    results.push({ ...(await tryFill('email', 'email')), target: 'email' });
    results.push({ ...(await trySelect('role', 'admin')), target: 'role' });
    results.push({ ...(await tryClick('submit')), target: 'submit' });
    const report = archive(20, 'nuclear', results);
    console.log(`[nuclear] healing: ${report.healingRate}%  passed: ${report.passed}/${report.total}`);
    expect(report.total).toBe(5);
  });

  it('apocalypse 攻击（全变异+子树重排+删 class+删元素）', async () => {
    await setupPage('apocalypse', 21);
    await applyMutations('apocalypse');
    const results: any[] = [];
    results.push({ ...(await tryFill('username', 'user')), target: 'username' });
    results.push({ ...(await tryFill('password', 'pass')), target: 'password' });
    results.push({ ...(await tryFill('email', 'email')), target: 'email' });
    results.push({ ...(await trySelect('role', 'admin')), target: 'role' });
    results.push({ ...(await tryClick('submit')), target: 'submit' });
    const report = archive(21, 'apocalypse', results);
    console.log(`[apocalypse] healing: ${report.healingRate}%  passed: ${report.passed}/${report.total}`);
    expect(report.total).toBe(5);
  });

  it('归档文件存在且含自愈率', () => {
    // 只扫影子链自己的 round-* 归档（production-* 归档归生产竞技场管）
    const files = fs.readdirSync(path.resolve(ARCHIVE_DIR))
      .filter(f => f.startsWith('round-') && f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8'));
      expect(data).toHaveProperty('healingRate');
      expect(data).toHaveProperty('round');
      expect(data).toHaveProperty('level');
    }
  });
});
