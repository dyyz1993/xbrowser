import { homedir } from 'os';
import { join } from 'path';
import {
  CompositeStorage,
  configureArchiveStore,
  appendCommandToArchive,
  type CommandArchiveEntry,
  type StorageContext,
  fail,
  type Tip,
  checkGuard,
} from '@dyyz1993/xcli-core';
import type { ManagedSession } from '../browser.js';
import type { WSServer, CommandMessage } from '../websocket-server.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';
import type { ExecutionResult } from './types.js';
import { registerTmpStorageCleanup } from '../plugin/tmp-storage-cleanup.js';

export const NAVIGATION_COMMANDS = new Set(['goto', 'back', 'forward', 'refresh']);
export const snapshotHintShown = new WeakSet<ManagedSession>();

const CONFIG_DIR = join(homedir(), '.xbrowser');
const storageCache = new Map<string, StorageContext>();

export function getPluginStorage(pluginName: string): StorageContext {
  // xcli-core 会在 os.tmpdir()/xbrowser-<pid>/<plugin>/ 给每个插件建临时目录且从不清理：
  // 这里顺手挂上「进程退出时删自己那份」的收尾（幂等）
  registerTmpStorageCleanup();
  if (!storageCache.has(pluginName)) {
    storageCache.set(pluginName, new CompositeStorage(pluginName, CONFIG_DIR, 'xbrowser'));
  }
  return storageCache.get(pluginName)!;
}

let archiveInitialized = false;
function ensureArchiveInit(): void {
  if (!archiveInitialized) {
    try {
      configureArchiveStore({ archiveDir: join(homedir(), '.xbrowser', 'archives') });
    } catch {
      // Archive initialization is best-effort.
    }
    archiveInitialized = true;
  }
}

export function recordArchive(
  sessionId: string | undefined,
  sessionName: string,
  entry: CommandArchiveEntry
): void {
  if (!sessionId) return;
  try {
    ensureArchiveInit();
    appendCommandToArchive(sessionId, sessionName, entry);
  } catch {
    // Archive write failure must not fail commands.
  }
}

export async function guardCheck(
  commandName: string
): Promise<{ blocked: boolean; message: string } | null> {
  try {
    const loader = await getPluginLoader();
    return checkGuard(loader.getCore(), commandName, process.env);
  } catch {
    return null;
  }
}

export function errorResult(message: string): ExecutionResult {
  return { ...fail(message), duration: 0 };
}

export function tipsToMessages(tips: Tip[] | undefined): string[] {
  if (!tips || tips.length === 0) return [];
  return tips.map((tip) => (typeof tip === 'string' ? tip : tip.message));
}

let wsServer: WSServer | null = null;

export function setWSServer(server: WSServer | null): void {
  wsServer = server;
}

export function streamCommandEvent(sessionId: string, message: CommandMessage): void {
  if (!wsServer || !wsServer.getRunning()) return;
  wsServer.broadcastToSession(sessionId, { type: 'command', data: message });
}
