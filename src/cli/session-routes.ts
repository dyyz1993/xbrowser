import {
  closeSession,
  listSessions,
} from '../session/session-client.js';
import { handleSessionHelp } from '../builtins/index.js';
import { outputEnvelope } from './output.js';
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
        outputEnvelope({ success: true, data: { closed: count, all: true } }, { command: 'session close' }, mode);
      } else {
        const name = (options.session as string) || (options.name as string) || process.env.XBROWSER_SESSION || 'default';
        try { await forwardSessionClose(name); } catch { /* daemon may be down */ }
        await closeSession(name);
        outputEnvelope({ success: true, data: { name } }, { command: 'session close' }, mode);
      }
      break;
    }
    case 'list':
    case 'ls': {
      try {
        const sessions = await forwardSessionList();
        outputEnvelope({ success: true, data: { sessions } }, { command: 'session list' }, mode);
      } catch {
        const sessions = await listSessions();
        outputEnvelope({ success: true, data: { sessions } }, { command: 'session list' }, mode);
      }
      break;
    }
    case 'kill': {
      const name = (options.session as string) || (options.name as string) || process.env.XBROWSER_SESSION || 'default';
      try { await forwardSessionClose(name); } catch { /* ignore */ }
      await closeSession(name);
      try { await stopDaemonProcess(); } catch { /* ignore */ }
      outputEnvelope({ success: true, data: { name, killed: true, daemon: 'stopped' } }, { command: 'session kill' }, mode);
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
      outputEnvelope({ success: true, data: { sessionsCleaned: cleaned, daemon: 'killed' } }, { command: 'session kill-all' }, mode);
      break;
    }
    default:
      console.log(handleSessionHelp());
  }
}
