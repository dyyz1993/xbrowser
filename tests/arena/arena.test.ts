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
import fs from 'fs';
import path from 'path';

const TIMEOUT = 60_000;
const ARCHIVE_DIR = 'output/arena';

// ── 靶场页生成 ──

function buildTargetPage(prefix: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Arena ${prefix}</title></head>
<body>
  <form id="login-${prefix}">
    <input id="username-${prefix}" class="field-input" name="username" placeholder="Username" type="text" />
    <input id="password-${prefix}" class="field-input" name="password" placeholder="Password" type="password" />
    <input id="email-${prefix}" class="field-input" name="email" placeholder="Email" type="email" />
    <textarea id="comment-${prefix}" class="field-area" name="comment">initial</textarea>
    <select id="role-${prefix}" class="field-select"><option value="user">user</option><option value="admin">admin</option></select>
    <button id="submit-${prefix}" class="btn-primary" type="submit">Login</button>
  </form>
  <div id="result-${prefix}" class="result-area">waiting</div>
</body></html>`;
}

// ── DOM 攻击变异器 ──

const MUTATIONS: Record<string, { desc: string; fn: string }> = {
  changeId: { desc: '改所有 id（加 -mutated 后缀）', fn: `document.querySelectorAll('[id]').forEach(function(el){ if(el.id && el.id !== 'result-') el.id = el.id + '-mut'; });` },
  changeClass: { desc: '改所有 class（加 mutated 后缀）', fn: `document.querySelectorAll('[class]').forEach(function(el){ el.className = el.className + ' mutated'; });` },
  addWrapper: { desc: '每个 input/button 外加包裹 div', fn: `document.querySelectorAll('form input, form button, form textarea, form select').forEach(function(el){ var w = document.createElement('div'); el.parentNode.insertBefore(w, el); w.appendChild(el); });` },
  removeName: { desc: '删所有 name 属性', fn: `document.querySelectorAll('[name]').forEach(function(el){ el.removeAttribute('name'); });` },
  removePlaceholder: { desc: '删所有 placeholder', fn: `document.querySelectorAll('[placeholder]').forEach(function(el){ el.removeAttribute('placeholder'); });` },
};

const LEVELS: Record<string, string[]> = {
  none: [],
  light: ['changeId'],
  medium: ['changeId', 'changeClass', 'addWrapper'],
  aggressive: ['changeId', 'changeClass', 'addWrapper', 'removeName', 'removePlaceholder'],
};

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
  (t: string) => `#${t}`,
  (t: string) => `[name="${t}"]`,
  (t: string) => `[placeholder="${t}"]`,
  (t: string) => `[id*="${t}"]`,
  (t: string) => `[name*="${t}"]`,
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
  it('归档文件存在且含自愈率', () => {
    const files = fs.readdirSync(path.resolve(ARCHIVE_DIR)).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8'));
      expect(data).toHaveProperty('healingRate');
      expect(data).toHaveProperty('round');
      expect(data).toHaveProperty('level');
    }
  });
});
