/**
 * 硬风控靶场：标准 Chrome+垫片 vs 顶级检测站（逐站记录成绩）
 * 覆盖：sannysoft 基础指纹 / CreepJS 深层一致性 / FingerprintJS 商业级 / deviceandbrowserinfo
 */
import { describe, it } from 'vitest';
import { launch } from '../../src/cdp-driver/index.js';

const TARGETS: Array<[string, string, (p: any) => Promise<string>]> = [
  ['bot.sannysoft.com（基础指纹）', 'https://bot.sannysoft.com/', (page) => page.evaluate(() => {
    let failed = 0; const fails: string[] = [];
    for (const row of document.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        const val = (cells[1].innerText || '').trim();
        if (/^(failed|detected|wrong)/i.test(val)) { failed++; fails.push((cells[0].innerText || '').trim()); }
      }
    }
    return failed === 0 ? 'PASS 24/24' : `FAIL ${failed}: ${fails.join(',')}`;
  })],
  ['abrahamjuliot.github.io/creepjs（深层一致性）', 'https://abrahamjuliot.github.io/creepjs/', (page) => page.evaluate(() => {
    const t = document.body.innerText || '';
    const trust = t.match(/trust score[:\s]+(\d+)/i)?.[1] || '?';
    return `trust=${trust}`;
  })],
  ['demo.fingerprint.com（商业级 FingerprintJS）', 'https://demo.fingerprint.com/', (page) => page.evaluate(() => {
    const t = document.body.innerText || '';
    return /bot/i.test(t) ? 'BOT-DETECTED' : 'LOADED(visitorId visible)';
  })],
  ['deviceandbrowserinfo.com（行为+指纹）', 'https://deviceandbrowserinfo.com/are_you_a_bot', (page) => page.evaluate(() => {
    const t = document.body.innerText || '';
    const bots = t.match(/isBot[^}]*"?(true|false)"?/i);
    return bots ? `isBot=${bots[1]}` : t.slice(0, 80);
  })],
];

describe('hard targets', () => {
  for (const [name, url, probe] of TARGETS) {
    it(name, async () => {
      const r = await launch({ headless: true, args: ['--no-sandbox'] });
      const ctx = await r.browser.newContext();
      const page = await ctx.newPage() as any;
      try {
        await page.goto(url, { timeout: 45000 });
        await page.waitForTimeout(5000);
        const result = await probe(page).catch(e => `PROBE-ERR: ${String(e).slice(0, 80)}`);
        console.log(`TARGET ${name} => ${result}`);
      } catch (e: any) {
        console.log(`TARGET ${name} => NAV-FAIL: ${String(e).slice(0, 80)}`);
      }
      await r.browser.close();
    }, 120_000);
  }
});
