/**
 * chrome-bridge 多客户端并发验收（Layer 1 — server.mjs 真进程）。
 *
 * 场景：同一个浏览器（单条扩展 WS 连接）上，多个 CLI 客户端同时打 /exec。
 * 验收断言：
 *  1. 并发请求-响应严格按 id 配对（乱序回复不串线）
 *  2. 其他连接的伪造/迟到回复被丢弃（pending.clientId 守卫），不能劫持挂起请求
 *  3. 扩展断连时所有调用方立即失败（502 extension disconnected），不干等 60s 超时
 *
 * server.mjs 以真实子进程启动（随机端口），扩展侧用 ws 客户端模拟。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

type BridgeFrame = { id?: number; cmd?: string; args?: { seq?: number }; hello?: boolean; ka?: number };
type ExecReply = { ok?: boolean; data?: { echo?: unknown }; error?: string };

const SERVER_PATH = fileURLToPath(new URL('../../.xcli/plugins/chrome-bridge/server.mjs', import.meta.url));

let child: ReturnType<typeof spawn> | null = null;
let port = 0;
let ext: WebSocket | null = null;
const incoming: BridgeFrame[] = [];

async function pollStatus(p: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(`http://127.0.0.1:${p + 1}/status`).then((r) => r.ok).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function startServer(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = 24000 + Math.floor(Math.random() * 8000);
    const proc = spawn(process.execPath, [SERVER_PATH, String(candidate)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', () => { /* drain */ });
    proc.stderr?.on('data', () => { /* drain */ });
    if (await pollStatus(candidate, 3000)) {
      child = proc;
      port = candidate;
      return;
    }
    proc.kill('SIGTERM');
  }
  throw new Error('bridge server failed to start on 3 random ports');
}

function connectExtension(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (e: Error) => reject(e));
    ws.on('message', (raw: WebSocket.RawData) => {
      try { incoming.push(JSON.parse(String(raw)) as BridgeFrame); } catch { /* ignore */ }
    });
    ext = ws;
  });
}

function execSeq(seq: number): Promise<ExecReply> {
  return fetch(`http://127.0.0.1:${port + 1}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'echo', args: { seq } }),
  }).then((r) => r.json() as Promise<ExecReply>);
}

function openWebSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (e: Error) => reject(e));
  });
}

afterAll(() => {
  ext?.close();
  child?.kill('SIGTERM');
});

describe('chrome-bridge server multi-client concurrency (single extension connection)', () => {
  beforeEach(async () => {
    incoming.length = 0;
    if (!child) await startServer();
    if (!ext || ext.readyState !== WebSocket.OPEN) {
      ext = null;
      await connectExtension();
    }
  });

  it('pairs concurrent /exec responses strictly by request id when replies arrive out of order', async () => {
    const callers = Array.from({ length: 12 }, (_, i) => execSeq(i));

    await vi.waitFor(() => {
      expect(incoming.filter((m) => m.cmd === 'echo')).toHaveLength(12);
    });
    const frames = incoming.filter((m) => m.cmd === 'echo');

    // 乱序 + 交错延迟回复：每个响应只能回到发起它的那个 HTTP 调用方
    for (let k = frames.length - 1; k >= 0; k--) {
      const frame = frames[k];
      setTimeout(() => {
        ext?.send(JSON.stringify({ id: frame.id, ok: true, data: { echo: frame.args?.seq } }));
      }, (frames.length - k) * 5);
    }

    const results = await Promise.all(callers);
    results.forEach((result, i) => {
      expect(result.data?.echo).toBe(i);
    });
  });

  it('drops forged replies from a different connection and cannot hijack a pending call', async () => {
    const pending = execSeq(99);
    await vi.waitFor(() => {
      expect(incoming.find((m) => m.cmd === 'echo')).toBeTruthy();
    });
    const target = incoming.find((m) => m.cmd === 'echo')!;

    // 第二条连接（非请求接收方）拿同一个 id 伪造回复 → 必须被 clientId 守卫丢弃
    const spoofer = await openWebSocket();
    spoofer.send(JSON.stringify({ id: target.id, ok: true, data: { echo: 'spoofed' } }));

    const outcome = await Promise.race([
      pending.then(() => 'resolved'),
      new Promise<string>((resolve) => { setTimeout(() => resolve('still-pending'), 300); }),
    ]);
    expect(outcome).toBe('still-pending');

    // 真正持有请求的扩展连接回复 → 正常配对
    ext?.send(JSON.stringify({ id: target.id, ok: true, data: { echo: 99 } }));
    const result = await pending;
    expect(result.data?.echo).toBe(99);
    spoofer.close();
  });

  it('fails all in-flight caller requests immediately when the extension disconnects', async () => {
    const callers = [execSeq(1), execSeq(2), execSeq(3)];
    await vi.waitFor(() => {
      expect(incoming.filter((m) => m.cmd === 'echo')).toHaveLength(3);
    });

    const startedAt = Date.now();
    ext?.close();
    const settled = await Promise.all(callers.map((p) => p.then(
      (v) => ({ status: 'fulfilled' as const, value: v }),
      (e: unknown) => ({ status: 'rejected' as const, reason: e }),
    )));
    expect(Date.now() - startedAt).toBeLessThan(5000);

    for (const entry of settled) {
      // HTTP 502 仍是 fetch 层的 resolve（不是 reject）
      if (entry.status !== 'fulfilled') throw new Error('expected HTTP-level resolution, got network rejection');
      expect(entry.value.ok).toBe(false);
      expect(entry.value.error).toBe('extension disconnected');
    }
  });
});
