import { networkInterfaces } from 'os';
import type { BuiltinCommand, BuiltinContext } from './session.js';
import { getDaemonProcessStatus } from '../daemon/daemon.js';
import { outputResult } from '../cli/output.js';

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
        outputResult({ running: false }, 'json');
      } else {
        console.log('Daemon is not running. It will start automatically when needed.');
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
      outputResult({
        running: true,
        pid: daemon.pid,
        port,
        sessionId,
        url: previewURL,
      }, 'json');
      return;
    }

    console.log(previewURL);
  },
};

export { previewBuiltin };
