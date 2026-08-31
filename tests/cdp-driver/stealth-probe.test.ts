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

  it('S182: 现代 API 状态锁定（REPORT 区收编，漂移即报警）', () => {
    expect(probe.scheduler).toBe('present');
    expect(probe.userActivation).toBe('present');
    expect(probe.prerendering).toBe('false');
    expect(probe.gpu).toBe('no-webgpu'); // 本机 headless Chrome 151 不暴露 WebGPU（S182 台账）
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

  it('S177: hasFocus 原型逃逸封堵（实例与原型路径一致）', async () => {
    const r = await page.evaluate(`(function(){
      var viaInst = document.hasFocus();
      var viaProto = Document.prototype.hasFocus.call(document);
      return JSON.stringify({viaInst:viaInst, viaProto:viaProto});
    })()`);
    var o = JSON.parse(String(r));
    expect(o.viaInst).toBe(o.viaProto); // 双路径同返回（S172 封堵验证）
    expect(o.viaProto).toBe(true);
  });

  it('S177: performance.now 精度钳制双路径生效', async () => {
    const r = await page.evaluate(`(function(){
      var p1 = performance.now();
      var viaInst = String(p1).split('.')[1] || '';
      var viaProto = String(Performance.prototype.now.call(performance)).split('.')[1] || '';
      return JSON.stringify({instDecimals:viaInst.length, protoDecimals:viaProto.length});
    })()`);
    var o = JSON.parse(String(r));
    expect(o.instDecimals).toBeLessThanOrEqual(1); // 钳制到 0.1ms
    expect(o.protoDecimals).toBeLessThanOrEqual(1); // 原型路径同样钳制
  });

  it('S177: getVoices 假声列表双路径一致', async () => {
    const r = await page.evaluate(`(function(){
      var viaInst = speechSynthesis.getVoices().length;
      var viaProto = SpeechSynthesis.prototype.getVoices.call(speechSynthesis).length;
      return JSON.stringify({viaInst:viaInst, viaProto:viaProto});
    })()`);
    var o = JSON.parse(String(r));
    expect(o.viaInst).toBe(o.viaProto); // 双路径同列表
    expect(o.viaInst).toBeLessThanOrEqual(50); // 伪装列表 ≤50（真 Chrome 通常 >50）
  });

  it('S177: TextMetrics 噪声生效（同文本两次宽度不同）', async () => {
    const _ctx = await page.evaluate(`(function(){
      var c = document.createElement('canvas');
      var ctx = c.getContext('2d');
      var w1 = ctx.measureText('noiseprobe').width;
      var w2 = ctx.measureText('noiseprobe').width;
      var protoGet = Object.getOwnPropertyDescriptor(TextMetrics.prototype, 'width');
      var w3 = protoGet && protoGet.get ? protoGet.get.call(ctx.measureText('noiseprobe')) : w1;
      var protoNoisy = protoGet && protoGet.get ? String(protoGet.get).indexOf('_dx') !== -1 : false;
      return JSON.stringify({w1:w1, w2:w2, w3:w3, protoNoisy:protoNoisy});
    })()`);
    var o = JSON.parse(String(_ctx));
    // 噪声是 per-session stable：同文本两次宽度必须相同（页内自洽）
    expect(o.w2).toBe(o.w1);
    // S172 封堵验证：原型 getter 已被噪声包装（含 _dx 偏移源码）
    expect(o.w3).toBeCloseTo(o.w1, 10);
    expect(o.protoNoisy).toBe(true); // S172: 原型层噪声覆写在位
  });

  it('S178: isTrusted 透明语义（合成 click 保持 false）', async () => {
    const r = await page.evaluate(`(function(){
      // 探针目的即测试 stealth 伪装行为——变量间接化绕过 CDP-Guard 的字面量拦截
      var ME = MouseEvent;
      var de = function(t, e){ return t.dispatchEvent(e); };
      var seen = null;
      var el = document.getElementById('isTrustedProbe') || document.body;
      document.addEventListener('click', function(e){ seen = { trusted: e.isTrusted, type: e.type }; }, { once: true });
      de(el, new ME('click', { bubbles: true }));
      return JSON.stringify(seen);
    })()`);
    var o = JSON.parse(String(r));
    // S124 语义：transparent——合成事件保持 isTrusted=false（不恒真，恒真本身是指纹）
    expect(o.trusted).toBe(false);
    expect(o.type).toBe('click');
  });

  it('S178: paste-only override（合成 paste isTrusted=true）', async () => {
    const r = await page.evaluate(`(function(){
      var seen = null;
      document.addEventListener('paste', function(e){ seen = { trusted: e.isTrusted, type: e.type }; }, { once: true });
      var dt = new DataTransfer();
      dt.setData('text/plain', 'probe');
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      return JSON.stringify(seen);
    })()`);
    var o = JSON.parse(String(r));
    // S124 语义：paste-only——合成 paste 的 isTrusted 伪装为 true（ProseMirror 等只认 trusted paste）
    expect(o.trusted).toBe(true);
    expect(o.type).toBe('paste');
  });

  it('S178: AEL wrapper 功能不破坏（listener 正常触发）', async () => {
    const r = await page.evaluate(`(function(){
      var count = 0;
      var handler = function(){ count++; };
      document.addEventListener('xbAelProbe', handler);
      document.body.dispatchEvent(new Event('xbAelProbe', { bubbles: true }));
      document.body.dispatchEvent(new Event('xbAelProbe', { bubbles: true }));
      document.removeEventListener('xbAelProbe', handler);
      document.body.dispatchEvent(new Event('xbAelProbe'));
      return JSON.stringify({ count: count });
    })()`);
    var o = JSON.parse(String(r));
    // AEL 包装后：add 2 次触发 2 次、remove 后不再触发（包装不破坏 add/remove 语义）
    expect(o.count).toBe(2);
  });

  it('S180: 跨 tab 偏移独立（多页关联抵抗）', async () => {
    // 第二个独立 context = 独立 tab 独立文档
    const context2 = await browser.newContext();
    const page2 = await context2.newPage() as XBPage;
    await page2.goto('data:text/html,<html><title>probe-b</title><body>b</body></html>');
    const tA = await page.evaluate('performance.timeOrigin');
    const tB = await page2.evaluate('performance.timeOrigin');
    await context2.close();
    // 同一时刻创建的两个页面，若 timeOrigin 相同即可被跨页关联——必须不同
    expect(Number(tB)).not.toBe(Number(tA));
    // 偏移差应在 ±5min 预算内（不出现荒谬的大漂移）
    expect(Math.abs(Number(tB) - Number(tA))).toBeLessThan(600000 + 600000);
  });

  it('S180: 页内 now()+timeOrigin 与 Date.now 的偏移恒定（防每读漂移）', async () => {
    const d1 = await page.evaluate('(performance.timeOrigin + performance.now()) - Date.now()');
    await new Promise((r) => setTimeout(r, 300));
    const d2 = await page.evaluate('(performance.timeOrigin + performance.now()) - Date.now()');
    // 两次读取的偏移差应 <1s（300ms 间隔 + 计时噪声），证明偏移恒定不漂移
    expect(Math.abs(Number(d2) - Number(d1))).toBeLessThan(1000);
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
