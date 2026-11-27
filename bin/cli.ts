#!/usr/bin/env node
import { routeCommand } from '../src/router.js';
import { readStdin } from '../src/stdin.js';
import { ensureProxyFetch } from '../src/utils/proxy-fetch.js';
import { registerTmpStorageCleanup } from '../src/plugin/tmp-storage-cleanup.js';

async function main() {
  let exitCode = 0;
  try {
    // 进程退出时删掉本进程的插件临时目录（os.tmpdir()/xbrowser-<pid>/，xcli-core 建了不删）
    registerTmpStorageCleanup();
    await ensureProxyFetch();
    // `mcp` 的 stdin 是 JSON-RPC 协议通道，绝不能当命令输入吃掉。
    // `site-memory mcp` 同理（嵌套子命令同样走 stdio MCP）。
    const isMcp =
      process.argv[2] === 'mcp' ||
      (process.argv[2] === 'site-memory' && process.argv[3] === 'mcp');
    const stdinCommands = isMcp ? [] : await readStdin();
    await routeCommand(process.argv.slice(2), stdinCommands);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    exitCode = 1;
  } finally {
    // Only cleanup browser for short-lived commands.
    // Long-running server commands (preview, serve) manage their own lifecycle.
    const command = process.argv[2];
    const commandSub = process.argv[3];
    const isLongRunning =
      command === 'preview' ||
      command === 'serve' ||
      command === 'mcp' ||
      command === 'console-panel' ||
      (command === 'site-memory' && commandSub === 'mcp');
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
