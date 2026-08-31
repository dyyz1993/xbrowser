/**
 * stealth 运行时探针（S174）：在默认 launch 环境里跑已知检测面，
 * 输出露馅清单。用于驱动 stealth 覆盖补全——每加一层伪装，重跑本
 * 探针确认对应条目转绿。
 *
 * 断言只锁"已修复"的条目；未修复的检测面以 REPORT 形式输出，不红——
 * 先看清全貌，再逐个收编。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';

const TEST_TIMEOUT = 30_000;
const LAUNCH_OPTS = process.env.CDP_ENDPOINT
  ? { cdpEndpoint: process.env.CDP_ENDPOINT }
  : { headless: true, args: ['--no-sandbox', '--disable-gpu'] };

describe('stealth 运行时探针（S174 检测面覆盖审计）', { timeout: TEST_TIMEOUT }, () => {
  let browser: XBBrowser;
  let page: XBPage;
  let probe: Record<string, unknown>;

  beforeAll(async () => {
    const result = await launch(LAUNCH_OPTS);
    browser = result.browser;
    const context = await context_new(browser);
    page = await context.newPage();
    await page.goto('data:text/html,<html><title>probe</title><body>ok</body></html>');

    const expr = `(async()=>{
      var r = {};
      r.ua = navigator.userAgent;
      r.webdriver = navigator.webdriver;
      r.vis = document.visibilityState;
      r.screen = screen.width + 'x' + screen.height;
      r.hasUAD = !!navigator.userAgentData;
      if (navigator.userAgentData) {
        r.uadBrands = navigator.userAgentData.brands.map(function(b){return b.brand}).join('|');
        try {
          var h = await navigator.userAgentData.getHighEntropyValues(['uaFullVersion','platformVersion','architecture','model']);
          r.uaFullVersion = h.uaFullVersion;
          r.platformVersion = h.platformVersion;
        } catch(e) { r.uadErr = String(e); }
      }
      try {
        if (navigator.gpu && navigator.gpu.requestAdapter) {
          var ad = await navigator.gpu.requestAdapter();
          r.gpu = ad ? 'adapter-present' : 'adapter-null';
          try {
            var info = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null);
            if (info) r.gpuInfo = { vendor: info.vendor, architecture: info.architecture, description: (info.description||'').slice(0,40) };
          } catch(e) { r.gpuInfoErr = String(e).slice(0,40); }
        } else {
          r.gpu = 'no-webgpu';
        }
      } catch(e) { r.gpu = 'err:' + String(e).slice(0,30); }
      r.scheduler = typeof scheduler !== 'undefined' && typeof (scheduler || {}).yield === 'function' ? 'present' : 'absent';
      r.storageBuckets = typeof (navigator.storage || {}).buckets === 'object' ? 'present' : 'absent';
      r.prerendering = document.prerendering === undefined ? 'unsupported' : String(document.prerendering);
      r.userActivation = typeof navigator.userActivation === 'object' ? 'present' : 'absent';
      r.windowManagement = typeof document.hasPrivateTokens === 'function' ? 'present' : 'absent';
      return JSON.stringify(r);
    })()`;
    const raw = await page.evaluate(expr);
    probe = JSON.parse(String(raw));
    console.log('\n[stealth-probe REPORT]', JSON.stringify(probe, null, 2), '\n');
  }, 60_000);

  function context_new(b: XBBrowser): Promise<unknown> {
    return (b as unknown as { newContext(): Promise<unknown> }).newContext();
  }

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30_000);

  it('UA 不含 Headless（最高频检测面）', () => {
    console.log('[ua]', probe.ua);
    expect(String(probe.ua)).not.toContain('Headless');
  });

  it('navigator.webdriver 为 false 或 undefined', () => {
    expect([false, undefined, null]).toContain(probe.webdriver);
  });

  it('userAgentData brands 不含 Headless 标识', () => {
    if (!probe.hasUAD) return; // 无 UA-CH 的环境无此泄露面
    expect(String(probe.uadBrands)).not.toContain('Headless');
  });

  it('visibilityState 为 visible', () => {
    expect(probe.vis).toBe('visible');
  });

  it('S176: timeOrigin 同页恒定且与 Date.now 联动', async () => {
    const t1 = await page.evaluate('performance.timeOrigin');
    const t2 = await page.evaluate('performance.timeOrigin');
    expect(t1).toBe(t2); // 页内自洽：两次读取恒定
    const drift = await page.evaluate(
      'Math.abs((performance.timeOrigin + performance.now()) - Date.now())'
    );
    expect(Number(drift)).toBeLessThan(300000); // 偏移 ±5min 内，页内绝对时间自洽
  });

  it('S176: 跨导航偏移变化（不可关联）', async () => {
    const before = await page.evaluate('performance.timeOrigin');
    await page.goto('data:text/html,<html><title>probe2</title><body>2</body></html>');
    const after = await page.evaluate('performance.timeOrigin');
    expect(Number(after)).not.toBe(Number(before)); // 新文档新偏移
  });

  it('S176: 伪装 patch 性能预算（<5ms）', async () => {
    const cost = await page.evaluate(`(function(){
      var t0 = performance.now();
      document.dispatchEvent(new Event('visibilitychange'));
      return performance.now() - t0;
    })()`);
    expect(Number(cost)).toBeLessThan(5);
  });
});

function context_new(browser: XBBrowser): Promise<unknown> {
  return (browser as unknown as { newContext(): Promise<unknown> }).newContext();
}
