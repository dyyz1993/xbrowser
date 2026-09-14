/**
 * M5 human-gate 端到端演练（分级自愈阶梯目标卡）：
 *   验证码场景 → webhook 推送（Drel 格式 + 局域网 viewer 地址）→ 人工处理 → 流程继续。
 *
 * 链路断言：
 *  1. CaptchaDetector 在本地挑战页命中（generic captcha）
 *  2. waitForHuman 发出 captcha-detected 推送（notify URL 路径含 drel.app →
 *     Drel {title, body, url} 格式，且 previewUrl 已 lanify 成局域网 IPv4）
 *  3. "人工"（CDP 真点击挑战按钮）处理后 autoDetect 轮询检出已解除
 *  4. captcha-resolved 推送 + waitForHuman 返回 solved
 *  5. 流程继续：后续命令读取 .dashboard 成功
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import { EventEmitter } from 'events';

import { findChrome } from '../../../src/cdp-driver/launcher.js';
// playwright 缓存被清后系统 Chrome 兜底（launcher findChrome 同源判定）
const e2eAvailable = fs.existsSync('/Users/xuyingzhou/Library/Caches/ms-playwright/chromium_headless_shell-1217')
  || findChrome() !== null;
const describeE2E = e2eAvailable ? describe : describe.skip;

import { createSession, closeSessionByName, destroyBrowser } from '../../../src/index.js';
import { HumanInteractionManager } from '../../../src/human-interaction.js';
import type { WSServer } from '../../../src/websocket-server.js';
import type { Page } from '../../../src/browser-shim.js';

/** 挑战页：generic captcha 容器 + "我是人类"按钮；点击后容器移除、出现 .dashboard */
const CHALLENGE_HTML = `<!doctype html><html><body>
<div class="captcha-container">
  <p>请完成人机验证</p>
  <button id="im-human">我是人类</button>
</div>
<script>
  document.getElementById('im-human').addEventListener('click', function () {
    document.querySelector('.captcha-container').remove();
    var d = document.createElement('div');
    d.className = 'dashboard';
    d.textContent = 'M5-PASSED';
    document.body.appendChild(d);
  });
</script>
</body></html>`;
const CHALLENGE_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(CHALLENGE_HTML);

/** WSServer 测试替身：HumanInteractionManager 只用 registerSession/getPort/broadcast + EventEmitter */
class StubWSServer extends EventEmitter {
  registerSession(): void { /* no-op */ }
  getPort(): number { return 9224; }
  broadcast(): void { /* no-op */ }
}

describeE2E('M5 human-gate drill (escalation ladder)', () => {
  let receiver: http.Server;
  let receiverPort = 0;
  const payloads: Array<Record<string, unknown>> = [];
  let prevNotifyUrl: string | undefined;
  let prevAutoOpen: string | undefined;

  beforeAll(async () => {
    receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { payloads.push(JSON.parse(body) as Record<string, unknown>); } catch { /* ignore */ }
        res.writeHead(200); res.end('ok');
      });
    });
    await new Promise<void>((r) => { receiver.listen(0, '127.0.0.1', () => r()); });
    receiverPort = (receiver.address() as { port: number }).port;
    // 路径含 drel.app → WebhookNotifier 走 Drel 格式 + lanify（不改生产判定逻辑）
    prevNotifyUrl = process.env.XBROWSER_NOTIFY_URL;
    prevAutoOpen = process.env.XBROWSER_AUTO_OPEN;
    process.env.XBROWSER_NOTIFY_URL = `http://127.0.0.1:${receiverPort}/drel.app/sim`;
    process.env.XBROWSER_AUTO_OPEN = 'false';
  });

  afterAll(async () => {
    if (prevNotifyUrl === undefined) delete process.env.XBROWSER_NOTIFY_URL;
    else process.env.XBROWSER_NOTIFY_URL = prevNotifyUrl;
    if (prevAutoOpen === undefined) delete process.env.XBROWSER_AUTO_OPEN;
    else process.env.XBROWSER_AUTO_OPEN = prevAutoOpen;
    await new Promise<void>((r) => { receiver.close(() => r()); });
    await closeSessionByName('m5-drill').catch(() => {});
    await destroyBrowser().catch(() => {});
  });

  it(
    'captcha → Drel push (lanified viewer url) → human solves → flow continues',
    { timeout: 90_000 },
    async () => {
      const session = await createSession('m5-drill', CHALLENGE_URL, { headless: true });
      const page = session.page as unknown as Page;

      // 等挑战页就绪（data URL 导航极快，一轮轮询足够）
      await page.waitForSelector('.captcha-container', { timeout: 10_000 });

      const manager = new HumanInteractionManager(new StubWSServer() as unknown as WSServer, page);

      // "人工"：4 秒后 CDP 真点击挑战按钮（模拟人工在 viewer/direct 页处理）
      const humanTimer = setTimeout(() => {
        page.click('#im-human').catch(() => { /* waitForHuman 的超时兜底 */ });
      }, 4_000);

      try {
        const result = await manager.waitForHuman({ reason: 'M5 演练：generic captcha', timeout: 60, detectInterval: 1_500 });

        // ── 步骤 4/5：人工处理后流程继续 ──
        expect(result.solved).toBe(true);
        expect(result.method).toBe('auto-detected');

        const dash = await page.textContent('.dashboard');
        expect(dash).toContain('M5-PASSED');
      } finally {
        clearTimeout(humanTimer);
      }

      // ── 步骤 2：推送证据（Drel 格式 + lanify）──
      // 接收器异步落账，轮询等两条（detected + resolved）
      const deadline = Date.now() + 10_000;
      while (payloads.length < 2 && Date.now() < deadline) {
        await new Promise((r) => { setTimeout(r, 300); });
      }
      expect(payloads.length).toBeGreaterThanOrEqual(2);

      const detected = payloads.find((p) => String(p.title).includes('验证码'));
      const resolved = payloads.find((p) => String(p.title).includes('已解决'));
      expect(detected).toBeDefined();
      expect(resolved).toBeDefined();

      // Drel 三字段格式
      expect(typeof detected?.title).toBe('string');
      expect(typeof detected?.body).toBe('string');
      // lanify：viewer url 不应残留 localhost（手机可达的局域网地址）
      const viewerUrl = String(detected?.url ?? '');
      expect(viewerUrl).not.toContain('localhost');
      expect(viewerUrl).toMatch(/^http:\/\/\d{1,3}(\.\d{1,3}){3}:9224$/);
    },
  );
});
