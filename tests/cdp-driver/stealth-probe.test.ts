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
});

function context_new(browser: XBBrowser): Promise<unknown> {
  return (browser as unknown as { newContext(): Promise<unknown> }).newContext();
}
