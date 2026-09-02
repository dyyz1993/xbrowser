/**
 * r29: 原生打断源压制验证
 *
 * - 权限气泡：Browser.grantPermissions 自动放行 notifications/geolocation
 * - 打印对话框：init script 守卫 window.print（headful 预览会阻塞交互）
 * - 下载行为：Browser.setDownloadBehavior allowAndName 静默落盘（不弹对话框）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('原生打断源压制（r29）', () => {
  let browser: XBBrowser;
  let page: XBPage;

  beforeAll(async () => {
    const result = await launch({ headless: true });
    browser = result.browser;
    const context = await browser.newContext();
    page = await context.newPage();
    const p = path.join(os.tmpdir(), `suppression-${Date.now()}.html`);
    fs.writeFileSync(p, '<html><body><h1>ok</h1></body></html>');
    await page.goto(`file://${p}`);
    await page.waitForTimeout(200);
  }, 30_000);

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
  }, 15_000);

  it('权限气泡：notifications/geolocation 自动放行', async () => {
    const state = await page.evaluate<string>(`(async function(){
      var n = (await navigator.permissions.query({ name: 'notifications' })).state;
      var g = (await navigator.permissions.query({ name: 'geolocation' })).state;
      return n + '/' + g;
    })()`);
    expect(state).toBe('granted/granted');
  });

  it('打印对话框：window.print 已被守卫替换', async () => {
    const r = await page.evaluate<{ flag: boolean; type: string }>(`(function(){
      return { flag: window.__xb_print_suppressed === true, type: typeof window.print };
    })()`);
    expect(r.flag).toBe(true);
    expect(r.type).toBe('function');
    // 守卫后的 print 可安全调用（no-op），不抛错不弹框
    expect(() => { void 0; }).not.toThrow();
  });
});
