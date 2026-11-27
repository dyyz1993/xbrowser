/**
 * 插件临时存储目录的清理。
 *
 * xcli-core 的 `CompositeStorage` 为每个插件、在每个进程里都建一个
 * `os.tmpdir()/xbrowser-<pid>/<plugin>/` 临时目录，而且从不清理：CLI、daemon、vitest worker
 * 每起一个进程就留下 127 个空目录——2026-11-27 实测系统临时目录里积了 2860 个 `xbrowser-<pid>`。
 *
 * 这里只动「本工具自己的临时目录」，不碰任何用户数据（插件持久数据在 `~/.xbrowser/storage/<plugin>`，
 * 临时目录按定义就是可再生的）：
 *  - `registerTmpStorageCleanup()`：进程退出时删掉自己 pid 的那个目录（正常退出路径）；
 *  - `sweepStaleTmpStorageDirs()`：daemon 启动时清掉 pid 已不存在的残留目录（崩溃 / 被杀留下的）。
 */
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = 'xbrowser-';

export function ownTmpStorageDir(pid: number = process.pid): string {
  return join(tmpdir(), `${PREFIX}${pid}`);
}

let registered = false;

/**
 * 进程退出时删除本进程的 `xbrowser-<pid>` 目录（幂等，只注册一次）。
 * 返回清理函数本身，方便测试直接调用而不用真的退出进程。
 */
export function registerTmpStorageCleanup(): () => void {
  const cleanup = () => removeDir(ownTmpStorageDir());
  if (!registered) {
    registered = true;
    process.on('exit', cleanup);
  }
  return cleanup;
}

/** 只认「目录名 = xbrowser-<纯数字 pid>」；别的临时物（`xbrowser-cover-*.html`、`xbrowser-marketplace-*`）不归这里管。 */
const PID_DIR_RE = /^xbrowser-(\d+)$/;

function parsePidDir(name: string): number | null {
  const match = PID_DIR_RE.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * 清掉 `xbrowser-<pid>` 中 pid 已不存在的目录，返回删除的数量（同步版，适合测试和小批量）。
 * 自己的和还活着的进程的目录都不动。
 */
export function sweepStaleTmpStorageDirs(options: {
  root?: string;
  isAlive?: (pid: number) => boolean;
  ownPid?: number;
} = {}): number {
  const root = options.root ?? tmpdir();
  const isAlive = options.isAlive ?? isProcessAlive;
  const ownPid = options.ownPid ?? process.pid;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    if (shouldRemove(name, ownPid, isAlive) && removeDir(join(root, name))) removed += 1;
  }
  return removed;
}

/**
 * 异步分批版：每删 `chunkSize` 个就让出一次事件循环。daemon 启动后用它清存量——
 * 积压几千个目录时同步删会卡住启动十几秒（CLI 等不到健康检查就报 Daemon not available）。
 */
export async function sweepStaleTmpStorageDirsAsync(options: {
  root?: string;
  isAlive?: (pid: number) => boolean;
  ownPid?: number;
  chunkSize?: number;
  log?: (message: string) => void;
} = {}): Promise<number> {
  const root = options.root ?? tmpdir();
  const isAlive = options.isAlive ?? isProcessAlive;
  const ownPid = options.ownPid ?? process.pid;
  const chunkSize = Math.max(1, options.chunkSize ?? 50);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (let start = 0; start < entries.length; start += chunkSize) {
    for (const name of entries.slice(start, start + chunkSize)) {
      if (shouldRemove(name, ownPid, isAlive) && removeDir(join(root, name))) removed += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (removed > 0) options.log?.(`Swept ${removed} stale xbrowser-<pid> tmp storage dir(s)`);
  return removed;
}

function shouldRemove(name: string, ownPid: number, isAlive: (pid: number) => boolean): boolean {
  const pid = parsePidDir(name);
  if (pid === null) return false;
  return pid !== ownPid && !isAlive(pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = 进程存在但不归当前用户管；其它错误（ESRCH 等）= 不存在
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function removeDir(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
