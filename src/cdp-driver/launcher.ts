/**
 * Chrome Process Launcher
 *
 * Spawns a Chromium/Chrome process with --remote-debugging-port and discovers
 * the WebSocket debugger URL via the HTTP /json/version endpoint.
 *
 * Replaces Playwright's chromium.launch() with zero external dependencies.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { errMsg } from '../utils/error.js';
import { existsSync as fsExistsSync } from 'node:fs';

// ── Types ──────────────────────────────────────────────────────

export interface LaunchResult {
  /** The child process */
  process: ChildProcess;
  /** Browser-level WebSocket debugger URL (ws://...) */
  wsEndpoint: string;
  /** The port Chrome is listening on */
  port: number;
  /** Temp directory used by Chrome (for cleanup) */
  tmpDir?: string;
}

export interface ChromeLaunchOptions {
  /** Path to Chrome/Chromium executable */
  executablePath?: string;
  /** Run in headless mode (default: true) */
  headless?: boolean;
  /** Additional Chrome args */
  args?: string[];
  /** User data directory for persistent profile */
  userDataDir?: string;
  /** Launch timeout in ms (default: 30_000) */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
}

// ── Default Chrome paths ───────────────────────────────────────

const DEFAULT_CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

export const DEFAULT_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--no-sandbox',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-hang-monitor',
  '--disable-ipc-flood-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--password-store=basic',
  '--use-mock-keychain',
];

// ── Anti-detection args ────────────────────────────────────────
// These flags remove common automation signals that anti-bot systems detect.
export const ANTI_DETECT_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
];

// ── Public API ─────────────────────────────────────────────────

/**
 * Find a Chrome/Chromium executable on the system.
 *
 * Checks the provided path first, then platform-specific default locations.
 *
 * @returns the path to the executable, or null if not found
 */
export function findChrome(): string | null {
  const platform = process.platform as keyof typeof DEFAULT_CHROME_PATHS;
  const paths = DEFAULT_CHROME_PATHS[platform] ?? [];

  for (const p of paths) {
    if (fsExistsSync(p)) return p;
  }
  return null;
}

/**
 * Launch a Chrome process with remote debugging enabled.
 *
 * 1. Resolves the Chrome executable path
 * 2. Spawns the process with debugging flags
 * 3. Waits for the HTTP /json/version endpoint to become available
 * 4. Returns the WebSocket endpoint
 *
 * @example
 * ```typescript
 * const { process, wsEndpoint, port } = await launchChrome({
 *   headless: true,
 * });
 * const conn = new CDPConnection(wsEndpoint);
 * await conn.ready();
 * ```
 */
export async function launchChrome(options: ChromeLaunchOptions = {}): Promise<LaunchResult> {
  const {
    executablePath,
    headless = true,
    args: extraArgs = [],
    userDataDir,
    timeout = 30_000,
    env,
  } = options;

  const chromePath = executablePath ?? findChrome();
  if (!chromePath) {
    throw new Error(
      [
        'Chrome/Chromium not found.',
        '',
        '推荐：用 cdp-tunnel 复用你已有的 Chrome（含登录态、反爬友好）',
        '  npx cdp-tunnel setup          # 零安装一键启动代理 + 加载 Chrome 扩展',
        '  xbrowser goto https://example.com --cdp http://localhost:9221',
        '',
        '或指定 Chrome 路径：',
        '  xbrowser config set browser.executablePath "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
      ].join('\n'),
    );
  }

  const port = await findFreePort();
  const allArgs: string[] = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate',
    '--disable-popup-blocking',
  ];

  if (headless) {
    // Use --headless for broad compatibility. --headless=new has port binding
    // issues on some Chrome versions (148+).
    allArgs.push('--headless', '--hide-scrollbars', '--mute-audio');
    // autoplay 策略（d61/S85 边界第 5 例实测记录）：此 headless 构建的
    // muted autoplay 也被 NotAllowedError 拒（真机默认允许 muted）——
    // no-user-gesture-required flag 实测无效，构建级限制（媒体站可据此
    // 识别 headless，属暴露面而非可伪装项）。flag 保留：对其他构建可能
    // 生效且无害。
    allArgs.push('--autoplay-policy=no-user-gesture-required');
  }

  let tmpDir: string | undefined;
  if (userDataDir) {
    allArgs.push(`--user-data-dir=${userDataDir}`);
  } else {
    // Use temp directory and ensure it exists
    const { mkdirSync } = await import('node:fs');
    tmpDir = `/tmp/xbrowser-chrome-${process.pid}-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    allArgs.push(`--user-data-dir=${tmpDir}`);
  }

  allArgs.push(...extraArgs, 'about:blank');

  const childEnv = {
    ...process.env,
    ...env,
  } as Record<string, string>;

  // Build the full command string with proper quoting
  const quotedPath = chromePath.includes(' ') ? `"${chromePath}"` : chromePath;
  const quotedArgs = allArgs.map(a => {
    // Args with = don't need outer quoting unless they contain spaces
    if (a.includes(' ')) return `"${a}"`;
    return a;
  }).join(' ');
  const fullCmd = `${quotedPath} ${quotedArgs}`;

  // macOS: Chrome fails to initialize networking when spawned directly
  // by Node.js. Launching via /bin/sh -c ensures proper process setup.
  // Linux/Windows: direct spawn works fine.
  const child = process.platform === 'darwin'
    ? spawn('/bin/sh', ['-c', fullCmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      })
    : spawn(chromePath, allArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      });

  // Capture stderr for debugging
  const stderrLines: string[] = [];
  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) stderrLines.push(line);
  });

  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) stderrLines.push(`[stdout] ${line}`);
  });

  child.on('error', (err) => {
    if (!child.killed) {
      console.error(`Chrome process error: ${err.message}`);
    }
  });

  // Wait for CDP endpoint
  try {
    const wsEndpoint = await waitForCDPReady(port, timeout, child);
    return { process: child, wsEndpoint, port, tmpDir };
  } catch (err) {
    // Include stderr in error for debugging
    const stderr = stderrLines.slice(-20).join('\n');
    const exitInfo = child.exitCode !== null ? ` (exit code: ${child.exitCode})` : ' (still running)';
    throw new Error(`${errMsg(err)}${exitInfo}\nChrome stderr:\n${stderr || '(empty)'}`);
  }
}

/**
 * Connect to an existing Chrome instance via CDP endpoint.
 *
 * Resolves the WebSocket URL from HTTP /json/version.
 * If wsEndpoint is already provided as ws:// URL, returns it directly.
 */
export async function connectToCDP(rawEndpoint: string): Promise<string> {
  // Already a WebSocket URL
  if (rawEndpoint.startsWith('ws://') || rawEndpoint.startsWith('wss://')) {
    return rawEndpoint;
  }

  // Resolve via HTTP /json/version
  return resolveEndpointFromHTTP(rawEndpoint);
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * 合并 CDP endpoint 与 HTTP 路径。endpoint 可能带 query（如
 * `http://host:9221?key=cdp_xxx`，多用户网关按 key 隔离配对），
 * 直接字符串拼接会产出 `?key=xx/json/version` 这种非法 URL——
 * 必须用 URL API 把 path 合进 pathname、保留 query。
 */
export function joinCdpHttpUrl(baseURL: string, path: string): string {
  try {
    const u = new URL(baseURL);
    u.pathname = (u.pathname.replace(/\/+$/, '') || '') + path;
    return u.toString();
  } catch {
    // 非 URL 形态（理论上不该出现）退回旧拼接
    return `${baseURL}${path}`;
  }
}

async function findFreePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('Failed to find free port'));
      }
    });
    srv.on('error', reject);
  });
}

async function waitForCDPReady(
  port: number,
  timeoutMs: number,
  child: ChildProcess,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check if process died
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Chrome exited with code ${child.exitCode} before CDP became ready`);
    }

    try {
      const wsEndpoint = await resolveEndpointFromHTTP(`http://127.0.0.1:${port}`);
      return wsEndpoint;
    } catch {
      await sleep(200);
    }
  }

  throw new Error(`Chrome CDP not ready after ${timeoutMs}ms (port ${port})`);
}

async function resolveEndpointFromHTTP(baseURL: string): Promise<string> {
  const url = joinCdpHttpUrl(baseURL, '/json/version');
  const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) {
    throw new Error(`CDP HTTP ${resp.status}: ${url}`);
  }
  const data = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!data.webSocketDebuggerUrl) {
    throw new Error('No webSocketDebuggerUrl in CDP response');
  }
  return data.webSocketDebuggerUrl;
}

/**
 * Get the list of pages from /json/list
 */
export async function getCDPTargets(baseURL: string): Promise<CDPTargetInfo[]> {
  const url = joinCdpHttpUrl(baseURL, '/json/list');
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) {
    throw new Error(`CDP list HTTP ${resp.status}: ${url}`);
  }
  const targets = (await resp.json()) as CDPTargetInfo[];
  return targets;
}

export interface CDPTargetInfo {
  id: string;
  type: 'page' | 'background_page' | 'service_worker' | 'browser' | 'other';
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  devtoolsFrontendUrl?: string;
}

/**
 * Terminate a Chrome child process gracefully and clean up temp directory.
 */
export async function killChrome(child: ChildProcess, tmpDir?: string): Promise<void> {
  if (child.exitCode !== null) {
    // Already exited — just clean up temp dir if any
    if (tmpDir) cleanupTmpDir(tmpDir);
    return;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // SIGKILL after 5s if SIGTERM doesn't work
      try {
        child.kill('SIGKILL');
      } catch { /* best-effort SIGKILL */ }
      if (tmpDir) cleanupTmpDir(tmpDir);
      resolve();
    }, 5000);

    child.once('exit', () => {
      clearTimeout(timer);
      if (tmpDir) cleanupTmpDir(tmpDir);
      resolve();
    });

    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      if (tmpDir) cleanupTmpDir(tmpDir);
      resolve();
    }
  });
}

function cleanupTmpDir(dir: string): void {
  try {
    const { rmSync } = require('node:fs');
    rmSync(dir, { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
