import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createServer, type Server } from 'http';
import { join, resolve } from 'path';

const CHROMIUM_PATH = '/Applications/Chromium.app/Contents/MacOS/Chromium';
const CDP_PORT = 9222;
const DAEMON_PORT = 9224;
const CHROMIUM_USER_DIR = '/tmp/xbrowser-test-recording-chromium';
const SESSION_NAME = 'test-recording';

const PROJECT_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const TEST_PAGE_PATH = resolve(PROJECT_ROOT, 'tests/fixtures/record-test-page.html');
const NPX = `npx --prefix ${PROJECT_ROOT}`;

const chromiumAvailable = existsSync(CHROMIUM_PATH);
const describeE2E = chromiumAvailable ? describe : describe.skip;

let chromiumChild: ChildProcess | null = null;
let httpServer: Server | null = null;
let serverUrl = '';

// ─── Helpers ────────────────────────────────────────────────────

function run(cmd: string, timeout = 30000): string {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

function waitForPort(port: number, maxMs = 15000): void {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
      if (pid) return;
    } catch { /* not ready */ }
    execSync('sleep 0.3', { stdio: 'ignore' });
  }
  throw new Error(`Port ${port} did not open within ${maxMs}ms`);
}

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const url = `http://127.0.0.1:${DAEMON_PORT}/rpc`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  return (await resp.json()) as Record<string, unknown>;
}

function killByPort(port: number): void {
  try {
    const pidStr = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (pidStr) {
      for (const pid of pidStr.split('\n')) {
        const p = parseInt(pid.trim(), 10);
        if (p && !isNaN(p)) {
          try { process.kill(p, 'SIGKILL'); } catch { /* already dead */ }
        }
      }
    }
  } catch { /* port not in use */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function readRecordingFile(sessionName: string, filename: string): Record<string, unknown> | null {
  const p = join(process.env.HOME || '~', '.xbrowser', 'sessions', sessionName, 'recordings', filename);
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describeE2E('Recording E2E', () => {
  beforeAll(async function() {
    killByPort(CDP_PORT);
    killByPort(DAEMON_PORT);
    execSync(`rm -rf ${CHROMIUM_USER_DIR}`, { stdio: 'ignore' });

    // Start HTTP server for test page
    const content = readFileSync(TEST_PAGE_PATH, 'utf-8');
    serverUrl = await new Promise<string>((resolve, reject) => {
      const srv = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') reject(new Error('Server did not start'));
        else resolve(`http://127.0.0.1:${(addr as { port: number }).port}/`);
      });
      srv.on('error', reject);
      httpServer = srv;
    });
  }, 10000);

  afterAll(() => {
    try { run(`${NPX} xbrowser daemon stop --json`); } catch { /* ok */ }
    killByPort(DAEMON_PORT);
    if (chromiumChild?.pid) {
      try { process.kill(chromiumChild.pid, 'SIGKILL'); } catch { /* ok */ }
    }
    killByPort(CDP_PORT);
    if (httpServer) {
      try { httpServer.close(); } catch { /* ok */ }
    }
  }, 15000);

  it('should start Chromium and daemon', () => {
    chromiumChild = spawn(CHROMIUM_PATH, [
      '--headless',
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${CHROMIUM_USER_DIR}`,
    ], { stdio: 'ignore', detached: true });
    chromiumChild.unref();
    waitForPort(CDP_PORT);

    run(`${NPX} xbrowser daemon start --json`);
    // Wait a moment for daemon to fully initialize
    execSync('sleep 1', { stdio: 'ignore' });
  }, 30000);

  it('should create session via daemon RPC', async () => {
    const result = await rpc('session:create', {
      name: SESSION_NAME,
      cdpEndpoint: `http://127.0.0.1:${CDP_PORT}`,
      url: serverUrl,
    });
    expect(result.name).toBe(SESSION_NAME);
    expect(result.url).toBe(serverUrl);
  }, 15000);

  it('should start recording via RPC', async () => {
    const result = await rpc('record:start', {
      session: SESSION_NAME,
    });
    expect(result.ok).toBe(true);
    expect(result.session).toBe(SESSION_NAME);
  }, 15000);

  it('should capture interactions during recording', async () => {
    // Type into search input via daemon exec
    const typeResult = await rpc('exec', {
      command: 'type',
      params: { selector: '#search-input', text: 'hello world' },
      session: SESSION_NAME,
    });
    expect(typeResult.success).toBe(true);
    await sleep(1500);

    // Click search button via daemon exec
    const clickResult = await rpc('exec', {
      command: 'click',
      params: { selector: '#search-btn' },
      session: SESSION_NAME,
    });
    expect(clickResult.success).toBe(true);
    await sleep(1500);
  }, 30000);

  it('should stop recording and verify data', async () => {
    const stopResult = await rpc('record:stop', {
      session: SESSION_NAME,
    });
    expect(stopResult.ok).toBe(true);
    expect((stopResult.actions as number) || 0).toBeGreaterThanOrEqual(1);

    // Verify recording.json on disk
    const recording = readRecordingFile(SESSION_NAME, 'recording.json');
    expect(recording).not.toBeNull();
    expect(recording!.sessionName).toBe(SESSION_NAME);

    const actions = recording!.actions as Array<{ type: string; value?: string }>;
    expect(actions.length).toBeGreaterThanOrEqual(1);

    const hasInput = actions.some((a) => a.type === 'input');
    const hasClick = actions.some((a) => a.type === 'click');
    expect(hasInput).toBe(true);
    expect(hasClick).toBe(true);

    // Verify summary.json
    const summary = readRecordingFile(SESSION_NAME, 'summary.json');
    expect(summary).not.toBeNull();
    expect((summary!.totalActions as number) || 0).toBeGreaterThan(0);
    expect((summary!.steps as unknown[]).length).toBeGreaterThanOrEqual(1);

    // Verify recording status shows stopped
    const statusResult = await rpc('record:status', {
      session: SESSION_NAME,
    });
    expect(statusResult.recording).toBe(false);
    expect(statusResult.hasRecording).toBe(true);
  }, 15000);

  it('should replay the recording via RPC', async () => {
    const recordingPath = join(
      process.env.HOME || '~', '.xbrowser', 'sessions', SESSION_NAME, 'recordings', 'recording.json',
    );
    const result = await rpc('replay', {
      file: recordingPath,
      session: SESSION_NAME,
      slowMo: 0,
    });
    // Replay should at least attempt execution
    expect(result.ok !== false).toBe(true);
  }, 60000);
});
