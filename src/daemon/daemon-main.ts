/**
 * Daemon process entry point.
 *
 * Sets up the HTTP RPC server, preview WebSocket, and recording injection.
 * This is the file spawned by startDaemonProcess() in daemon.ts.
 *
 * RPC method handlers are delegated to createRPCHandler() in rpc-handlers.ts.
 * This file handles only: HTTP server setup, preview WS, daemon.json writing,
 * signal handling, and the keep-alive loop.
 */
import { writeFileSync, mkdirSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { IncomingMessage, ServerResponse } from 'http';

import { startHttpServer } from '@dyyz1993/xcli-core';

import { createRPCHandler } from './rpc-handlers.js';
import { version } from '../version.js';
import { WSServer } from '../websocket-server.js';
import { previewHTML, alignHTML } from './preview-templates.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';

const CONFIG_DIR = join(homedir(), '.xbrowser');
const LOG_FILE = join(CONFIG_DIR, 'daemon.log');

function log(msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[DAEMON ${ts}] ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore file errors
  }
}

async function main() {
  process.env.XBROWSER_DAEMON_WORKER = '1';
  const daemonPort = parseInt(process.env.XBROWSER_DAEMON_PORT || '9224', 10);

  log(`Daemon main starting (pid=${process.pid})`);

  // ── Create RPC handler and set up HTTP server ──
  const rpcHandler = createRPCHandler();

  const server = startHttpServer({
    port: daemonPort,
    rpcHandler,
    extraRoutes: [
      {
        pathname: '/health',
        handler: (_req: IncomingMessage, res: ServerResponse) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
	          res.end(JSON.stringify({ status: 'ok', pid: process.pid, version }));
        },
      },
    ],
  });

  // ── Handle EADDRINUSE: port already in use (another daemon won the race) ──
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${daemonPort} already in use — another daemon instance likely won the startup race. Exiting gracefully.`);
      // Clean up daemon.json so the parent process can detect the existing daemon
      try { unlinkSync(join(CONFIG_DIR, 'daemon.json')); } catch { /* ignore */ }
      process.exit(0);
    }
    log(`Server error: ${err.message}`);
    process.exit(1);
  });

  // ── Preview viewer HTTP routing ──
  // Must intercept BEFORE xcli-core's handler (which returns 404 for unknown routes)
  const originalListeners = server.listeners('request').slice();
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const urlPath = (req.url || '/').replace(/\?.*$/, '');
    if (urlPath === '/preview' || urlPath.startsWith('/preview/')) {
      const sessionId = urlPath.replace(/^\/preview\/?/, '').replace(/\/+$/, '') || 'default';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(previewHTML(sessionId, req.headers.host || `localhost:${daemonPort}`));
      return;
    }
    if (urlPath === '/align' || urlPath.startsWith('/align/')) {
      const sessionId = urlPath.replace(/^\/align\/?/, '').replace(/\/+$/, '') || 'default';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(alignHTML(sessionId, req.headers.host || `localhost:${daemonPort}`));
      return;
    }
    // Delegate to original xcli-core handlers
    for (const listener of originalListeners) {
      (listener as (req: IncomingMessage, res: ServerResponse) => void).call(server, req, res);
    }
  });

  // ── Preview WebSocket ──
  const previewWS = new WSServer();
  await previewWS.attachToServer(server, '/preview');
  log(`Preview WS attached to HTTP server on /preview`);

  // Connect WS to RPC handler so recording events can be forwarded
  rpcHandler.setPreviewWS(previewWS);

  previewWS.on('screencast-started', (sid: string) => log(`Preview screencast started: ${sid}`));
  previewWS.on('screencast-stopped', (sid: string) => log(`Preview screencast stopped: ${sid}`));

  // Handle reconnect request from viewer (when CDP connection is dead)
  previewWS.on('reconnect-request', ({ sessionId }: { sessionId: string | null }) => {
    if (!sessionId) return;
    log(`Reconnect request from viewer for session: ${sessionId}`);
    // Force restart screencast — stop then start
    rpcHandler.handleReconnect(sessionId).catch((e: unknown) => {
      log(`Reconnect failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  });

  // ── Write daemon.json for startDaemon() health polling ──
 mkdirSync(CONFIG_DIR, { recursive: true });
 writeFileSync(join(CONFIG_DIR, 'daemon.json'), JSON.stringify({
   port: daemonPort,
   pid: process.pid,
   startedAt: Date.now(),
 }, null, 2));

 console.log(`xbrowser daemon started (pid: ${process.pid}, port: ${daemonPort})`);
 log('Daemon main started successfully');

  // ── Plugin Loading ──
  // getPluginLoader() internally calls scanAndLoad() — all .xcli/plugins/
  // are loaded so plugin commands can run inside the daemon and share sessions.
  const loader = await getPluginLoader();
  const sites = loader.getCore().loader.getSites() as Array<{ name?: string }>;
  log(`Loaded ${sites.length} plugins`);
  if (sites.length > 0) {
    const names = sites.map(s => s.name || 'unknown').join(', ');
    log(`Plugins: ${names}`);
  }

  // ── Signal handling ──
  const shutdown = () => {
    log('Received shutdown signal, stopping');
    previewWS.stop().catch(() => {});
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('uncaughtException', (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`uncaughtException: ${msg}`);
    console.error('Daemon uncaughtException:', msg);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log(`unhandledRejection: ${msg}`);
    console.error('Daemon unhandledRejection:', msg);
  });

  // chrome-bridge 通道自启（S107）：daemon 起来时自动拉起扩展控制通道
  // （独立进程 WS:9346/HTTP:9347，已在运行则跳过）。持久化补全——用户
  // 不需要手动跑 chrome-bridge serve，daemon 在通道就在。
  try {
    const bridgeUp = await fetch('http://127.0.0.1:9347/status').then(r => r.ok).catch(() => false);
    if (!bridgeUp) {
      const { spawn } = await import('child_process');
      const path = await import('path');
      const serverPath = path.join(process.cwd(), '.xcli', 'plugins', 'chrome-bridge', 'server.mjs');
      const child = spawn(process.execPath, [serverPath, '9346'], { detached: true, stdio: 'ignore' });
      child.unref();
      log('chrome-bridge server auto-started (WS:9346/HTTP:9347)');
    }
  } catch { /* best-effort */ }

  // Keep alive — prevents the process from exiting
  setInterval(() => {}, 60000);
}


main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Daemon main failed:', msg);
  try { appendFileSync(LOG_FILE, `[DAEMON FATAL] ${msg}\n`); } catch { /* ignore */ }
  process.exit(1);
});
