import { homedir } from 'os';
import { join } from 'path';

export const DEFAULT_DAEMON_PORT = 9224;

/** The daemon this process talks to: XBROWSER_DAEMON_PORT, or the default port. */
export function currentDaemonPort(): number {
  const port = Number(process.env.XBROWSER_DAEMON_PORT);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_DAEMON_PORT;
}

/**
 * Directory holding the daemon.json of the daemon on `port`.
 *
 * daemon.json describes exactly one daemon. With a single directory, a daemon
 * started on another port overwrote the record of the default one, and the
 * next start on either port saw a port mismatch and stopped the other daemon.
 * Every other port therefore keeps its own directory; the default port keeps
 * ~/.xbrowser as before.
 */
export function daemonConfigDir(port: number, home: string = homedir()): string {
  const base = join(home, '.xbrowser');
  return port === DEFAULT_DAEMON_PORT ? base : join(base, 'daemons', String(port));
}
