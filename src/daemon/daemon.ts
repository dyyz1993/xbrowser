import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { stopDaemon as xcliStopDaemon, isDaemonRunning, getDaemonStatus, killAllDaemon } from '@dyyz1993/xcli-core';
import type { DaemonConfig } from '@dyyz1993/xcli-core';

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
  cdpEndpoint?: string;
}

const CONFIG_DIR = join(homedir(), '.xbrowser');

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'daemon-main.js');

/**
 * DaemonConfig compatible with xcli-core 0.9.0 API.
 * Used by isDaemonRunning(), getDaemonStatus(), stopDaemon(), killAllDaemon().
 */
export function getDaemonConfig(): DaemonConfig {
  return {
    configDir: CONFIG_DIR,
    workerEntryPath: WORKER_PATH,
    basePort: 9224,
  };
}

/**
 * Start the daemon process. Spawns daemon-main.js as a detached child.
 *
 * Uses xcli-core's isDaemonRunning() for quick check, then getDaemonStatus()
 * for detailed health polling after spawn.
 *
 * Does NOT use xcli-core's startDaemon() because that spawns with
 * --import tsx, which requires tsx to be installed. xbrowser's
 * daemon-main.js is compiled JS and loads without tsx.
 */
export async function startDaemonProcess(port: number = 9224): Promise<DaemonInfo> {
  // Quick check using xcli-core 0.9.0 isDaemonRunning()
  const config = getDaemonConfig();
  if (isDaemonRunning(config)) {
    const status = getDaemonStatus(config);
    if (status.port === port && status.pid) {
      return { pid: status.pid, port: status.port, startedAt: new Date().toISOString() };
    }
    // Port mismatch — stop existing and restart
    await xcliStopDaemon(config);
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
        reject(new Error('Daemon start timeout after 15s'));
      }
    }, 15000);

    const checkInterval = setInterval(() => {
      if (isDaemonRunning(config)) {
        const s = getDaemonStatus(config);
        if (s.port === port && s.pid) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve({ pid: s.pid, port: s.port, startedAt: new Date().toISOString() });
        }
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

/**
 * Stop the daemon process using xcli-core's stopDaemon().
 */
export async function stopDaemonProcess(): Promise<void> {
  await xcliStopDaemon(getDaemonConfig());
}

/**
 * Kill ALL daemon processes using xcli-core 0.9.0 killAllDaemon().
 * Useful for clean shutdown or troubleshooting.
 */
export async function killAllDaemonProcesses(): Promise<void> {
  await killAllDaemon(getDaemonConfig());
}

/**
 * Get daemon process status using xcli-core's isDaemonRunning() + getDaemonStatus().
 */
export function getDaemonProcessStatus(): {
  running: boolean;
  pid: number;
  port: number;
  info: DaemonInfo | null;
} {
  const config = getDaemonConfig();
  const running = isDaemonRunning(config);
  if (!running) {
    return { running: false, pid: 0, port: 0, info: null };
  }
  const status = getDaemonStatus(config);
  return {
    running: true,
    pid: status.pid,
    port: status.port,
    info: { pid: status.pid, port: status.port, startedAt: new Date().toISOString() },
  };
}
