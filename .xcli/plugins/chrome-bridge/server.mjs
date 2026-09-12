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
import { join } from 'node:path';

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

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  const id = nextId++;
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
      lastHello = { extId: String(msg.extId || ''), v: String(msg.v || ''), at: Date.now() };
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
    if (c.aliveMisses >= 2) {
      log('ka-drop', `#${id} 两轮无 pong，terminate`);
      try { c.ws.terminate(); } catch {}
      clients.delete(id);
      lastDisconnectAt = Date.now();
      for (const [pid, p] of pending) {
        if (p.clientId === id) {
          pending.delete(pid); clearTimeout(p.timer); p.reject(new Error('extension dead (ka)'));
        }
      }
    }
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
  {
    // client 选择（S108）：多浏览器同时连入时可选目标。默认 0（最先连入）；
    // ?client=last 用最新连入的；?client=N 用第 N 个。
    const all = [...clients.entries()];
    let entry;
    if (clientSel === 'last') entry = all[all.length - 1];
    else if (clientSel !== null && clientSel !== undefined && !Number.isNaN(Number(clientSel))) entry = all[Number(clientSel)];
    else entry = all[0];
    if (!entry) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'no extension connected' })); return; }
    const clientId = entry[0];
    const client = entry[1];
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
httpSrv.listen(PORT + 1);
log('boot', `WS on :${PORT}, HTTP status/exec on :${PORT + 1}, log=${LOG_FILE}`);
