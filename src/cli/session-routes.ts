import {
  closeSession,
  listSessions,
} from '../session/session-client.js';
import { handleSessionHelp } from '../builtins/index.js';
import { outputResult, outputError } from './output.js';
import { forwardSessionCreate, forwardSessionClose, forwardSessionList } from '../client/daemon-client.js';
import { stopDaemonProcess, killAllDaemonProcesses } from '../daemon/daemon.js';
import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, rmSync } from 'node:fs';

function cleanSessionFiles(): number {
  const dir = join(homedir(), '.xbrowser', 'sessions');
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      rmSync(p, { recursive: true, force: true });
      count++;
    }
  } catch { /* no session dir */ }
  return count;
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
      const url = args[1];
      const name = (options.name as string) || process.env.XBROWSER_SESSION || 'default';
      if (!url)
        outputError('Usage: xbrowser session open <url> [--name <name>] [--cdp <endpoint>]');

      const info = await forwardSessionCreate(name, url, cdpEndpoint);
      outputResult({ ok: true, ...info }, mode);
      break;
    }
    case 'close': {
      const name = (options.name as string) || process.env.XBROWSER_SESSION || 'default';
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
      const name = (options.name as string) || process.env.XBROWSER_SESSION || 'default';
      try { await forwardSessionClose(name); } catch { /* ignore */ }
      await closeSession(name);
      try { await stopDaemonProcess(); } catch { /* ignore */ }
      outputResult({ ok: true, name, killed: true, daemon: 'stopped' }, mode);
      break;
    }
    case 'kill-all': {
      try {
        const sessions = await forwardSessionList();
        for (const s of sessions) {
          try { await forwardSessionClose(s.name); } catch { /* ignore */ }
        }
      } catch { /* daemon may be down */ }
      try { await killAllDaemonProcesses(); } catch { /* ignore */ }
      const cleaned = cleanSessionFiles();
      outputResult({ ok: true, sessionsCleaned: cleaned, daemon: 'killed' }, mode);
      break;
    }
    default:
      console.log(handleSessionHelp());
  }
}
