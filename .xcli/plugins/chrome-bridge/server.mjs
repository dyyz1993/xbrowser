#!/usr/bin/env node
/**
 * chrome-bridge server — 常驻 WS 服务（独立进程，避免随 CLI 命令进程销毁）
 * 用法：node server.mjs [port=9346]
 *
 * S212 可观测性 + 死连接自愈：
 *  - 文件日志 ~/.xbrowser/logs/chrome-bridge.log（connect/disconnect/exec/timeout/drop/no-client 心跳）
 *    —— serve 以 stdio:'ignore' 拉起本进程，console 输出全部蒸发，日志必须落盘
 *  - 协议级 ping/pong（25s 间隔 × 2 轮未 pong → terminate）：快速清死连接，
 *    浏览器侧收到的 ping 流量同时给 MV3 SW 续命（Chrome 116+ WS 活动重置空闲计时）
 *  - 应用层 ka 帧（25s）：扩展 onmessage 收到即重置 SW 空闲计时（协议帧不派发 JS 事件，双保险）
 *  - hello 帧：扩展连上即上报 {hello, extId, v} → 持久化 ~/.xbrowser/chrome-bridge-ext.json，
 *    revive 命令据此开 chrome-extension://<id>/popup.html 唤醒死透的 SW
 *  - 客户端断连时立即 reject 该客户端的挂起请求（原来要干等 60s 超时）
 */
import { WebSocketServer } from 'ws';
import { appendFileSync, mkdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkBridgeCommand } from './guard.mjs';

const PORT = parseInt(process.argv[2] || '9346', 10);
const LOG_DIR = join(homedir(), '.xbrowser', 'logs');
const LOG_FILE = join(LOG_DIR, 'chrome-bridge.log');
const EXT_META_FILE = join(homedir(), '.xbrowser', 'chrome-bridge-ext.json');

// ── 文件日志（永不抛错——日志故障不能杀服务；>5MB 轮转一次） ──
try {
  mkdirSync(LOG_DIR, { recursive: true });
  if (existsSync(LOG_FILE)) {
    try { if (statSync(LOG_FILE).size > 5 * 1024 * 1024) writeFileSync(LOG_FILE + '.old', ''); } catch {}
  }
} catch {}
function log(event, detail = '') {
  const line = `[${new Date().toISOString()}] ${event}${detail ? ' ' + detail : ''}`;
  console.log(`[chrome-bridge] ${line}`);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

const clients = new Map();
let nextId = 1;
const pending = new Map(); // id → { resolve, reject, timer, clientId }
let lastDisconnectAt = null;
let lastHello = null; // { extId, v, at }
let lastNoClientLogAt = 0;

function terminateClient(id, reason) {
  const c = clients.get(id);
  if (!c) return;
  try { c.ws.terminate(); } catch {}
  clients.delete(id);
  lastDisconnectAt = Date.now();
  log(reason, `#${id} total=${clients.size}`);
  for (const [pid, p] of pending) {
    if (p.clientId === id) {
      pending.delete(pid); clearTimeout(p.timer); p.reject(new Error(`extension dead (${reason})`));
    }
  }
}

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  const id = nextId++;
  let extId = null;
  clients.set(id, { ws, connectedAt: Date.now(), lastSeen: Date.now(), aliveMisses: 0 });
  log('connect', `#${id} total=${clients.size}`);
  ws.on('pong', () => {
    const c = clients.get(id);
    if (c) { c.lastSeen = Date.now(); c.aliveMisses = 0; }
  });
  ws.on('message', (raw) => {
    const c = clients.get(id);
    if (c) c.lastSeen = Date.now();
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.hello) {
      extId = String(msg.extId || '');
      const current = clients.get(id);
      if (current) current.extId = extId;
      lastHello = { extId, v: String(msg.v || ''), at: Date.now() };
      try { writeFileSync(EXT_META_FILE, JSON.stringify(lastHello, null, 2)); } catch {}
      log('hello', `extId=${lastHello.extId} v=${lastHello.v}`);
      return;
    }
    if (msg.ka || msg.kaAck) return; // 心跳帧，无 id 不需匹配
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      if (p.clientId !== id) return; // 迟到回复来自别的连接，丢弃
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve({ ok: true, data: msg.data });
      else p.reject(new Error(msg.error || 'extension error'));
    }
  });
  ws.on('close', () => {
    clients.delete(id);
    lastDisconnectAt = Date.now();
    log('disconnect', `#${id} total=${clients.size}`);
    // 该连接上的挂起请求立即失败，不再干等 60s
    for (const [pid, p] of pending) {
      if (p.clientId === id) {
        pending.delete(pid);
        clearTimeout(p.timer);
        p.reject(new Error('extension disconnected'));
      }
    }
  });
  ws.on('error', (e) => log('ws-error', `#${id} ${String(e && e.message || e)}`));
});

// ── 死连接检测：25s ping × 2 轮未 pong → terminate ──
setInterval(() => {
  for (const [id, c] of clients) {
    // 协议帧：探测死连接（浏览器自动回 pong）
    try { c.ws.ping(); } catch { continue; }
    // 应用层帧：MV3 SW 收到 WS 消息才重置空闲计时（Chrome 116+），
    // 协议 ping 不派发 JS 事件——两路并发双保险
    try { c.ws.send(JSON.stringify({ ka: 1 })); } catch {}
    c.aliveMisses++;
    if (c.aliveMisses >= 2) terminateClient(id, 'ka-drop');
  }
  // 无客户端心跳（每 5 分钟最多一条，防止日志刷屏）
  if (clients.size === 0 && lastDisconnectAt && Date.now() - lastNoClientLogAt > 5 * 60 * 1000) {
    lastNoClientLogAt = Date.now();
    log('no-client', `无扩展连接 ${Math.round((Date.now() - lastDisconnectAt) / 1000)}s（SW 可能死透 → xbrowser chrome-bridge revive）`);
  }
}, 25_000);

// HTTP 状态口（curl 可查）
import http from 'http';
const httpSrv = http.createServer((req, res) => {
  // POST /exec：body = {cmd, args, client}（大参数走 body，S111）
  if (req.method === 'POST' && req.url?.startsWith('/exec')) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const { cmd, args, client: clientSel } = JSON.parse(body || '{}');
        handleExec(req, res, cmd, args, clientSel);
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'bad body: ' + e.message })); }
    });
    return;
  }
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running: true,
      port: PORT,
      clients: [...clients.values()].map((c) => ({ connectedAt: c.connectedAt, lastSeen: c.lastSeen })),
      lastDisconnectAt,
      ext: lastHello,
    }));
    return;
  }
  // GET /exec?cmd=navigate&args=<json>
  if (req.url?.startsWith('/exec')) {
    const u = new URL(req.url, 'http://x');
    handleExec(req, res, u.searchParams.get('cmd'), (() => { try { return JSON.parse(u.searchParams.get('args') || '{}'); } catch { return {}; } })(), u.searchParams.get('client'));
    return;
  }
  res.writeHead(404); res.end();
});

function handleExec(req, res, cmd, args, clientSel) {
  // CDP Guard 铁律：bridge 通道与主通道同一套规则引擎——危险命令（cdp/click/evaluate
  // 中的合成事件等）在发往扩展前被拦，返回 [CDP-Guard] 原因 + 替代用法（403）
  checkBridgeCommand(cmd, args).then((guard) => {
    if (guard.blocked) {
      log('exec-guard', `cmd=${cmd} rule=${guard.ruleId || '-'}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: guard.message, guard: true, ruleId: guard.ruleId }));
      return;
    }
    handleExecInner(req, res, cmd, args, clientSel);
  }).catch((e) => {
    // 守卫检查自身崩溃 → 熔断（fail-closed）：守卫不可用 = 通道不可用，绝不裸奔
    log('exec-guard-crash', `cmd=${cmd} ${String(e && e.message || e).slice(0, 100)}`);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: '[CDP-Guard] 守卫检查异常，通道已熔断: ' + String(e && e.message || e), guard: true }));
  });
}

function handleExecInner(req, res, cmd, args, clientSel) {
  {
    // client 选择（S108）：多浏览器同时连入时可选目标。默认 0（最先连入）；
    // ?client=last 用最新连入的；?client=N 用第 N 个。
    const all = [...clients.entries()];
    let entry;
    if (clientSel === 'last') entry = all[all.length - 1];
    else if (clientSel !== null && clientSel !== undefined && !Number.isNaN(Number(clientSel))) entry = all[Number(clientSel)];
    else {
      // 默认路由：选"最近 pong 且未超探"的活连接（revive/重连风暴会遗留
      // 大量僵尸 TCP（server 从未收到 close），固定取 all[0] 会路由到死
      // 连接 60s 超时——按 lastSeen 倒序取健康者，僵尸交给 ka 探测回收）
      // New sockets may arrive before the browser sends hello. They are eligible
      // only briefly; once hello identifies the extension, pin routing to it.
      const expected = lastHello?.extId;
      const healthy = all.filter(([, c]) => c.ws.readyState === 1 && (
        !expected || !c.extId || c.extId === expected
      ));
        entry = healthy.sort((a, b) => (b[1].lastSeen ?? 0) - (a[1].lastSeen ?? 0))[0] || all[0];
    }
    if (!entry) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'no extension connected' })); return; }
    const clientId = entry[0];
    const client = entry[1];
    if (cmd === 'setFiles') { handleSetFiles(res, args || {}, clientId, client); return; }
    const id = nextId++;
    const t0 = Date.now();
    const t = setTimeout(() => {
      pending.delete(id);
      log('exec-timeout', `#${clientId} cmd=${cmd}`);
      res.writeHead(504); res.end(JSON.stringify({ ok: false, error: 'timeout' }));
    }, 60000);
    pending.set(id, {
      clientId,
      resolve: (v) => { clearTimeout(t); log('exec-ok', `#${clientId} cmd=${cmd} ${Date.now() - t0}ms`); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); },
      reject: (e) => { clearTimeout(t); log('exec-fail', `#${clientId} cmd=${cmd} ${String(e.message).slice(0, 120)}`); res.writeHead(502); res.end(JSON.stringify({ ok: false, error: e.message })); },
      timer: t,
    });
    client.ws.send(JSON.stringify({ id, cmd, args: args || {} }));
  }
}

// ── setFiles：文件上传的一等命令（file-input 守卫规则的「替代」所指）──
// 内部编排两次 cdp 透传：① Runtime.evaluate(returnByValue:false) 拿 input 的
// objectId；② DOM.setFileInputFiles{files, objectId}——浏览器原生写 files 并
// 触发 change，无合成事件。objectId 偶发失效（"Object id doesn't reference a
// Node"）→ 重取一次再试。最后回读 input.files.length 作为结果自证。
const OBJECT_STALE_RE = /Object id doesn't reference a Node|no node with given id/i;

function bridgeCall(client, clientId, cdpArgs, timeoutMs = 20000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      log('exec-timeout', `#${clientId} cmd=cdp (setFiles inner)`);
      reject(new Error('timeout'));
    }, timeoutMs);
    pending.set(id, {
      clientId,
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject: (e) => { clearTimeout(t); reject(e); },
      timer: t,
    });
    client.ws.send(JSON.stringify({ id, cmd: 'cdp', args: cdpArgs || {} }));
  });
}

async function handleSetFiles(res, args, clientId, client) {
  const t0 = Date.now();
  try {
    const selector = typeof args.selector === 'string' && args.selector.trim() !== '' ? args.selector.trim() : null;
    const rawFiles = Array.isArray(args.files) ? args.files : (typeof args.files === 'string' ? [args.files] : []);
    const files = [...new Set(rawFiles.map((f) => resolve(String(f))))];
    const tabId = args.tabId != null && !Number.isNaN(Number(args.tabId)) ? Number(args.tabId) : null;
    if (!selector || files.length === 0 || files.some((f) => !existsSync(f))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'setFiles requires selector and files[] — absolute paths that exist on this machine (the browser reads the files itself)',
      }));
      return;
    }
    const tabArg = tabId != null ? { tabId } : {};
    const takeObjectId = () => bridgeCall(client, clientId, {
      ...tabArg,
      method: 'Runtime.evaluate',
      params: { expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false },
    });
    const pushFiles = (objectId) => bridgeCall(client, clientId, {
      ...tabArg,
      method: 'DOM.setFileInputFiles',
      params: { files, objectId },
    });
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ev = await takeObjectId();
      // 扩展 cdp 执行器返回 {ok, data:<CDP result>}，WS 帧再包一层 → HTTP body 是
      // {ok, data:{ok, data:<CDP result>}}——CDP 结果在 data.data（2026-11-27 线上实证）
      const cdp = ev?.data?.data ?? {};
      if (cdp.exceptionDetails) {
        throw new Error('evaluate failed: ' + String(cdp.exceptionDetails.text || cdp.exceptionDetails.exception?.description || 'exception'));
      }
      const objectId = cdp?.result?.objectId;
      if (!objectId) throw new Error(`not found: ${selector} (selector matched no element)`);
      try {
        await pushFiles(objectId);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt === 1 && OBJECT_STALE_RE.test(String(e.message))) {
          log('exec-setfiles', `#${clientId} stale objectId, re-taking once`);
          continue;
        }
        throw e;
      }
    }
    if (lastError) throw lastError;
    const check = await bridgeCall(client, clientId, {
      ...tabArg,
      method: 'Runtime.evaluate',
      params: { expression: `document.querySelector(${JSON.stringify(selector)})?.files?.length ?? -1`, returnByValue: true },
    });
    const fileCount = typeof check?.data?.data?.result?.value === 'number' ? check.data.data.result.value : null;
    log('exec-ok', `#${clientId} cmd=setFiles ${Date.now() - t0}ms`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { selector, files, tabId, fileCount } }));
  } catch (e) {
    log('exec-fail', `#${clientId} cmd=setFiles ${String(e && e.message || e).slice(0, 140)}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
}
httpSrv.listen(PORT + 1);
log('boot', `WS on :${PORT}, HTTP status/exec on :${PORT + 1}, log=${LOG_FILE}`);
