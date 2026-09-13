/** 修复验证：headless+垫片 dpr/colorGamut 对齐 Mac 声明 */
import { describe, it } from 'vitest';
import { launch } from '../../src/cdp-driver/index.js';

describe('render fix verify', () => {
  it('headless dpr=2 + colorGamut=p3', async () => {
    const r = await launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await r.browser.newContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const dpr = await page.evaluate('window.devicePixelRatio');
    const p3 = await page.evaluate('matchMedia("(color-gamut: p3)").matches');
    console.log(`VERIFY dpr=${dpr} p3=${p3}`);
    if (dpr !== 2 || p3 !== true) throw new Error(`垫片未生效 dpr=${dpr} p3=${p3}`);
    await r.browser.close();
  }, 60_000);
});
