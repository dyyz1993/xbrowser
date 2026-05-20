import {
  closeSession,
  listSessions,
} from '../session/session-client.js';
import { handleSessionHelp } from '../builtins/index.js';
import { outputResult, outputError } from './output.js';
import { isDaemonRunning, forwardSessionCreate, forwardSessionClose, forwardSessionList } from '../client/daemon-client.js';
import { startDaemonProcess, stopDaemonProcess } from '../daemon/daemon.js';

/**
 * Ensure daemon is running. Auto-start if not.
 * If auto-start fails, abort with error — session operations MUST go through daemon.
 */
async function ensureDaemon(): Promise<void> {
  if (process.env.XBROWSER_DAEMON_WORKER) return; // already inside daemon
  if (await isDaemonRunning().catch(() => false)) return;

  try {
    await startDaemonProcess(9224);
  } catch (e) {
    outputError(`Failed to start daemon: ${(e as Error).message}. Session operations require daemon.`);
  }
}

export async function handleSession(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
  cdpEndpoint?: string
): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'open': {
      await ensureDaemon();
      const url = args[1];
      const name = (options.name as string) || 'default';
      if (!url)
        outputError('Usage: xbrowser session open <url> [--name <name>] [--cdp <endpoint>]');

      const info = await forwardSessionCreate(name, url, cdpEndpoint);
      outputResult({ ok: true, ...info }, mode);
      break;
    }
    case 'close': {
      const name = (options.name as string) || 'default';
      try { await forwardSessionClose(name); } catch { /* daemon may be down */ }
      await closeSession(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'list':
    case 'ls': {
      try {
        const sessions = await forwardSessionList();
        outputResult({ sessions }, mode);
      } catch {
        const sessions = await listSessions();
        outputResult({ sessions }, mode);
      }
      break;
    }
    case 'kill': {
      // Kill everything: close all sessions + stop daemon
      const name = (options.name as string) || 'default';
      try { await forwardSessionClose(name); } catch { /* ignore */ }
      await closeSession(name);
      try { await stopDaemonProcess(); } catch { /* ignore */ }
      outputResult({ ok: true, name, killed: true, daemon: 'stopped' }, mode);
      break;
    }
    default:
      console.log(handleSessionHelp());
  }
}
