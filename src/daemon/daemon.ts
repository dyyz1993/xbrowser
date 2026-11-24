import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { stopDaemon as xcliStopDaemon, isDaemonRunning, getDaemonStatus, killAllDaemon } from '@dyyz1993/xcli-core';
import type { DaemonConfig } from '@dyyz1993/xcli-core';
import { currentDaemonPort, daemonConfigDir } from './registry.js';

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
  cdpEndpoint?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'daemon-main.js');

/**
 * DaemonConfig compatible with xcli-core 0.9.0 API.
 * Used by isDaemonRunning(), getDaemonStatus(), stopDaemon(), killAllDaemon().
 * Points at the registry of the daemon on `port`, so these only ever see that daemon.
 */
export function getDaemonConfig(port: number = currentDaemonPort()): DaemonConfig {
  return {
    configDir: daemonConfigDir(port),
    workerEntryPath: WORKER_PATH,
    basePort: port,
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
export async function startDaemonProcess(port: number = currentDaemonPort()): Promise<DaemonInfo> {
  // Quick check using xcli-core 0.9.0 isDaemonRunning()
  const config = getDaemonConfig(port);
  if (isDaemonRunning(config)) {
    const status = getDaemonStatus(config);
    if (status.port === port && status.pid) {
      return { pid: status.pid, port: status.port, startedAt: new Date().toISOString() };
    }
    // The registry of this port holds a record of another port: replace it.
    // A daemon on another port has its own registry and is not touched.
    await xcliStopDaemon(config);
  }

  // ── File lock to prevent concurrent daemon startup races (#30) ──
  const registryDir = config.configDir;
  const lockFile = join(registryDir, 'daemon.lock');
  try {
    mkdirSync(registryDir, { recursive: true });
    // O_EXCL ensures only one process can create the file
    writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
  } catch {
    // Lock exists — another process is starting the daemon. Wait for it.
    console.error('Another process is starting the daemon, waiting...');
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (isDaemonRunning(config)) {
        const s = getDaemonStatus(config);
        if (s.port === port && s.pid) {
          return { pid: s.pid, port: s.port, startedAt: new Date().toISOString() };
        }
      }
    }
    // Lock stale (holder crashed) — remove and continue
    try { unlinkSync(lockFile); } catch { /* ignore */ }
    try { writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); } catch { /* race lost */ }
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
        // Clean up lock on timeout
        try { unlinkSync(lockFile); } catch { /* ignore */ }
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
          // Clean up lock
          try { unlinkSync(lockFile); } catch { /* ignore */ }
          resolve({ pid: s.pid, port: s.port, startedAt: new Date().toISOString() });
        }
      }
    }, 200);

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(checkInterval);
        try { unlinkSync(lockFile); } catch { /* ignore */ }
        reject(err);
      }
    });
  });
}

/**
 * Stop the daemon process using xcli-core's stopDaemon().
 * Only the daemon on `port` (XBROWSER_DAEMON_PORT by default) is stopped.
 */
export async function stopDaemonProcess(port: number = currentDaemonPort()): Promise<void> {
  await xcliStopDaemon(getDaemonConfig(port));
}

/**
 * Kill ALL daemon processes using xcli-core 0.9.0 killAllDaemon().
 * Useful for clean shutdown or troubleshooting.
 */
export async function killAllDaemonProcesses(port: number = currentDaemonPort()): Promise<void> {
  await killAllDaemon(getDaemonConfig(port));
}

/**
 * Get daemon process status using xcli-core's isDaemonRunning() + getDaemonStatus().
 */
export function getDaemonProcessStatus(port: number = currentDaemonPort()): {
  running: boolean;
  pid: number;
  port: number;
  info: DaemonInfo | null;
} {
  const config = getDaemonConfig(port);
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
