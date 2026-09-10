#!/usr/bin/env node
import { routeCommand } from '../src/router.js';
import { readStdin } from '../src/stdin.js';
import { ensureProxyFetch } from '../src/utils/proxy-fetch.js';

async function main() {
  let exitCode = 0;
  try {
    await ensureProxyFetch();
    // `mcp` 的 stdin 是 JSON-RPC 协议通道，绝不能当命令输入吃掉
    const isMcp = process.argv[2] === 'mcp';
    const stdinCommands = isMcp ? [] : await readStdin();
    await routeCommand(process.argv.slice(2), stdinCommands);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    exitCode = 1;
  } finally {
    // Only cleanup browser for short-lived commands.
    // Long-running server commands (preview, serve) manage their own lifecycle.
    const command = process.argv[2];
    const isLongRunning = command === 'preview' || command === 'serve' || command === 'mcp';
    if (!isLongRunning) {
      // Ensure all async resources (CDP WebSocket, timers, proxy agents) are cleaned up
      // so the process can exit cleanly.
      const { ensureProcessCanExit } = await import('../src/browser.js');
      await ensureProcessCanExit().catch(() => {});
      process.exit(process.exitCode || exitCode);
    }
  }
}

main();
