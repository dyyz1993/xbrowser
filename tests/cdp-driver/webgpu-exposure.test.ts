/**
 * WebGPU 暴露面变体实测（S182 台账收编）：
 * 对比 --disable-gpu 与默认 GPU 参数下 navigator.gpu 的暴露差异。
 * 结论写回 stealth-probe 台账。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';

const TIMEOUT = 30_000;

async function probeGpu(opts: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await launch(opts);
  const browser = result.browser;
  try {
    const context = await browser.newContext();
    const page = (await context.newPage()) as XBPage;
    await page.goto('data:text/html,<html><title>gpu</title><body>ok</body></html>');
    const raw = await page.evaluate(`(async()=>{
      var r = { hasGpu: !!navigator.gpu };
      if (navigator.gpu && navigator.gpu.requestAdapter) {
        try {
          var ad = await navigator.gpu.requestAdapter();
          r.adapter = ad ? 'present' : 'null';
          if (ad) {
            var info = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : {});
            r.vendor = info.vendor || '';
            r.architecture = info.architecture || '';
            r.description = (info.description || '').slice(0, 50);
          }
        } catch (e) { r.adapter = 'err:' + String(e).slice(0, 30); }
      }
      return JSON.stringify(r);
    })()`);
    return JSON.parse(String(raw));
  } finally {
    await browser.close().catch(() => {});
  }
}

describe('WebGPU 暴露面变体实测（S182）', { timeout: TIMEOUT }, () => {
  it('no-gpu 变体（--disable-gpu）：台账基线', async () => {
    const r = await probeGpu({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    console.log('[no-gpu]', JSON.stringify(r));
    expect(r.hasGpu).toBe(false); // 基线：navigator.gpu 不存在
  });

  it('默认 GPU 变体：暴露形态记录', async () => {
    const r = await probeGpu({ headless: true, args: ['--no-sandbox'] });
    console.log('[gpu-default]', JSON.stringify(r));
    // 只记录不断言——暴露形态依赖 Chrome 版本与硬件
    expect(r).toHaveProperty('hasGpu');
  });
});
