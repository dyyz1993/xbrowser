#!/usr/bin/env node
import { routeCommand } from '../src/router.js';
import { readStdin } from '../src/stdin.js';
import { ensureProxyFetch } from '../src/utils/proxy-fetch.js';

async function main() {
  let exitCode = 0;
  try {
    await ensureProxyFetch();
    const stdinCommands = await readStdin();
    await routeCommand(process.argv.slice(2), stdinCommands);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    exitCode = 1;
  } finally {
    // Only cleanup browser for short-lived commands.
    // Long-running server commands (preview, serve, daemon) manage their own lifecycle.
    const { getDaemonProcessStatus } = await import('../src/daemon/daemon.js');
    const daemonStatus = getDaemonProcessStatus();
    const command = process.argv[2];
    const subCommand = process.argv[3];
    const isLongRunning = command === 'preview' || command === 'serve' || daemonStatus.running;
    const isSessionClose = command === 'session' && (subCommand === 'close' || subCommand === 'kill');
    if (!isLongRunning) {
      if (isSessionClose) {
        const { destroyBrowser } = await import('../src/browser.js');
        await destroyBrowser().catch(() => { });
      }
      process.exit(exitCode);
    }
  }
}

main();
