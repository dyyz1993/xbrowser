import {
  openSession,
  closeSession,
  listSessions,
} from '../session/session-client.js';
import { handleSessionHelp } from '../builtins/index.js';
import { outputResult, outputError } from './output.js';
import { isDaemonRunning, forwardSessionCreate, forwardSessionClose, forwardSessionList } from '../client/daemon-client.js';

export async function handleSession(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
  cdpEndpoint?: string
): Promise<void> {
  const sub = args[0];
  const useDaemon = !process.env.XBROWSER_DAEMON_WORKER && await isDaemonRunning().catch(() => false);

  switch (sub) {
    case 'open': {
      const url = args[1];
      const name = (options.name as string) || 'default';
      if (!url)
        outputError('Usage: xbrowser session open <url> [--name <name>] [--cdp <endpoint>]');

      if (useDaemon) {
        try {
          const info = await forwardSessionCreate(name, url, cdpEndpoint);
          outputResult({ ok: true, ...info }, mode);
        } catch (e) {
          outputError(`Daemon session:create failed: ${(e as Error).message}`);
        }
      } else {
        const info = await openSession(name, url, { cdpEndpoint });
        outputResult({ ok: true, ...info }, mode);
      }
      break;
    }
    case 'close': {
      const name = (options.name as string) || 'default';
      if (useDaemon) {
        try {
          await forwardSessionClose(name);
        } catch { /* fallback */ }
      }
      await closeSession(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'list':
    case 'ls': {
      if (useDaemon) {
        try {
          const sessions = await forwardSessionList();
          outputResult({ sessions }, mode);
          break;
        } catch { /* fallback to local */ }
      }
      const sessions = await listSessions();
      outputResult({ sessions }, mode);
      break;
    }
    case 'kill': {
      const name = (options.name as string) || 'default';
      await closeSession(name);
      outputResult({ ok: true, name, killed: true }, mode);
      break;
    }
    default:
      console.log(handleSessionHelp());
  }
}
