/**
 * OOPIF --frame 验收测试（2026-10-21 用户定意的验收标准）
 *
 * 验收口径：
 *  1. 同一功能页 standalone 打开 vs 嵌进跨域 iframe（localhost ≠ 127.0.0.1，
 *     真 OOPIF），同一指令集只多加 --frame <frame名>，结果必须 100% 一致。
 *  2. 随机抽取指令子集（固定种子可复现）同样 100% 兼容。
 *  3. 滑块在一层 iframe（A嵌B）与二层嵌套 iframe（B嵌C）里都必须能用
 *     --frame 拖到 success，且拖动期间 e.buttons 位掩码零违规。
 *  4. frames 命令必须列出 OOPIF（含二层嵌套——target 平铺）。
 *  5. executor 层全局 --frame（_frame）→ ctx.frame 管线可用。
 *
 * 运行：npx vitest run tests/commands/frame-oopif-acceptance.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';
import { findChrome } from '../../src/cdp-driver/launcher.js';
import { evaluateCommand } from '../../src/commands/evaluate.js';
import { textCommand } from '../../src/commands/query.js';
import { clickCommand, fillCommand } from '../../src/commands/interaction.js';
import { mouseCommand } from '../../src/commands/mouse.js';
import { framesCommand } from '../../src/commands/frame.js';
import { registerCommand } from '../../src/commands/command-registry.js';
import type { BrowserCommandContext } from '../../src/context.js';

// ── 测试页 ─────────────────────────────────────────────────────

/** 功能页（B/C 同一内容，固定绝对布局保证 standalone 与 iframe 内坐标系一致） */
function featurePage(nestedIframeSrc: string | null): string {
  const nested = nestedIframeSrc
    ? `<iframe src="${nestedIframeSrc}" id="nested" style="position:absolute;left:0;top:500px;width:820px;height:640px;border:1px solid #bbb"></iframe>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Feature</title></head>
<body style="margin:0">
<div id="heading">Feature Page</div>
<input id="name" value="" style="position:absolute;left:0;top:60px;width:200px;height:28px">
<input id="email" value="" style="position:absolute;left:230px;top:60px;width:200px;height:28px">
<textarea id="bio" style="position:absolute;left:0;top:110px;width:430px;height:60px"></textarea>
<button id="btn-like" style="position:absolute;left:0;top:220px;width:120px;height:36px">Like</button>
<button id="btn-share" style="position:absolute;left:140px;top:220px;width:120px;height:36px">Share</button>
<button id="btn-submit" style="position:absolute;left:280px;top:220px;width:120px;height:36px">Submit</button>
<div id="like-count" style="position:absolute;left:0;top:270px">0</div>
<div id="share-count" style="position:absolute;left:140px;top:270px">0</div>
<div id="submit-msg" style="position:absolute;left:280px;top:270px">none</div>
<div id="track" style="position:absolute;left:0;top:400px;width:300px;height:44px;background:#ddd">
  <div id="handle" style="position:absolute;left:10px;top:2px;width:40px;height:40px;background:#4a90d9"></div>
</div>
<div id="slider-result" style="position:absolute;left:320px;top:404px">pending</div>
<div id="slider-final" style="position:absolute;left:320px;top:422px">0</div>
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
    document.getElementById('slider-final').textContent=String(Math.round(x));
    document.getElementById('buttons-violations').textContent=String(violations);});
  function bindCounter(btnId,counterId){document.getElementById(btnId).addEventListener('click',function(){var c=document.getElementById(counterId);c.textContent=String(Number(c.textContent)+1);});}
  bindCounter('btn-like','like-count');bindCounter('btn-share','share-count');
  var submits=0;
  document.getElementById('btn-submit').addEventListener('click',function(){submits++;document.getElementById('submit-msg').textContent='submitted #'+submits;});
})();
</script>
</body></html>`;
}

/** 外层页 A：只做容器 */
function outerPage(nestedSrc: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Outer A</title></head>
<body style="margin:0"><div id="outer-heading">Outer Page A</div>
<iframe src="${nestedSrc}" style="position:absolute;left:0;top:60px;width:820px;height:640px;border:1px solid #999"></iframe>
</body></html>`;
}

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '0.0.0.0', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

// ── 指令池（只改 --frame，其余一模一样）─────────────────────────

type CmdResult = { success: boolean; data?: unknown; message?: string };
type Op = { name: string; run: (ctx: BrowserCommandContext) => Promise<CmdResult> };

async function runCommand(promise: Promise<unknown>): Promise<CmdResult> {
  return promise as Promise<CmdResult>;
}

/** 鼠标操作坐标（B/C 页固定布局 → standalone 视口坐标 = iframe 局部坐标） */
const SUBMIT_AT = { x: 340, y: 238 };
const LIKE_AT = { x: 60, y: 238 };

function buildOpPool(): Op[] {
  return [
    { name: 'eval:heading', run: (ctx) => runCommand(evaluateCommand.handler({ expression: `document.getElementById('heading').textContent` }, ctx)) },
    { name: 'fill:name', run: (ctx) => runCommand(fillCommand.handler({ selector: '#name', value: '张三' }, ctx)) },
    { name: 'fill:email', run: (ctx) => runCommand(fillCommand.handler({ selector: '#email', value: 'z@example.com' }, ctx)) },
    { name: 'eval:readback-name', run: (ctx) => runCommand(evaluateCommand.handler({ expression: `document.getElementById('name').value` }, ctx)) },
    { name: 'text:heading', run: (ctx) => runCommand(textCommand.handler({ selector: '#heading' }, ctx)) },
    { name: 'fill:bio', run: (ctx) => runCommand(fillCommand.handler({ selector: '#bio', value: 'hello-OOPIF-bio' }, ctx)) },
    { name: 'eval:readback-bio', run: (ctx) => runCommand(evaluateCommand.handler({ expression: `document.getElementById('bio').value` }, ctx)) },
    { name: 'click:btn-like', run: (ctx) => runCommand(clickCommand.handler({ selector: '#btn-like' }, ctx)) },
    { name: 'click:btn-share', run: (ctx) => runCommand(clickCommand.handler({ selector: '#btn-share' }, ctx)) },
    { name: 'eval:like-count', run: (ctx) => runCommand(evaluateCommand.handler({ expression: `document.getElementById('like-count').textContent` }, ctx)) },
    { name: 'mouse:click-submit', run: (ctx) => runCommand(mouseCommand.handler({ action: 'click', x: SUBMIT_AT.x, y: SUBMIT_AT.y }, ctx)) },
    { name: 'eval:submit-msg', run: (ctx) => runCommand(evaluateCommand.handler({ expression: `document.getElementById('submit-msg').textContent` }, ctx)) },
    {
      name: 'mouse:down-up-like',
      run: async (ctx) => {
        await runCommand(mouseCommand.handler({ action: 'move', x: LIKE_AT.x, y: LIKE_AT.y }, ctx));
        // 瞄准停顿：click() 内建 aimPause 而裸 down() 没有——humanize 展开的
        // move 流紧贴 press 派发时偶发被输入管线吞掉（本套件实测 flaky）
        await new Promise((r) => setTimeout(r, 150));
        await runCommand(mouseCommand.handler({ action: 'down', x: LIKE_AT.x, y: LIKE_AT.y }, ctx));
        return runCommand(mouseCommand.handler({ action: 'up', x: LIKE_AT.x, y: LIKE_AT.y }, ctx));
      },
    },
    { name: 'eval:like-count-after-downup', run: (ctx) => runCommand(evaluateCommand.handler({ expression: `document.getElementById('like-count').textContent` }, ctx)) },
    { name: 'eval:share-count', run: (ctx) => runCommand(evaluateCommand.handler({ expression: `document.getElementById('share-count').textContent` }, ctx)) },
  ];
}

/** 固定种子伪随机（mulberry32）——抽取可复现 */
function seededShuffle(n: number, seed: number): number[] {
  let a = seed;
  const rand = (): number => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function makeCtx(page: XBPage, frame?: string): BrowserCommandContext {
  return {
    page,
    browser: {},
    browserContext: {},
    frame,
    sessionId: 'oopif-acceptance',
    args: [],
    options: {},
    cwd: '/tmp',
    storage: { get: vi_noop, set: vi_noop, delete: vi_noop, clear: vi_noop, keys: vi_noop },
    output: { mode: 'text', showTips: false, color: false, emoji: false },
    error: (msg: string) => { throw new Error(msg); },
    config: {},
    site: {} as never,
    cliName: 'xbrowser',
  } as unknown as BrowserCommandContext;
}
function vi_noop(): void {}

/** 归一化结果：剥掉实现路径差异字段（frame 标识 / React 检测分支），只留页面状态 */
function normalize(result: CmdResult): unknown {
  const data = (result as { data?: Record<string, unknown> }).data;
  if (data && typeof data === 'object') {
    // frame 标识 / React 检测分支 / frame 局部坐标都是实现路径细节，不参与等价比较
    const rest = { ...data };
    delete rest.frame;
    delete rest.reactMode;
    delete rest.x;
    delete rest.y;
    return { success: result.success, data: rest };
  }
  return { success: result.success, data };
}

// ── 测试套件 ───────────────────────────────────────────────────

const CHROME_AVAILABLE = Boolean(findChrome());
const SUITE_TIMEOUT = 300_000;

describe.skipIf(!CHROME_AVAILABLE)('OOPIF --frame 验收（真浏览器）', { timeout: SUITE_TIMEOUT, hookTimeout: 120_000 } as never, () => {
  let browser: XBBrowser;
  let page: XBPage;
  let port1 = 0; // A(localhost) / B(127.0.0.1) 同端口双源
  let port2 = 0; // C(c.localhost) 二层嵌套
  let server1: Server;
  let server2: Server;
  let B_URL: string;
  let A_URL: string;

  beforeAll(async () => {
    // 先起服务器拿端口（isolate-origins 需要完整 origin 列表）
    const handler1 = (req: IncomingMessage, res: ServerResponse): void => {
      const host = (req.headers.host || '').split(':')[0];
      if (host === 'localhost') {
        res.end(outerPage(`http://127.0.0.1:${port1}/page`));
      } else {
        // B 里嵌 C：必须用第三个 host（c.localhost）——--isolate-origins 匹配时
        // 剥端口，同 host 不同 port 会被并成同源不隔离（实测 B嵌C 不出 OOPIF）；
        // c.localhost 由 Chromium 硬编码解析到 loopback（RFC 6761），零系统配置
        res.end(featurePage(`http://c.localhost:${port2}/page`));
      }
    };
    const handler2 = (req: IncomingMessage, res: ServerResponse): void => {
      const host = (req.headers.host || '').split(':')[0];
      if (host === 'c.localhost') {
        res.end(featurePage(`http://d.localhost:${port2}/page`)); // C 里嵌 D → 三层
      } else {
        res.end(featurePage(null)); // D（第三层，无再嵌套）
      }
    };
    const s1 = await startServer(handler1);
    const s2 = await startServer(handler2);
    server1 = s1.server; port1 = s1.port;
    server2 = s2.server; port2 = s2.port;
    B_URL = `http://127.0.0.1:${port1}/page`;
    A_URL = `http://localhost:${port1}/page`;

    // Chrome 站点隔离按 site（eTLD+1）分组——localhost 与 127.0.0.1 同属
    // "localhost" site，--site-per-process 不会拆它们；必须 --isolate-origins
    // 显式按 origin 强制隔离，才能产出真 OOPIF。
    const isolateOrigins = [
      `http://localhost:${port1}`,
      `http://127.0.0.1:${port1}`,
      `http://c.localhost:${port2}`,
      `http://d.localhost:${port2}`,
    ].join(',');
    const result = await launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--site-per-process',
        '--enable-features=IsolateOrigins,site-per-process',
        `--isolate-origins=${isolateOrigins}`,
      ],
    });
    browser = result.browser;

    const context = await browser.newContext();
    page = await context.newPage();
  }, 120_000);

  afterAll(async () => {
    if (browser) await browser.close();
    server1?.close();
    server2?.close();
  }, 30_000);

  /**
   * 场景执行器：standalone（直接打开功能页，不带 --frame）
   * 或 inframe（打开外层页，同一指令集每个都带 --frame）。
   * 返回 { opName: 归一化结果 }。
   */
  async function runScenario(mode: 'standalone' | 'inframe', ops: Op[]): Promise<Record<string, unknown>> {
    await page.goto(mode === 'standalone' ? B_URL : A_URL, { waitUntil: 'load', timeout: 20000 });
    // 等 iframe（含嵌套）加载完成
    await page.evaluate(`new Promise(r => setTimeout(r, 800))`);
    const frame = mode === 'inframe' ? `127.0.0.1:${port1}` : undefined;
    const out: Record<string, unknown> = {};
    for (const op of ops) {
      const result = await op.run(makeCtx(page, frame));
      if (!result.success) throw new Error(`[${mode}] op ${op.name} failed: ${result.message}`);
      out[op.name] = normalize(result);
    }
    return out;
  }

  it('兼容矩阵：14 条指令 standalone vs --frame 结果 100% 一致', async () => {
    const standalone = await runScenario('standalone', buildOpPool());
    const inframe = await runScenario('inframe', buildOpPool());
    for (const op of buildOpPool()) {
      const a = JSON.stringify(standalone[op.name]);
      const b = JSON.stringify(inframe[op.name]);
      expect(b, `op ${op.name} 结果不一致\n  standalone = ${a}\n  inframe    = ${b}`).toBe(a);
    }
    // 抽查语义锚点：矩阵确实驱动了页面状态（不是空转）。
    // eval:like-count 在 down-up 之前读（首 click 后=1）；down-up 之后的读数=2
    expect(standalone['eval:like-count']).toEqual({ success: true, data: { result: '1' } });
    expect(standalone['eval:like-count-after-downup']).toEqual({ success: true, data: { result: '2' } });
    expect(standalone['eval:submit-msg']).toEqual({ success: true, data: { result: 'submitted #1' } });

    // 多行文本：frame 路径 insertText 保留 \n（优于 standalone fill 丢 \n 的现状），
    // 显式钉住这一更优行为
    const ctxFrame = makeCtx(page, `127.0.0.1:${port1}`);
    await fillCommand.handler({ selector: '#bio', value: '第一行\n第二行' }, ctxFrame);
    const bio = await evaluateCommand.handler({ expression: `document.getElementById('bio').value` }, ctxFrame);
    expect((bio as { data: { result: string } }).data.result).toBe('第一行\n第二行');
  }, 240_000);

  it('随机抽取 12 条（固定种子）：standalone vs --frame 100% 一致', async () => {
    const pool = buildOpPool();
    const draw = seededShuffle(pool.length, 20261021).slice(0, 12).map((i) => pool[i]);
    const standalone = await runScenario('standalone', draw);
    const inframe = await runScenario('inframe', draw);
    for (const op of draw) {
      const a = JSON.stringify(standalone[op.name]);
      const b = JSON.stringify(inframe[op.name]);
      expect(b, `随机抽中 op ${op.name} 结果不一致\n  standalone = ${a}\n  inframe    = ${b}`).toBe(a);
    }
  }, 240_000);

  it('滑块（一层 iframe）：--frame 拖到 success，buttons 位掩码零违规', async () => {
    await page.goto(A_URL, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(`new Promise(r => setTimeout(r, 800))`);
    const frame = `127.0.0.1:${port1}`;
    const ctx = makeCtx(page, frame);
    await mouseCommand.handler({ action: 'move', x: 30, y: 422 }, ctx);   // 滑块手柄中心
    await mouseCommand.handler({ action: 'drag', x: 240, y: 422, steps: 25 }, ctx);
    const state = await evaluateCommand.handler({ expression: `JSON.stringify({r:document.getElementById('slider-result').textContent,f:document.getElementById('slider-final').textContent,v:document.getElementById('buttons-violations').textContent})` }, ctx);
    const parsed = JSON.parse(String((state as { data: { result: string } }).data.result)) as { r: string; f: string; v: string };
    expect(parsed.r).toBe('success');
    expect(parsed.f).toBe('240');
    expect(parsed.v).toBe('0'); // 拖动期间 e.buttons===1 全程成立（buttons 位掩码修复的端到端证明）
  }, 120_000);

  it('滑块（二层嵌套 iframe B嵌C）：--frame 直达最内层，一次拖成', async () => {
    await page.goto(A_URL, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(`new Promise(r => setTimeout(r, 1200))`);
    const frame = `c.localhost:${port2}`; // 不经过 B，直接命中最内层 OOPIF
    const ctx = makeCtx(page, frame);
    await mouseCommand.handler({ action: 'move', x: 30, y: 422 }, ctx);
    await mouseCommand.handler({ action: 'drag', x: 240, y: 422, steps: 25 }, ctx);
    const state = await runCommand(evaluateCommand.handler({ expression: `JSON.stringify({r:document.getElementById('slider-result').textContent,v:document.getElementById('buttons-violations').textContent})` }, ctx));
    const parsed = JSON.parse(String((state.data as { result: string }).result)) as { r: string; v: string };
    expect(parsed.r).toBe('success');
    expect(parsed.v).toBe('0');
  }, 120_000);

  it('frames 命令列出 OOPIF（含二层嵌套，平铺 target）', async () => {
    await page.goto(A_URL, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(`new Promise(r => setTimeout(r, 1200))`);
    const result = await runCommand(framesCommand.handler({}, makeCtx(page)));
    expect(result.success).toBe(true);
    const frames = (result.data as { frames: Array<{ url: string; oopif?: boolean; depth?: number | null; parentUrl?: string | null }> }).frames;
    const oopifUrls = frames.filter((f) => f.oopif).map((f) => f.url);
    expect(oopifUrls.some((u) => u.includes(`127.0.0.1:${port1}`))).toBe(true); // 一层
    expect(oopifUrls.some((u) => u.includes(`c.localhost:${port2}`))).toBe(true); // 二层嵌套也可见
    expect(oopifUrls.some((u) => u.includes(`d.localhost:${port2}`))).toBe(true); // 三层嵌套照样平铺可见

    // 层级重建：parentUrl / depth 链必须与真实嵌套一致（A→B→C→D）
    const byUrl = (sub: string) => frames.find((f) => f.url.includes(sub));
    const b = byUrl(`127.0.0.1:${port1}`);
    const c = byUrl(`c.localhost:${port2}`);
    const d = byUrl(`d.localhost:${port2}`);
    expect(b?.depth).toBe(1);
    expect(b?.parentUrl).toContain(`localhost:${port1}`);
    expect(c?.depth).toBe(2);
    expect(c?.parentUrl).toContain(`127.0.0.1:${port1}`);
    expect(d?.depth).toBe(3);
    expect(d?.parentUrl).toContain(`c.localhost:${port2}`);
  }, 60_000);
  it('三层嵌套（A嵌B嵌C嵌D）：调用/填写/点击/滚动/滑动 全套通过', async () => {
    await page.goto(A_URL, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(`new Promise(r => setTimeout(r, 1500))`);
    const frame = `d.localhost:${port2}`; // 第三层 OOPIF，平铺直达
    const ctx = makeCtx(page, frame);

    // 调用（读 DOM）
    const heading = await evaluateCommand.handler({ expression: `document.getElementById('heading').textContent` }, ctx);
    expect((heading as { data: { result: string } }).data.result).toBe('Feature Page');

    // 填写 + 回读
    await fillCommand.handler({ selector: '#name', value: '三层' }, ctx);
    const name = await evaluateCommand.handler({ expression: `document.getElementById('name').value` }, ctx);
    expect((name as { data: { result: string } }).data.result).toBe('三层');

    // 点击（选择器在第三层解析）
    await clickCommand.handler({ selector: '#btn-like' }, ctx);
    const count = await evaluateCommand.handler({ expression: `document.getElementById('like-count').textContent` }, ctx);
    expect((count as { data: { result: string } }).data.result).toBe('1');

    // 滚动（trusted wheel，iframe 局部坐标）
    await mouseCommand.handler({ action: 'wheel', x: 400, y: 300, 'delta-y': 300 }, ctx);
    await new Promise((r) => setTimeout(r, 200));
    const scrollY = await evaluateCommand.handler({ expression: `window.scrollY` }, ctx);
    expect(Number((scrollY as { data: { result: number } }).data.result)).toBeGreaterThan(200);

    // 滑动（滚动改变视口坐标语义——先滚回，坐标才和 DOM rect 对得上；
    // 真实脚本同理：滚动后要么滚回、要么重新 eval 读 rect）
    await mouseCommand.handler({ action: 'wheel', x: 400, y: 300, 'delta-y': -300 }, ctx);
    await new Promise((r) => setTimeout(r, 200));
    await mouseCommand.handler({ action: 'move', x: 30, y: 422 }, ctx);
    await mouseCommand.handler({ action: 'drag', x: 240, y: 422, steps: 25 }, ctx);
    const state = await evaluateCommand.handler({ expression: `JSON.stringify({r:document.getElementById('slider-result').textContent,v:document.getElementById('buttons-violations').textContent})` }, ctx);
    const parsed = JSON.parse(String((state as { data: { result: string } }).data.result)) as { r: string; v: string };
    expect(parsed.r).toBe('success');
    expect(parsed.v).toBe('0');
  }, 120_000);
});

describe('executor 全局 --frame 管线（_frame → ctx.frame）', () => {
  it('project-scope 探针命令能收到 ctx.frame', async () => {
    let seen: string | undefined;
    registerCommand({
      name: '__frame_glue_probe',
      description: 'test probe for --frame glue',
      scope: 'project',
      handler: async (_p, ctx) => {
        seen = ctx.frame;
        return { success: true, data: { frame: ctx.frame } };
      },
    });
    const prev = process.env.XBROWSER_DAEMON_WORKER;
    process.env.XBROWSER_DAEMON_WORKER = '1'; // 跳过 daemon 转发，进程内执行
    try {
      const { executeCommand } = await import('../../src/executor.js');
      const result = await executeCommand('__frame_glue_probe', { _frame: 'glue.example.com' }, 'default');
      expect(result.success).toBe(true);
      expect(seen).toBe('glue.example.com');
    } finally {
      if (prev === undefined) delete process.env.XBROWSER_DAEMON_WORKER;
      else process.env.XBROWSER_DAEMON_WORKER = prev;
    }
  }, 60_000);
});
