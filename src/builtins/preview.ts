import { networkInterfaces } from 'os';
import type { BuiltinCommand, BuiltinContext } from './session.js';
import { getDaemonProcessStatus } from '../daemon/daemon.js';

function getLANIP(): string {
  const nets = networkInterfaces();
  for (const name of ['en0', 'eth0', 'wlan0']) {
    const net = nets[name];
    if (!net) continue;
    for (const addr of net) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  // Fallback: scan all interfaces
  for (const [, net] of Object.entries(nets)) {
    if (!net) continue;
    for (const addr of net) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

const previewBuiltin: BuiltinCommand = {
  name: 'preview',
  description: 'Show preview URL for active daemon sessions',
  help: {
    usage: 'xbrowser preview [--json]',
    description: 'Display the WebSocket preview URL for the running daemon. Preview is always available when the daemon is running — just connect to the WS endpoint.',
    options: [
      { name: 'json', description: 'Output as JSON' },
    ],
    examples: [
      { cmd: 'xbrowser preview', description: 'Show preview URL (LAN address preferred)' },
      { cmd: 'xbrowser preview --json', description: 'Output as JSON' },
    ],
  },
  execute: async (_args: string[], options: Record<string, unknown>, _context: BuiltinContext): Promise<void> => {
    const daemon = getDaemonProcessStatus();

    if (!daemon.running) {
      if (options.json) {
        console.log(JSON.stringify({ running: false }));
      } else {
        console.log('Daemon is not running. Start with: xbrowser daemon start');
        console.log('');
        console.log('Preview is automatically available when the daemon is running.');
      }
      return;
    }

    const port = daemon.port || 9224;
    const lanIP = getLANIP();
    const sessionId = (options.session as string) || 'default';
    const previewURL = `http://${lanIP}:${port}/preview/${sessionId}`;

    if (options.json) {
      console.log(JSON.stringify({
        running: true,
        pid: daemon.pid,
        port,
        sessionId,
        url: previewURL,
      }));
      return;
    }

    console.log(previewURL);
  },
};

export { previewBuiltin };
