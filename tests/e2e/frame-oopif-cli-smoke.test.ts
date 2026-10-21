/**
 * OOPIF --frame CLI 冒烟（真 dist/cli.js 二进制端到端）
 *
 * 与验收套件（直接调 handler）的区别：这条走**完整 CLI 链路**——
 * argv 解析 → 全局 --frame 提取 → chain 注入 → daemon 转发 → executor
 * → 命令 handler → CDP。即 AGENTS §14 写给用户的用法原样跑一遍。
 *
 * 运行前置：npm run build（dist 必须新）；自动停旧 daemon（同版本旧代码
 * 不触发版本重启，必须显式停，CLI 会从本仓 dist 拉起新 daemon——daemon
 * 自动重启是产品内置行为，测试后无需恢复）。
 *
 * 运行：npm run build && npx vitest run --config vitest.e2e.config.ts tests/e2e/frame-oopif-cli-smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../../src/cdp-driver/launcher.js';
import { killAllDaemonProcesses } from '../../src/daemon/daemon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cli.js');

function sliderPage(nestedSrc: string | null): string {
  const nested = nestedSrc ? `<iframe src="${nestedSrc}" style="position:absolute;left:0;top:500px;width:820px;height:640px"></iframe>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div id="heading">Smoke Page</div>
<input id="name" value="" style="position:absolute;left:0;top:60px;width:200px;height:28px">
<button id="btn-like" style="position:absolute;left:0;top:220px;width:120px;height:36px">Like</button>
<div id="like-count" style="position:absolute;left:0;top:270px">0</div>
<div id="track" style="position:absolute;left:0;top:400px;width:300px;height:44px;background:#ddd">
  <div id="handle" style="position:absolute;left:10px;top:2px;width:40px;height:40px;background:#4a90d9"></div>
</div>
<div id="slider-result" style="position:absolute;left:320px;top:404px">pending</div>
<div id="buttons-violations" style="position:absolute;left:320px;top:440px">0</div>
<div style="position:absolute;left:0;top:700px;width:10px;height:600px"></div>
${nested}
<script>
(function(){
  var track=document.getElementById('track'),handle=document.getElementById('handle');
  var dragging=false,violations=0;
  function trackX(e){return e.clientX-track.getBoundingClientRect().left;}
  handle.addEventListener('mousedown',function(e){dragging=true;if(e.buttons!==1)violations++;e.preventDefault();});
  window.addEventListener('mousemove',function(e){if(!dragging)return;if(e.buttons!==1)violations++;var x=Math.max(0,Math.min(260,trackX(e)-20));handle.style.left=x+'px';});
  window.addEventListener('mouseup',function(e){if(!dragging)return;dragging=false;
    var x=parseFloat(handle.style.left||'10')+20;var ok=Math.abs(x-240)<=18;
    document.getElementById('slider-result').textContent=ok?'success':'fail';
    document.getElementById('buttons-violations').textContent=String(violations);});
  document.getElementById('btn-like').addEventListener('click',function(){var c=document.getElementById('like-count');c.textContent=String(Number(c.textContent)+1);});
})();
</script>
</body></html>`;
}

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '0.0.0.0', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

/** 跑真 CLI 二进制；--json 输出走 stdout（daemon 日志走 stderr），取末尾 JSON 对象解析 */
async function cli(args: string[], timeoutMs = 90_000): Promise<{ success: boolean; data: Record<string, unknown>; message?: string }> {
  const child: ChildProcess = spawn('node', [CLI, ...args, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`CLI timeout: xbrowser ${args.join(' ')}\nstderr: ${err.slice(-800)}`)); }, timeoutMs);
    child.on('close', (c) => { clearTimeout(timer); resolve(c); });
    child.on('error', reject);
  });
  // stdout 可能有非 JSON 前缀（daemon/banner）：先试整体，再从各 '{' 起点试
  let parsed: { success?: boolean; data?: Record<string, unknown>; error?: unknown; message?: unknown } | null = null;
  const candidates = [out.trim()];
  let idx = out.indexOf('{');
  while (idx >= 0) { candidates.push(out.slice(idx)); idx = out.indexOf('{', idx + 1); }
  for (const c of candidates) {
    try { parsed = JSON.parse(c); break; } catch { /* 下一个候选 */ }
  }
  if (!parsed) {
    throw new Error(`CLI 输出不可解析（exit=${code}）: xbrowser ${args.join(' ')}\nstdout: ${out.slice(-800)}\nstderr: ${err.slice(-800)}`);
  }
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const message = typeof parsed.error === 'string' ? parsed.error : typeof parsed.message === 'string' ? parsed.message : undefined;
  if (parsed.success === false) {
    throw new Error(`CLI 失败: xbrowser ${args.join(' ')} → ${message ?? JSON.stringify(data).slice(0, 300)}\nstderr: ${err.slice(-500)}`);
  }
  return { success: true, data, message };
}

const CLI_READY = existsSync(CLI);

describe.skipIf(!CLI_READY)('OOPIF --frame CLI 冒烟（dist/cli.js 端到端）', { timeout: 420_000, hookTimeout: 120_000 } as never, () => {
  let p1 = 0;
  let p2 = 0;
  let server1: Server;
  let server2: Server;
  let chrome: { process: ChildProcess; port: number };
  let CDP = '';
  let A_URL = '';
  let FRAME_D = '';

  beforeAll(async () => {
    // 同版本旧 daemon 不会触发版本重启——显式停，首个 CLI 调用自动从本仓 dist 拉新。
    // killAll 后必须确认 9224 真正释放：版本号不变时残留 daemon 会让 CLI 静默
    // 连上旧代码（实测症状：frame 相关命令间歇性全挂，且每次失败点漂移）。
    for (let attempt = 0; attempt < 6; attempt++) {
      await killAllDaemonProcesses().catch(() => {});
      const alive = await fetch('http://localhost:9224/health', { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false);
      if (!alive) break;
      await new Promise((r) => setTimeout(r, 800));
    }

    const s2 = await startServer((req, res) => {
      const host = (req.headers.host || '').split(':')[0];
      if (host === 'c.localhost') res.end(sliderPage(`http://d.localhost:${s2.port}/d`));
      else res.end(sliderPage(null));
    });
    server2 = s2.server; p2 = s2.port;
    const s1 = await startServer((req, res) => {
      const host = (req.headers.host || '').split(':')[0];
      if (host === 'localhost') res.end(`<!doctype html><html><body style="margin:0"><iframe src="http://127.0.0.1:${p1}/b" style="position:absolute;left:0;top:60px;width:820px;height:1200px"></iframe></body></html>`);
      else res.end(sliderPage(`http://c.localhost:${p2}/c`));
    });
    server1 = s1.server; p1 = s1.port;
    A_URL = `http://localhost:${p1}/a`;
    FRAME_D = `d.localhost:${p2}`;

    const isolate = [
      `http://localhost:${p1}`, `http://127.0.0.1:${p1}`,
      `http://c.localhost:${p2}`, `http://d.localhost:${p2}`,
    ].join(',');
    const r = await launchChrome({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--site-per-process',
        '--enable-features=IsolateOrigins,site-per-process',
        `--isolate-origins=${isolate}`,
      ],
    });
    chrome = r;
    CDP = `http://127.0.0.1:${r.port}`;
  }, 120_000);

  afterAll(async () => {
    try { chrome?.process?.kill('SIGKILL'); } catch { /* ignore */ }
    server1?.close();
    server2?.close();
  }, 30_000);

  const S = () => ['--cdp', CDP, '--session', 'frame-smoke'];

  it('goto + frames：三层 OOPIF 平铺可见且层级链正确', async () => {
    await cli([...S(), 'goto', A_URL]);
    await new Promise((r) => setTimeout(r, 1500));
    const res = await cli([...S(), 'frames']);
    const frames = (res.data.frames as Array<{ url: string; oopif?: boolean; depth?: number; parentUrl?: string | null }>);
    const d = frames.find((f) => f.url.includes(FRAME_D));
    expect(d, `三层 D 帧应出现在 frames：${JSON.stringify(frames)}`).toBeTruthy();
    expect(d?.oopif).toBe(true);
    expect(d?.depth).toBe(3);
    expect(d?.parentUrl).toContain(`c.localhost:${p2}`);
    const warnings = res.data.warnings as string[] | undefined;
    expect(warnings ?? []).toEqual([]);
  }, 120_000);

  it('eval --frame 读滑块坐标（链内命令级 flag）', async () => {
    const res = await cli([...S(), 'eval', '--frame', FRAME_D, 'JSON.stringify((r=>({x:r.x+r.width/2,y:r.y+r.height/2}))(document.getElementById("handle").getBoundingClientRect()))']);
    const rect = JSON.parse(String(res.data.result)) as { x: number; y: number };
    expect(rect.x).toBeGreaterThan(0);
    expect(rect.y).toBeGreaterThan(0);
  }, 120_000);

  it('标准验证码链：全局 --frame 拖滑块 → success 且 buttons 零违规', async () => {
    // 全局 flag 写法（与 AGENTS §14 文档一致）
    await cli(['--frame', FRAME_D, ...S(), 'mouse move --x 30 --y 422']);
    await cli(['--frame', FRAME_D, ...S(), 'mouse drag --x 240 --y 422 --steps 25']);
    const res = await cli([...S(), 'eval', '--frame', FRAME_D, 'JSON.stringify({r:document.getElementById("slider-result").textContent,v:document.getElementById("buttons-violations").textContent})']);
    const parsed = JSON.parse(String(res.data.result)) as { r: string; v: string };
    expect(parsed.r).toBe('success');
    expect(parsed.v).toBe('0');
  }, 180_000);

  it('fill / click / wheel / text --frame（命令级 flag）全通', async () => {
    await cli([...S(), 'fill', '--frame', FRAME_D, '#name', '三层CLI']);
    const name = await cli([...S(), 'eval', '--frame', FRAME_D, 'document.getElementById("name").value']);
    expect(name.data.result).toBe('三层CLI');

    await cli([...S(), 'click', '--frame', FRAME_D, '#btn-like']);
    const count = await cli([...S(), 'eval', '--frame', FRAME_D, 'document.getElementById("like-count").textContent']);
    expect(count.data.result).toBe('1');

    await cli([...S(), 'mouse', 'wheel', '--frame', FRAME_D, '--x', '400', '--y', '300', '--delta-y', '300']);
    const scrolled = await cli([...S(), 'eval', '--frame', FRAME_D, 'window.scrollY']);
    expect(Number(scrolled.data.result)).toBeGreaterThan(200);
    // 滚回（滑动/点击的视口坐标语义恢复）
    await cli([...S(), 'mouse', 'wheel', '--frame', FRAME_D, '--x', '400', '--y', '300', '--delta-y', '-300']);

    const text = await cli([...S(), '--frame', FRAME_D, 'text', '--selector', '#heading']);
    expect(text.data.frame).toBe(FRAME_D);
    expect(String(text.data.text).trim()).toBe('Smoke Page');
  }, 240_000);
});
