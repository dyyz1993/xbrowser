import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';

const CHROMIUM_PATH = '/Applications/Chromium.app/Contents/MacOS/Chromium';
const CDP_PORT = 9222;
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;
const CHROMIUM_USER_DIR = '/tmp/xbrowser-test-chromium';
const SESSION_NAME = 'test-daemon';
const TEST_URL = 'https://www.baidu.com';

const PROJECT_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const NPX = `npx --prefix ${PROJECT_ROOT}`;

const chromiumAvailable = existsSync(CHROMIUM_PATH);
const describeE2E = chromiumAvailable ? describe : describe.skip;

let chromiumChild: ReturnType<typeof spawn> | null = null;

// ─── Helpers ────────────────────────────────────────────────────

function run(cmd: string): string {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

function runJson(cmd: string): Record<string, unknown> {
  const raw = run(cmd);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const lines = raw.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    throw new Error(`No valid JSON in output: ${raw.slice(0, 500)}`);
  }
}

function waitForPort(port: number, maxMs = 10000): void {
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

function waitForDaemon(maxMs = 10000): void {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const result = runJson(`${NPX} xbrowser daemon status --json`);
      if (result.running === true) return;
    } catch { /* not ready */ }
    execSync('sleep 0.3', { stdio: 'ignore' });
  }
  throw new Error('Daemon did not start within timeout');
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

// ─── E2E Tests ──────────────────────────────────────────────────

describeE2E('Daemon Session E2E', () => {
  beforeAll(() => {
    // Clean up any leftovers
    killByPort(CDP_PORT);
    killByPort(9224);
    execSync(`rm -rf ${CHROMIUM_USER_DIR}`, { stdio: 'ignore' });

    // Start Chromium with detached spawn (not execSync + & which is unreliable)
    chromiumChild = spawn(CHROMIUM_PATH, [
      '--headless',
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${CHROMIUM_USER_DIR}`,
    ], {
      stdio: 'ignore',
      detached: true,
    });
    chromiumChild.unref();

    // Wait for CDP port to be ready
    waitForPort(CDP_PORT);

    // Start daemon
    run(`${NPX} xbrowser daemon start --json`);
    waitForDaemon();
  }, 30000);

  afterAll(() => {
    // Close session
    try { run(`${NPX} xbrowser session close --name ${SESSION_NAME} --cdp ${CDP_ENDPOINT} --json`); } catch { /* ok */ }
    // Stop daemon
    try { run(`${NPX} xbrowser daemon stop --json`); } catch { /* ok */ }
    killByPort(9224);
    // Kill Chromium
    if (chromiumChild?.pid) {
      try { process.kill(chromiumChild.pid, 'SIGKILL'); } catch { /* ok */ }
    }
    killByPort(CDP_PORT);
  }, 15000);

  it('should start daemon and open a session via daemon', () => {
    const result = runJson(
      `${NPX} xbrowser session open ${TEST_URL} --name ${SESSION_NAME} --cdp ${CDP_ENDPOINT} --json`,
    );
    expect(result.ok).toBe(true);
    expect(result.name).toBe(SESSION_NAME);
  });

  it('should prove session exists in daemon via session list', () => {
    const result = runJson(
      `${NPX} xbrowser session list --json`,
    );
    const sessions = result.sessions as Array<{ name: string }>;
    const found = sessions?.some((s) => s.name === SESSION_NAME);
    expect(found).toBe(true);
  });

  it('should confirm daemon health is ok after session open', () => {
    const health = runJson(
      `${NPX} xbrowser daemon status --json`,
    );
    expect(health.running).toBe(true);
    expect(typeof health.pid).toBe('number');
    expect(health.pid).toBeGreaterThan(0);
  });

  it('should access session URL from a second CLI process via --session', () => {
    const result = runJson(
      `${NPX} xbrowser url --session ${SESSION_NAME} --cdp ${CDP_ENDPOINT} --json`,
    );
    const data = result.data as { url?: string } | undefined;
    const url = data?.url ?? (result.url as string | undefined);
    expect(url).toBeDefined();
    expect(url).toContain('baidu');
  });

  it('should access session title from a second CLI process', () => {
    const result = runJson(
      `${NPX} xbrowser title --session ${SESSION_NAME} --cdp ${CDP_ENDPOINT} --json`,
    );
    const data = result.data as { title?: string } | undefined;
    const title = data?.title ?? (result.title as string | undefined);
    expect(title).toBeDefined();
    expect(title).toContain('百度');
  });
});
