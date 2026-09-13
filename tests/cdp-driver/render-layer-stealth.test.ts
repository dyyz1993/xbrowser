/**
 * 渲染层声明一致性（2026-09-13 实测双模式四差异驱动）：
 * UA 含 Macintosh → 垫片对齐 Retina 声明（dpr=2 / color-gamut p3）；
 * Linux/Windows → 保持真机主流值（dpr=1 / srgb）——垫片不触发即正确。
 */
import { describe, it } from 'vitest';
import { launch } from '../../src/cdp-driver/index.js';

describe('render layer stealth', () => {
  it('headless dpr/colorGamut 与 UA 平台声明一致', async () => {
    const r = await launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await r.browser.newContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const ua = await page.evaluate<string>('navigator.userAgent');
    const dpr = await page.evaluate<number>('window.devicePixelRatio');
    const p3 = await page.evaluate<boolean>('matchMedia("(color-gamut: p3)").matches');
    if (/Macintosh/.test(ua)) {
      // Retina 声明：dpr=2、p3（CI macos runner 与本地 mac）
      if (dpr !== 2 || !p3) throw new Error(`Mac UA 下垫片未对齐: dpr=${dpr} p3=${p3}`);
    } else {
      // Linux/Windows：垫片不触发，原生 1/srgb 即正确（覆盖会偏离主流真机）
      if (dpr !== 1) throw new Error(`非 Mac UA 不应覆盖 dpr（实际 ${dpr}）——保持真机主流值`);
    }
    await r.browser.close();
  }, 60_000);
});
