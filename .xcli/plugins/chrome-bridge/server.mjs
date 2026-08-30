#!/usr/bin/env node
/**
 * chrome-bridge server — 常驻 WS 服务（独立进程，避免随 CLI 命令进程销毁）
 * 用法：node server.mjs [port=9346]
 */
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.argv[2] || '9346', 10);
const clients = new Map();
let nextId = 1;
const pending = new Map();

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  const id = nextId++;
  clients.set(id, { ws, connectedAt: Date.now() });
  console.log(`[chrome-bridge] extension connected (#${id}), total=${clients.size}`);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve({ ok: true, data: msg.data });
      else p.reject(new Error(msg.error || 'extension error'));
    }
  });
  ws.on('close', () => { clients.delete(id); console.log(`[chrome-bridge] extension disconnected (#${id})`); });
});

// HTTP 状态口（curl 可查）
import http from 'http';
const httpSrv = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ running: true, port: PORT, clients: [...clients.values()].map((c) => ({ connectedAt: c.connectedAt })) }));
    return;
  }
  // /exec?cmd=navigate&args=<json>
  if (req.url?.startsWith('/exec')) {
    const u = new URL(req.url, 'http://x');
    const cmd = u.searchParams.get('cmd');
    let args = {};
    try { args = JSON.parse(u.searchParams.get('args') || '{}'); } catch {}
    // client 选择（S108）：多浏览器同时连入时可选目标。默认 0（最先连入）；
    // ?client=last 用最新连入的；?client=N 用第 N 个。
    const all = [...clients.entries()];
    const sel = u.searchParams.get('client');
    let entry;
    if (sel === 'last') entry = all[all.length - 1];
    else if (sel !== null && !Number.isNaN(Number(sel))) entry = all[Number(sel)];
    else entry = all[0];
    if (!entry) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'no extension connected' })); return; }
    const client = entry[1];
    const id = nextId++;
    const t = setTimeout(() => { pending.delete(id); res.writeHead(504); res.end(JSON.stringify({ ok: false, error: 'timeout' })); }, 20000);
    pending.set(id, { resolve: (v) => { clearTimeout(t); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); }, reject: (e) => { clearTimeout(t); res.writeHead(502); res.end(JSON.stringify({ ok: false, error: e.message })); }, timer: t });
    client.ws.send(JSON.stringify({ id, cmd, args }));
    return;
  }
  res.writeHead(404); res.end();
});
// HTTP 状态口用 PORT+1（9347）
httpSrv.listen(PORT + 1);
console.log(`[chrome-bridge] WS on :${PORT}, HTTP status/exec on :${PORT + 1}`);
