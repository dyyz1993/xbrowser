/**
 * #453 链会话分裂——真 CLI 端到端验收（红绿基准）
 *
 * 场景即用户用法：一条链里混「插件命令（改会话状态）+ 内置命令」。
 * 修复前（红）：插件步在 CLI 进程本地会话执行、内置步经 forwardExec 落 daemon
 * 会话——两个浏览器，注入的 cookie 对后续 eval 不可见。
 * 修复后（绿）：浏览器态插件步统一转发 daemon，同链所有步骤共享一个会话。
 *
 * 运行前置：npm run build（dist 必须新）+ 本机可寻 Chrome。
 * 运行：npm run build && npx vitest run --config vitest.e2e.config.ts tests/e2e/chain-plugin-session.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../../src/cdp-driver/launcher.js';
import { killAllDaemonProcesses } from '../../src/daemon/daemon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cli.js');

let server: Server | undefined;
let serverPort = 0;
let statePath = '';

function runCliChain(chain: string, timeoutMs = 120_000): Promise<{ code: number | null; out: string; err: string }> {
  const child: ChildProcess = spawn('node', [CLI, chain], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timeout: ${chain}\nstderr: ${err.slice(-800)}`));
    }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.on('error', reject);
  });
}

const hasChrome = findChrome() !== null;
const hasDist = existsSync(CLI);
const maybeIt = hasChrome && hasDist ? it : it.skip;

beforeAll(async () => {
  if (!hasChrome || !hasDist) return;
  await killAllDaemonProcesses();

  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>chain-split-smoke</h1></body></html>');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  serverPort = (server!.address() as { port: number }).port;

  const tmpDir = mkdtempSync(join(tmpdir(), 'xb-chain-e2e-'));
  statePath = join(tmpDir, 'state.json');
  writeFileSync(statePath, JSON.stringify({
    cookies: [
      { name: 'xb_e2e', value: 'hello-chain', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
    ],
    origins: [],
  }));
});

afterAll(async () => {
  server?.close();
  if (statePath && existsSync(statePath)) unlinkSync(statePath);
  if (hasChrome && hasDist) await killAllDaemonProcesses();
});

describe('#453 链会话分裂端到端', () => {
  maybeIt('插件注入 + goto + eval 同链可见（default 会话）', async () => {
    const { code, out } = await runCliChain(
      `login-state run --state ${statePath} && goto http://127.0.0.1:${serverPort}/ && waitForTimeout 800 && eval 'document.cookie'`,
    );
    // stderr 的 [SESSION]/daemon banner 是正常运营日志，不作为断言对象
    expect(code).toBe(0);
    expect(out).toContain('xb_e2e=hello-chain');
  });

  maybeIt('--session 写在链内被提升为链级会话（不再吞掉）', async () => {
    const { code, out } = await runCliChain(
      `login-state run --state ${statePath} --session split-sess && goto http://127.0.0.1:${serverPort}/ --session split-sess && waitForTimeout 800 && eval 'document.cookie' --session split-sess`,
    );
    expect(code).toBe(0);
    expect(out).toContain('xb_e2e=hello-chain');
  });
});
