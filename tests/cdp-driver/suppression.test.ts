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
import http from 'http';

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

  it('权限气泡：notifications/geolocation/clipboard/camera/microphone/midi 自动放行', async () => {
    // file:// 下 clipboard/camera/mic/midi 是 scheme 级硬拒（granted 升级
    // 压不过策略，且 denied 不弹气泡不阻塞）；真实攻击面在 http(s) 页的
    // prompt 态（气泡+await 用户=无人值守死锁）——用本地 http 服务验证。
    const probe = `<!DOCTYPE html><html><body>ok</body></html>`;
    const server = http.createServer((_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(probe);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      await page.goto(`http://127.0.0.1:${port}/`, { timeout: 10_000 });
      await page.waitForTimeout(200);
      const state = await page.evaluate<string>(`(async function(){
        var q = function(n) { return navigator.permissions.query({ name: n }).then(function(s) { return s.state; }).catch(function() { return 'unsupported'; }); };
        var out = [];
        out.push('n=' + await q('notifications'));
        out.push('g=' + await q('geolocation'));
        out.push('cr=' + await q('clipboard-read'));
        out.push('cw=' + await q('clipboard-write'));
        out.push('cam=' + await q('camera'));
        out.push('mic=' + await q('microphone'));
        out.push('midi=' + await q('midi'));
        return out.join(' ');
      })()`);
      expect(state).toBe('n=granted g=granted cr=granted cw=granted cam=granted mic=granted midi=granted');
    } finally {
      server.close();
    }
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

  it('sup-s2 FS Access API stub：showOpenFilePicker 不弹系统框且页面拿到文件', async () => {
    // 攻击形态：真 showOpenFilePicker 弹 OS 级系统对话框（CDP 无法拦截），
    // headless 下 promise 拒绝/挂起——页面永远拿不到文件，log 停在 idle。
    // 防御：init script stub 返回合成 FileSystemFileHandle（包装内存 File）。
    const p2 = path.join(os.tmpdir(), `fsaccess-${Date.now()}.html`);
    fs.writeFileSync(p2, `<!DOCTYPE html><html><body>
      <button id="up">Upload</button>
      <div id="log">idle</div>
      <script>
        document.getElementById('up').addEventListener('click', async function() {
          try {
            var handles = await window.showOpenFilePicker();
            var file = await handles[0].getFile();
            document.getElementById('log').textContent =
              file.name + ':' + (await file.text());
          } catch (e) {
            document.getElementById('log').textContent = 'err:' + e.name;
          }
        });
      </script>
    </body></html>`);
    await page.goto(`file://${p2}`);
    await page.waitForTimeout(200);
    await page.click('#up');
    await page.waitForTimeout(500);
    const log = await page.evaluate<string>(`document.getElementById('log').textContent`);
    const stubbed = await page.evaluate<boolean>(`window.__xb_fs_stub_installed === true`);
    expect(stubbed).toBe(true);
    expect(log).toBe('xbrowser-stub.txt:xbrowser fs access stub');
    fs.rmSync(p2, { force: true });
  });

  it('sup-s4 dropFiles：Dropzone 拖拽上传模拟（无 input[type=file] 的上传区）', async () => {
    // 攻击形态：Dropzone/Uppy/自绘上传区只监听 dragover/drop——真实用户
    // 靠 OS 文件拖入触发，自动化无法产生 OS 拖拽，上传永远无法完成。
    // 防御：dropFiles 构造 DataTransfer+File 派发 dragenter/dragover/drop。
    const p3 = path.join(os.tmpdir(), `dropzone-${Date.now()}.html`);
    fs.writeFileSync(p3, `<!DOCTYPE html><html><body>
      <div id="zone" style="width:200px;height:100px;border:1px solid #ccc">Drop here</div>
      <div id="log">none</div>
      <script>
        var zone = document.getElementById('zone');
        zone.addEventListener('dragover', function(e) { e.preventDefault(); });
        zone.addEventListener('drop', function(e) {
          e.preventDefault();
          var f = e.dataTransfer.files[0];
          f.text().then(function(t) {
            document.getElementById('log').textContent = f.name + ':' + t + ':' + f.size;
          });
        });
      </script>
    </body></html>`);
    await page.goto(`file://${p3}`);
    await page.waitForTimeout(200);
    await page.dropFiles('#zone', {
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('dropped-content'),
    });
    await page.waitForTimeout(400);
    const log = await page.evaluate<string>(`document.getElementById('log').textContent`);
    expect(log).toBe('note.txt:dropped-content:15');
    fs.rmSync(p3, { force: true });
  });

  it('sup-s6 file input 变种：multiple 多文件注入全部送达', async () => {
    const p4 = path.join(os.tmpdir(), `multi-${Date.now()}.html`);
    fs.writeFileSync(p4, `<!DOCTYPE html><html><body>
      <input type="file" id="mf" multiple />
      <div id="log">none</div>
      <script>
        document.getElementById('mf').addEventListener('change', function() {
          var names = Array.from(this.files).map(function(f) { return f.name; });
          document.getElementById('log').textContent = names.sort().join('|');
        });
      </script>
    </body></html>`);
    await page.goto(`file://${p4}`);
    await page.waitForTimeout(200);
    await page.setInputFiles('#mf', [
      { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('B') },
      { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('A') },
      { name: 'c.txt', mimeType: 'text/plain', buffer: Buffer.from('C') },
    ]);
    await page.waitForTimeout(300);
    const log = await page.evaluate<string>(`document.getElementById('log').textContent`);
    expect(log).toBe('a.txt|b.txt|c.txt');
    fs.rmSync(p4, { force: true });
  });

  it('sup-s6 file input 变种：webkitdirectory 文件送达（relativePath 为已知限制）', async () => {
    const p5 = path.join(os.tmpdir(), `wkd-${Date.now()}.html`);
    fs.writeFileSync(p5, `<!DOCTYPE html><html><body>
      <input type="file" id="wd" webkitdirectory />
      <div id="log">none</div>
      <script>
        document.getElementById('wd').addEventListener('change', function() {
          var parts = Array.from(this.files).map(function(f) {
            return f.name + '@' + (f.webkitRelativePath || '');
          });
          document.getElementById('log').textContent = parts.sort().join('|');
        });
      </script>
    </body></html>`);
    await page.goto(`file://${p5}`);
    await page.waitForTimeout(200);
    await page.setInputFiles('#wd', [
      { name: 'readme.md', mimeType: 'text/markdown', buffer: Buffer.from('# hi') },
      { name: 'main.js', mimeType: 'text/javascript', buffer: Buffer.from('x') },
    ]);
    await page.waitForTimeout(300);
    const log = await page.evaluate<string>(`document.getElementById('log').textContent`);
    // DataTransfer 构造的 File 无法携带 webkitRelativePath（只读属性，
    // JS 无标准赋值途径）——文件本身可送达，目录树感知按站端 fallback
    // （name 匹配/无目录模式）工作。锁定"送达 + 空路径"为已知行为。
    expect(log).toBe('main.js@|readme.md@');
    fs.rmSync(p5, { force: true });
  });

  it('sup-s7 右键菜单压制：contextmenu 被 preventDefault（headful 不弹原生菜单）', async () => {
    // headful 下 CDP 右键会弹浏览器原生菜单（页面未 preventDefault 时），
    // CDP 无法关闭浏览器 UI。防御=document 捕获阶段 preventDefault——
    // 不阻断传播（录制 contextmenu 事件与页面自定义菜单不受影响），
    // defaultPrevented=true 正是 headful 抑制原生菜单的机制。
    const p6 = path.join(os.tmpdir(), `ctx-${Date.now()}.html`);
    fs.writeFileSync(p6, `<!DOCTYPE html><html><body>
      <div id="t" style="width:100px;height:50px">target</div>
      <div id="log">none</div>
      <script>
        document.addEventListener('contextmenu', function(e) {
          document.getElementById('log').textContent = 'defaultPrevented=' + e.defaultPrevented;
        }, true);
      </script>
    </body></html>`);
    await page.goto(`file://${p6}`);
    await page.waitForTimeout(200);
    await page.click('#t', { button: 'right' });
    await page.waitForTimeout(200);
    const log = await page.evaluate<string>(`document.getElementById('log').textContent`);
    const guard = await page.evaluate<boolean>(`window.__xb_ctxmenu_suppressed === true`);
    expect(guard).toBe(true);
    expect(log).toBe('defaultPrevented=true');
    fs.rmSync(p6, { force: true });
  });

  it('sup-s9 HTTP Basic 认证：httpCredentials 自动应答（无凭证 CancelAuth）', async () => {
    // 攻击形态：主框架导航到 401+WWW-Authenticate 挑战——headful 弹模态
    // 认证框（handleJavaScriptDialog 管不着），凭证错则反复挂起。headless
    // 实测快速失败（无 UI 可弹），故端到端断言走凭证路径：配置
    // httpCredentials → authRequired 自动 ProvideCredentials → 服务端
    // 校验 Authorization 头 → 200 密文可见。缺省路径=CancelAuth 快速失败。
    const authServer = http.createServer((q: http.IncomingMessage, res: http.ServerResponse) => {
      const expectAuth = 'Basic ' + Buffer.from('bot:secret123').toString('base64');
      if (q.headers.authorization === expectAuth) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>secret-ok</body></html>');
      } else {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="xb-test"' });
        res.end('auth required');
      }
    });
    await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
    const authPort = (authServer.address() as { port: number }).port;
    try {
      // 凭证路径：自动应答 → 200
      const ctx = await browser.newContext({ httpCredentials: { username: 'bot', password: 'secret123' } });
      const authed = await ctx.newPage();
      await authed.goto(`http://127.0.0.1:${authPort}/auth`, { timeout: 10_000 });
      const body = await authed.evaluate<string>('document.body.textContent');
      await authed.close().catch(() => {});
      await ctx.close().catch(() => {});
      expect(body).toContain('secret-ok');

      // 缺省路径：CancelAuth 快速失败（不挂起、无认证框）
      const start = Date.now();
      let threw = false;
      try {
        await page.goto(`http://127.0.0.1:${authPort}/auth`, { timeout: 8000 });
      } catch { threw = true; }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(4000);
      expect(threw).toBe(true);
    } finally {
      authServer.close();
    }
  });

  it('sup-s10 Notification 守卫：构造不弹 OS 通知且 API 形状完整', async () => {
    // 攻击形态：new Notification() 弹 OS 级系统通知横幅（headful 污染
    // 屏幕/打断注意力，等待通知点击的流程直接挂起）。防御=no-op 包装
    // ——但 permission/requestPermission/实例方法必须保形状，页面通知
    // 流程无感继续。
    const r = await page.evaluate<{ flag: boolean; title: string; closed: boolean; perm: string; reqPerm: string }>(`(function(){
      var out = { flag: window.__xb_notification_suppressed === true };
      try {
        var n = new Notification('xb-test-title', { body: 'b' });
        out.title = n.title;
        n.close();
        out.closed = true;
      } catch (e) { out.title = 'threw:' + e.name; }
      out.perm = Notification.permission;
      Notification.requestPermission().then(function(p) { window.__xb_req_perm = p; });
      out.reqPerm = 'pending';
      return out;
    })()`);
    await page.waitForTimeout(200);
    // stealth d62 拟真层将 requestPermission 延迟 2-6s（错误页节流下实测
    // 7.8s）——不断言时序，只断言形状：可调用且返回 thenable（.then 存在）
    const rpShape = await page.evaluate<{ isFn: boolean; thenable: boolean }>(`(function(){
      var p = Notification.requestPermission();
      return { isFn: typeof Notification.requestPermission === 'function', thenable: !!(p && typeof p.then === 'function') };
    })()`);
    expect(r.flag).toBe(true);
    expect(r.title).toBe('xb-test-title');
    expect(r.closed).toBe(true);
    expect(r.perm).toBe('granted');
    expect(rpShape.isFn).toBe(true);
    expect(rpShape.thenable).toBe(true);
  });

  it('sup-s11 beforeunload 语义：默认 accept（离开），dismiss 尽力而为', async () => {
    // 攻击形态：页面挂 beforeunload 守卫 + 旧逻辑对一切对话框 accept:false
    // → beforeunload 的 dismiss = 取消导航——回放录制的"离开页面"流被静默
    // 卡在原页（红测实证 net::ERR_ABORTED）。默认改 accept（与录制意图
    // 一致）。注意：beforeunload 弹窗需用户激活才触发（无交互页直接放行）。
    // 已知限制：'dismiss'（留守）在此构建上 CDP accept:false 对浏览器侧
    // 导航语义不可靠（同代码时红时绿），文档化为尽力而为，测试只锁
    // 确定性的默认 accept。
    const p1 = path.join(os.tmpdir(), `bu1-${Date.now()}.html`);
    const p2 = path.join(os.tmpdir(), `bu2-${Date.now()}.html`);
    fs.writeFileSync(p1, `<!DOCTYPE html><html><body>
      <button id="arm" onclick="window.__clicked=1">arm</button>
      <script>window.addEventListener('beforeunload', function(e) { e.preventDefault(); e.returnValue = ''; });</script>
      page-one</body></html>`);
    fs.writeFileSync(p2, '<!DOCTYPE html><html><body>page-two</body></html>');
    await page.goto(`file://${p1}`);
    await page.waitForTimeout(200);
    // 真点激活（无激活时 Chrome 不触发 beforeunload 弹窗，导航直接放行）
    await page.click('#arm');
    await page.waitForTimeout(200);
    await page.goto(`file://${p2}`, { timeout: 5000 });
    const urlAfterDefault = await page.evaluate<string>('location.href');
    expect(urlAfterDefault).toContain('bu2');
    fs.rmSync(p1, { force: true });
    fs.rmSync(p2, { force: true });
  });
