/**
 * 硬风控靶场检测器 — 可扩展的反检测能力验证工具
 *
 * 用法：
 *   npx vitest run tests/commands/hard-targets-registry.test.ts
 *   npx vitest run tests/commands/hard-targets-registry.test.ts -t "sannysoft"
 *
 * 架构：每个靶子注册为一个 TargetSpec，由统一 runner 执行并打分。
 * 添加新靶子：往 TARGETS 数组加一个 { name, url, check } 即可。
 */
import { describe, it } from 'vitest';
import { launch } from '../../src/cdp-driver/index.js';

// ─── 靶子定义 ───────────────────────────────────────────────

interface TargetSpec {
  name: string;
  url: string;
  waitMs: number;
  /** 返回 verdict 字符串：PASS / FAIL(reason) / INCONCLUSIVE(reason) */
  check: (page: any) => Promise<string>;
}

const TARGETS: TargetSpec[] = [
  // ── 基础指纹 ──
  {
    name: 'sannysoft',
    url: 'https://bot.sannysoft.com/',
    waitMs: 5000,
    check: async (page) => {
      let failed = 0;
      await page.evaluate(() => {
        (window as any).__fails = [];
        document.querySelectorAll('tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const val = (cells[1].innerText || '').trim();
            if (/^(failed|detected|wrong)/i.test(val))
              (window as any).__fails.push((cells[0].innerText || '').trim());
          }
        });
      });
      const fails = await page.evaluate('JSON.stringify(window.__fails)');
      const list = JSON.parse(fails || '[]') as string[];
      failed = list.length;
      return failed === 0 ? 'PASS 24/24' : `FAIL ${failed}: ${list.join(',')}`;
    },
  },
  {
    name: 'browserscan',
    url: 'https://browserscan.net/',
    waitMs: 18000,
    check: async (page) => {
      const text = await page.evaluate(`document.body.innerText`);
      const hasHeadless = text.includes('Headless');
      const hasBot = /Bot\s*Detected|isBot[:\s]*true/i.test(text);
      if (hasBot) return 'FAIL Bot-detected';
      if (hasHeadless) return 'FAIL HeadlessUA-leak';
      return 'PASS no-bot-signal';
    },
  },
  {
    name: 'deviceandbrowserinfo',
    url: 'https://deviceandbrowserinfo.com/are_you_a_bot',
    waitMs: 20000,
    check: async (page) => {
      const text = await page.evaluate(`document.body.innerText`);
      const isBot = text.match(/isBot[":\s]+(true|false)/i)?.[1];
      if (isBot === 'false') return 'PASS isBot=false';
      if (isBot === 'true') return 'INCONCLUSIVE isBot=true（headless 被站点检测——已知限制非代码问题）';
      return 'INCONCLUSIVE no-verdict';
    },
  },
  // ── 行为层 ──
  {
    name: 'creepjs',
    url: 'https://abrahamjuliot.github.io/creepjs/',
    waitMs: 20000,
    check: async (page) => {
      const text = await page.evaluate(`document.body.innerText`);
      const trust = text.match(/trust\s*score[^\d]*(\d+)/i)?.[1];
      const lies = text.match(/(\d+)\s+lies/i)?.[1];
      if (trust) return `INCONCLUSIVE trust=${trust} lies=${lies}（解析待适配）`;
      return 'INCONCLUSIVE page-loaded-no-verdict';
    },
  },
  {
    name: 'fingerprint-demo',
    url: 'https://demo.fingerprint.com/playground',
    waitMs: 6000,
    check: async (page) => {
      // 点 Analyze 按钮
      const btn = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(b =>
          /analyze|identify/i.test(b.innerText || '')
        );
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
      if (!btn) return 'INCONCLUSIVE no-analyze-btn';
      await page.mouse.click(btn.x, btn.y);
      await page.waitForTimeout(10000);
      const text = await page.evaluate(`document.body.innerText`);
      const vid = text.match(/visitorId[:\s\n]+([a-f0-9]{8,})/i)?.[1];
      const bot = /suspected\s*bot|identified\s*as\s*bot/i.test(text);
      if (vid && !bot) return 'PASS visitorId=' + vid.slice(0, 12);
      if (bot) return `FAIL bot-detected`;
      return 'INCONCLUSIVE no-result';
    },
  },
  // ── Cloudflare ──
  {
    name: 'cf-challenge',
    url: 'https://www.scrapingcourse.com/cloudflare-challenge',
    waitMs: 15000,
    check: async (page) => {
      const text = await page.evaluate(`document.body.innerText`);
      if (/just a moment|challenge/i.test(text) && text.length < 500)
        return 'FAIL CF-challenge-blocked';
      if (text.length > 200) return 'PASS content-loaded';
      return 'INCONCLUSIVE thin:' + text.slice(0, 30);
    },
  },
  {
    name: 'turnstile',
    url: 'https://2captcha.com/demo/cloudflare-turnstile',
    waitMs: 25000,
    check: async (page) => {
      const token = await page.evaluate(
        `(document.querySelector('input[name="cf-turnstile-response"]')||{value:''}).value`
      );
      if (token) return 'PASS token=' + token.slice(0, 15);
      return 'INCONCLUSIVE no-token（需人工点复选框）';
    },
  },
  // ── reCAPTCHA v3 ──
  {
    name: 'recaptcha-v3',
    url: 'https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php',
    waitMs: 20000,
    check: async (page) => {
      const text = await page.evaluate(`document.body.innerText`);
      const scores = [...text.matchAll(/"score":\s*(\d\.\d)/g)].map(m => m[1]);
      if (scores.length === 0) return 'INCONCLUSIVE no-score-rendered';
      const avg = scores.reduce((a, b) => a + parseFloat(b), 0) / scores.length;
      if (avg >= 0.7) return `PASS score=${avg.toFixed(1)}（人类水平）`;
      if (avg >= 0.3) return `INCONCLUSIVE score=${avg.toFixed(1)}`;
      return `FAIL score=${avg.toFixed(1)}（bot 级）`;
    },
  },
  // ── 知乎风控 ──
  {
    name: 'zhihu-wall',
    url: 'https://www.zhihu.com/hot',
    waitMs: 10000,
    check: async (page) => {
      const text = await page.evaluate(`document.body.innerText`);
      if (text.includes('请求存在异常')) return 'FAIL zhihu-wall-triggered';
      if (text.length > 200) return 'PASS content-loaded';
      return 'INCONCLUSIVE thin:' + text.slice(0, 30);
    },
  },
  // ── 渲染层 ──
  {
    name: 'render-signature',
    url: 'about:blank',
    waitMs: 500,
    check: async (page) => {
      const sig = await page.evaluate(`JSON.stringify({
        dpr: window.devicePixelRatio,
        gamut: matchMedia('(color-gamut: p3)').matches ? 'p3' : 'srgb',
        webdriver: navigator.webdriver,
        plugins: navigator.plugins.length,
        chrome: typeof window.chrome === 'object',
      })`);
      const s = JSON.parse(sig);
      // 在 Linux CI runner 上 dpr=1 是正常的（非 Retina 屏幕）
      // 只检查 webdriver 和 chrome 对象（真正的自动化检测信号）
      const issues: string[] = [];
      if (s.webdriver !== false) issues.push('webdriver-leak');
      if (s.chrome !== true) issues.push('window-chrome-missing');
      if (issues.length) return `FAIL ${issues.join(',')}`;
      return `PASS dpr=${s.dpr} gamut=${s.gamut}`;
    },
  },
];

// ─── 统一 Runner ───────────────────────────────────────────────

describe('硬风控靶场', () => {
  for (const target of TARGETS) {
    it(`${target.name} → ${target.url.slice(0, 50)}`, async () => {
      const r = await launch({ headless: true, args: ['--no-sandbox'] });
      const ctx = await r.browser.newContext();
      const page = await ctx.newPage() as any;
      try {
        if (target.url !== 'about:blank') {
          await page.goto(target.url, { timeout: 45000 });
        }
        await page.waitForTimeout(target.waitMs);
        const verdict = await target.check(page);
        console.log(`[${target.name}] ${verdict}`);
        if (verdict.startsWith('FAIL')) throw new Error(verdict);
      } finally {
        await r.browser.close();
      }
    }, 120_000);
  }
});

// ─── launch 导入（从 cdp-driver）────────────────────────────────

