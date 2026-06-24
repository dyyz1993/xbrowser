import {
  closeSession,
  listSessions,
} from '../session/session-client.js';
import { handleSessionHelp } from '../builtins/index.js';
import { outputResult } from './output.js';
import { forwardSessionClose, forwardSessionList } from '../client/daemon-client.js';
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
  _cdpEndpoint?: string
): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'close': {
      if (options.all) {
        // Close all sessions (like kill-all but without stopping daemon)
        let count = 0;
        try {
          const sessions = await forwardSessionList();
          for (const s of sessions) {
            try { await forwardSessionClose(s.name); count++; } catch { /* ignore */ }
          }
        } catch { /* daemon may be down */ }
        outputResult({ ok: true, closed: count, all: true }, mode);
      } else {
        const name = (options.session as string) || (options.name as string) || process.env.XBROWSER_SESSION || 'default';
        try { await forwardSessionClose(name); } catch { /* daemon may be down */ }
        await closeSession(name);
        outputResult({ ok: true, name }, mode);
      }
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
      const name = (options.session as string) || (options.name as string) || process.env.XBROWSER_SESSION || 'default';
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
