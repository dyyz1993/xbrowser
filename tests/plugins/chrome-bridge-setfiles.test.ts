/**
 * chrome-bridge setFiles（文件上传一等命令）— server.mjs 真进程验收。
 *
 * 编排契约：Runtime.evaluate(returnByValue:false) 拿 objectId → DOM.setFileInputFiles
 * → 回读 input.files.length。objectId 失效（"Object id doesn't reference a Node"）
 * 重取一次再试。扩展侧用 ws 客户端模拟（concurrency 测试同款骨架）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

// @ts-expect-error -- 插件 .mjs 无类型声明（运行时消费）
import { checkBridgeCommand } from '../../.xcli/plugins/chrome-bridge/guard.mjs';

const SERVER_PATH = fileURLToPath(new URL('../../.xcli/plugins/chrome-bridge/server.mjs', import.meta.url));

type CdpFrame = { id?: number; cmd?: string; args?: { method?: string; params?: Record<string, unknown>; tabId?: number } };
let child: ReturnType<typeof spawn> | null = null;
let port = 0;
let ext: WebSocket | null = null;

// 每个用例自订扩展侧行为：按 cdp 方法返回；记录收到的调用序列
let handler: ((method: string, params: Record<string, unknown>) => { ok: boolean; data?: unknown; error?: string }) | null = null;
const calls: Array<{ method: string; params: Record<string, unknown>; tabId?: number }> = [];

const tmpDir = mkdtempSync(join(tmpdir(), 'xb-setfiles-'));
const JPG = join(tmpDir, 'sample.jpg');
writeFileSync(JPG, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])); // JPEG magic 头
const PNG = join(tmpDir, 'sample.png');
writeFileSync(PNG, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

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
    const candidate = 25000 + Math.floor(Math.random() * 8000);
    const proc = spawn(process.execPath, [SERVER_PATH, String(candidate)], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      let frame: CdpFrame;
      try { frame = JSON.parse(String(raw)) as CdpFrame; } catch { return; }
      if (frame.id === undefined || frame.cmd !== 'cdp' || !handler) return;
      const method = frame.args?.method ?? '';
      const params = frame.args?.params ?? {};
      calls.push({ method, params, tabId: frame.args?.tabId } as { method: string; params: Record<string, unknown>; tabId?: number });
      const out = handler(method, params);
      // 真实扩展 cdp 执行器返回 {ok, data:<CDP result>}，WS 帧为 {id, ok, data:<executor 返回>}
      const reply = out.ok
        ? { id: frame.id, ok: true, data: { ok: true, data: out.data ?? {} } }
        : { id: frame.id, ok: false, error: out.error ?? 'extension error' };
      ws.send(JSON.stringify(reply));
    });
    ext = ws;
  });
}

function exec(body: Record<string, unknown>): Promise<{ status: number; body: { ok?: boolean; data?: Record<string, unknown>; error?: string } }> {
  return fetch(`http://127.0.0.1:${port + 1}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() as { ok?: boolean; data?: Record<string, unknown>; error?: string } }));
}

const defaultHandler = (objectId: string) => (method: string, params: Record<string, unknown>) => {
  if (method === 'Runtime.evaluate') {
    // verify 回读（returnByValue:true）→ files.length
    if (params.returnByValue === true) return { ok: true, data: { result: { type: 'number', value: 1 } } };
    return { ok: true, data: { result: { type: 'object', objectId } } };
  }
  if (method === 'DOM.setFileInputFiles') return { ok: true, data: {} };
  return { ok: false, error: 'unexpected method ' + method };
};

afterAll(() => {
  ext?.close();
  child?.kill('SIGTERM');
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('chrome-bridge setFiles（文件上传一等命令）', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    handler = null;
    calls.length = 0;
    if (!child) await startServer();
    if (!ext || ext.readyState !== WebSocket.OPEN) {
      ext = null;
      await connectExtension();
    }
  });

  it('uploads through objectId → DOM.setFileInputFiles and reads the file count back', async () => {
    handler = defaultHandler('obj-1');
    const r = await exec({ cmd: 'setFiles', args: { tabId: 42, selector: 'input[type=file]', files: [JPG] } });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data).toMatchObject({ selector: 'input[type=file]', tabId: 42, fileCount: 1 });
    expect(r.body.data?.files).toEqual([JPG]);
    // 编排顺序：evaluate(拿 objectId) → setFileInputFiles(用同一 objectId) → evaluate(回读)
    expect(calls.map((c) => c.method)).toEqual(['Runtime.evaluate', 'DOM.setFileInputFiles', 'Runtime.evaluate']);
    expect(calls[1].params).toMatchObject({ objectId: 'obj-1', files: [JPG] });
    // 两次 evaluate 都显式带 tabId（编排内部不依赖任务组解析，避免两次路由不一致）
    expect(calls[0].tabId).toBe(42);
    expect(calls[2].tabId).toBe(42);
  });

  it('re-takes the objectId once when the node reference goes stale', async () => {
    let evalCount = 0;
    let setCount = 0;
    handler = (method, params) => {
      if (method === 'Runtime.evaluate' && params.returnByValue !== true) {
        evalCount++;
        return { ok: true, data: { result: { type: 'object', objectId: `obj-${evalCount}` } } };
      }
      if (method === 'DOM.setFileInputFiles') {
        setCount++;
        if (setCount === 1) return { ok: false, error: "Object id doesn't reference a Node" };
        return { ok: true, data: {} };
      }
      if (method === 'Runtime.evaluate') return { ok: true, data: { result: { type: 'number', value: 1 } } };
      return { ok: false, error: 'unexpected' };
    };
    const r = await exec({ cmd: 'setFiles', args: { tabId: 7, selector: '#uploader input[type=file]', files: [JPG, PNG] } });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(evalCount).toBe(2);
    expect(setCount).toBe(2);
    expect(calls[3].params).toMatchObject({ objectId: 'obj-2' });
  });

  it('reports not-found when the selector matches no element', async () => {
    handler = (method) => {
      if (method === 'Runtime.evaluate') return { ok: true, data: { result: { type: 'undefined' } } };
      return { ok: false, error: 'unexpected' };
    };
    const r = await exec({ cmd: 'setFiles', args: { tabId: 1, selector: 'input[name=missing]', files: [JPG] } });
    expect(r.status).toBe(502);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toContain('not found: input[name=missing]');
  });

  it('rejects bad arguments (400) before touching the extension', async () => {
    handler = () => { throw new Error('extension must not be called'); };
    const missing = await exec({ cmd: 'setFiles', args: { selector: 'input[type=file]' } });
    expect(missing.status).toBe(400);
    const nonexistent = await exec({ cmd: 'setFiles', args: { selector: 'input[type=file]', files: ['/no/such/file.jpg'] } });
    expect(nonexistent.status).toBe(400);
    expect(nonexistent.body.error).toContain('absolute paths');
    expect(calls.length).toBe(0);
  });

  it('passes the guard by design (the sanctioned alternative of the file-input rule)', async () => {
    const r = await checkBridgeCommand('setFiles', { tabId: 1, selector: 'input[type=file]', files: [JPG] });
    expect(r.blocked).toBe(false);
  });
});
