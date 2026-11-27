import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ownTmpStorageDir,
  registerTmpStorageCleanup,
  sweepStaleTmpStorageDirs,
  sweepStaleTmpStorageDirsAsync,
} from '../../src/plugin/tmp-storage-cleanup.js';

const roots: string[] = [];
const tempRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), 'xb-tmp-sweep-test-'));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('sweepStaleTmpStorageDirs', () => {
  it('removes only xbrowser-<pid> dirs whose pid is dead', () => {
    const root = tempRoot();
    for (const name of ['xbrowser-101', 'xbrowser-202', 'xbrowser-303', 'xbrowser-404']) {
      mkdirSync(join(root, name, 'some-plugin'), { recursive: true });
    }
    // 不是「纯数字 pid」的临时物不归它管
    mkdirSync(join(root, 'xbrowser-marketplace-1795736816594'), { recursive: true });
    writeFileSync(join(root, 'xbrowser-cover-1795736816594.html'), '<html></html>');
    mkdirSync(join(root, 'unrelated-dir'), { recursive: true });

    const removed = sweepStaleTmpStorageDirs({
      root,
      ownPid: 101,
      isAlive: (pid) => pid === 202,
    });

    expect(removed).toBe(2);
    expect(existsSync(join(root, 'xbrowser-101'))).toBe(true); // 自己的
    expect(existsSync(join(root, 'xbrowser-202'))).toBe(true); // 还活着
    expect(existsSync(join(root, 'xbrowser-303'))).toBe(false);
    expect(existsSync(join(root, 'xbrowser-404'))).toBe(false);
    expect(existsSync(join(root, 'xbrowser-marketplace-1795736816594'))).toBe(true);
    expect(existsSync(join(root, 'xbrowser-cover-1795736816594.html'))).toBe(true);
    expect(existsSync(join(root, 'unrelated-dir'))).toBe(true);
  });

  it('returns 0 when the temp root cannot be read', () => {
    expect(sweepStaleTmpStorageDirs({ root: join(tempRoot(), 'does-not-exist'), isAlive: () => false })).toBe(0);
  });
});

describe('registerTmpStorageCleanup', () => {
  it('removes the own-pid directory when the exit handler runs, and registers only once', () => {
    const before = process.listenerCount('exit');
    const cleanup = registerTmpStorageCleanup();
    expect(process.listenerCount('exit')).toBe(before + 1);
    registerTmpStorageCleanup();
    expect(process.listenerCount('exit')).toBe(before + 1);

    mkdirSync(join(ownTmpStorageDir(), 'some-plugin'), { recursive: true });
    cleanup();
    expect(existsSync(ownTmpStorageDir())).toBe(false);
    // 幂等：目录不存在时也不抛
    expect(() => cleanup()).not.toThrow();
  });
});

describe('sweepStaleTmpStorageDirsAsync', () => {
  it('removes the same dead-pid dirs in chunks and yields to the event loop between chunks', async () => {
    const root = tempRoot();
    for (let pid = 900; pid < 907; pid++) mkdirSync(join(root, `xbrowser-${pid}`), { recursive: true });
    mkdirSync(join(root, 'xbrowser-999'), { recursive: true });
    const logs: string[] = [];
    const removed = await sweepStaleTmpStorageDirsAsync({
      root,
      ownPid: 999,
      isAlive: () => false,
      chunkSize: 3,
      log: (message) => logs.push(message),
    });

    expect(removed).toBe(7);
    expect(logs).toEqual(['Swept 7 stale xbrowser-<pid> tmp storage dir(s)']);
    expect(existsSync(join(root, 'xbrowser-999'))).toBe(true);
    expect(existsSync(join(root, 'xbrowser-903'))).toBe(false);
  });

  it('does not log when there is nothing to remove', async () => {
    const logs: string[] = [];
    const removed = await sweepStaleTmpStorageDirsAsync({ root: tempRoot(), isAlive: () => true, log: (m) => logs.push(m) });
    expect(removed).toBe(0);
    expect(logs).toEqual([]);
  });
});
