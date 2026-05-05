import {
  openSession,
  closeSession,
  listSessions,
} from '../session/session-client.js';
import { handleSessionHelp } from '../builtins/index.js';
import { outputResult, outputError } from './output.js';

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
      const name = (options.name as string) || 'default';
      if (!url)
        outputError('Usage: xbrowser session open <url> [--name <name>] [--cdp <endpoint>]');
      const info = await openSession(name, url, { cdpEndpoint });
      outputResult({ ok: true, ...info }, mode);
      break;
    }
    case 'close': {
      const name = (options.name as string) || 'default';
      await closeSession(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'list':
    case 'ls': {
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
