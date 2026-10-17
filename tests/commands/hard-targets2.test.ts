/** 第二轮：creepjs 深度解析 + fingerprint.com bot 判定精确读 */
import { describe, it } from 'vitest';
import { launch } from '../../src/cdp-driver/index.js';

describe('hard targets r2', () => {
  it('creepjs 深层一致性', async () => {
    const r = await launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await r.browser.newContext();
    const page = await ctx.newPage() as any;
    await page.goto('https://abrahamjuliot.github.io/creepjs/', { timeout: 45000 });
    await page.waitForTimeout(12000); // creepjs 异步计算
    const res = await page.evaluate(() => {
      const t = document.body.innerText || '';
      // creepjs 结果区：trust score / lies count
      const trust = t.match(/trust\s+score[^\d]*(\d+)/i)?.[1];
      return { trust: trust || 'N/A', lies: 'N/A', head: t.slice(0, 200).replace(/\n/g, '|') };
    });
    console.log('CREEPJS:', JSON.stringify(res).slice(0, 300));
    await r.browser.close();
  }, 120_000);

  it('fingerprint.com bot 精确判定', async () => {
    const r = await launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await r.browser.newContext();
    const page = await ctx.newPage() as any;
    await page.goto('https://demo.fingerprint.com/playground', { timeout: 45000 });
    await page.waitForTimeout(10000);
    const res = await page.evaluate(() => {
      const t = document.body.innerText || '';
      const botM = t.match(/(bot\s*(?:detected| Suspected)?[:\s]*)(true|false|yes|no)/i);
      return { hasVisitor: t.includes('visitorId'), botVerdict: botM ? botM[0] : 'no-verdict-text', sample: t.slice(0, 150).replace(/\n/g, '|') };
    });
    console.log('FP:', JSON.stringify(res).slice(0, 350));
    await r.browser.close();
  }, 120_000);
});
