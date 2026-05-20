import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { stopDaemon as xcliStopDaemon, getDaemonStatus } from '@dyyz1993/xcli-core';
import type { DaemonConfig } from '@dyyz1993/xcli-core';

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
  cdpEndpoint?: string;
}

const CONFIG_DIR = join(homedir(), '.xbrowser');

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'daemon-worker.js');

/**
 * DaemonConfig compatible with xcli-core's daemon-manager API.
 *
 * Used by getDaemonStatus() and stopDaemon() which only read daemon.json
 * and use process.kill — no tsx dependency required.
 *
 * For startDaemonProcess(), we use our own spawn (without --import tsx)
 * since xbrowser's daemon-worker is compiled JS.
 */
export function getDaemonConfig(): DaemonConfig {
  return {
    configDir: CONFIG_DIR,
    workerEntryPath: WORKER_PATH,
    basePort: 9224,
  };
}

/**
 * Start the daemon process. Spawns daemon-worker.js as a detached child.
 *
 * Uses xcli-core's getDaemonStatus() for health polling (it reads
 * daemon.json which the worker writes after initializing its HTTP server).
 *
 * Does NOT use xcli-core's startDaemon() because that spawns with
 * --import tsx, which requires tsx to be installed. xbrowser's
 * daemon-worker.js is compiled JS and loads without tsx.
 */
export async function startDaemonProcess(port: number = 9224): Promise<DaemonInfo> {
  // Check if daemon is already running using xcli-core's daemon.json reader
  const status = getDaemonStatus(getDaemonConfig());
  if (status.running && status.port === port && status.pid) {
    return { pid: status.pid, port: status.port, startedAt: new Date().toISOString() };
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
      const s = getDaemonStatus(getDaemonConfig());
      if (s.running && s.port === port && s.pid) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve({ pid: s.pid, port: s.port, startedAt: new Date().toISOString() });
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
 * Sends SIGTERM, removes daemon.json, and stops the WebSocket server.
 */
export async function stopDaemonProcess(): Promise<void> {
  await xcliStopDaemon(getDaemonConfig());
}

/**
 * Get daemon process status using xcli-core's getDaemonStatus().
 *
 * Returns both xcli-core's structured status and our own DaemonInfo
 * for backward compatibility.
 */
export function getDaemonProcessStatus(): {
  running: boolean;
  pid: number;
  port: number;
  info: DaemonInfo | null;
} {
  const status = getDaemonStatus(getDaemonConfig());
  return {
    running: status.running,
    pid: status.pid,
    port: status.port,
    info: status.running
      ? { pid: status.pid, port: status.port, startedAt: new Date().toISOString() }
      : null,
  };
}
