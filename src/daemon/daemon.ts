import { spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { stopDaemon, isDaemonRunning } from '@dyyz1993/xcli-core';
import type { DaemonConfig as XCliDaemonConfig } from '@dyyz1993/xcli-core';

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
  cdpEndpoint?: string;
}

const CONFIG_DIR = join(homedir(), '.xbrowser');
const CONFIG_PATH = join(CONFIG_DIR, 'daemon.json');

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'daemon-worker.js');

function xcliConfig(): XCliDaemonConfig {
  return {
    configDir: CONFIG_DIR,
    workerEntryPath: WORKER_PATH,
    basePort: 9224,
  };
}

function readConfig(): DaemonInfo | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as DaemonInfo;
  } catch {
    return null;
  }
}

function clearConfig(): void {
  if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startDaemonProcess(
  port: number = 9224,
): Promise<DaemonInfo> {
  const existing = readConfig();
  if (existing && isProcessRunning(existing.pid)) {
    throw new Error(`Daemon already running (PID: ${existing.pid}, port: ${existing.port})`);
  }

  const child = spawn('node', [WORKER_PATH], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      XBROWSER_DAEMON_PORT: String(port),
    },
  });

  child.unref();

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearConfig();
        reject(new Error('Daemon start timeout after 15s'));
      }
    }, 15000);

    const checkInterval = setInterval(() => {
      const cfg = readConfig();
      if (cfg && cfg.port === port && cfg.pid) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve(cfg);
      }
    }, 200);

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(checkInterval);
        reject(err);
      }
    });
  });
}

export async function stopDaemonProcess(): Promise<void> {
  await stopDaemon(xcliConfig());
}

export function getDaemonProcessStatus(): {
  running: boolean;
  pid: number;
  port: number;
  info: DaemonInfo | null;
} {
  const running = isDaemonRunning(xcliConfig());
  const info = readConfig();
  if (!running) {
    clearConfig();
    return { running: false, pid: 0, port: 0, info: null };
  }
  return {
    running: true,
    pid: info?.pid ?? 0,
    port: info?.port ?? 0,
    info,
  };
}

export { isDaemonRunning, xcliConfig as getDaemonConfig };
