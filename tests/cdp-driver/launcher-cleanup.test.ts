import { spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { killChrome, launchChrome } from '../../src/cdp-driver/launcher.js';

const CHROME_CANDIDATES = [
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

function findTestChrome(): string | null {
  return CHROME_CANDIDATES.find(candidate => existsSync(candidate)) ?? null;
}

function findProfileProcesses(profileDir: string): Array<{ pid: string; command: string }> {
  const { stdout } = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return stdout.split('\n')
    .filter(line => line.includes(profileDir))
    .map(line => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) throw new Error(`Unable to parse ps line: ${line}`);
      return { pid: match[1], command: match[2] };
    });
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('cleans the browser and profile when CDP startup times out', async () => {
  const executablePath = findTestChrome();
  if (!executablePath) {
    console.warn('Skipping: no Chromium/Chrome binary is available');
    return;
  }

  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('CDP discovery disabled for timeout test'));

  let ownPids: string[] = [];
  let profileDir: string | undefined;
  try {
    const launchPromise = launchChrome({
      executablePath,
      headless: true,
      timeout: 400,
    });

    for (let attempt = 0; attempt < 100 && !profileDir; attempt++) {
      const profileName = fs.readdirSync('/tmp').find(name =>
        name.startsWith(`xbrowser-chrome-${process.pid}-`));
      if (profileName) profileDir = `/tmp/${profileName}`;
      else await new Promise(resolve => setTimeout(resolve, 10));
    }

    await expect(launchPromise).rejects.toThrow(/Chrome CDP not ready after 400ms/);

    ownPids = findProfileProcesses(profileDir!).map(process => process.pid);
    expect(ownPids).toEqual([]);
    expect(existsSync(profileDir!)).toBe(false);
  } finally {
    fetchSpy.mockRestore();
    globalThis.fetch = originalFetch;

    for (const pid of ownPids) {
      const ownedProcess = findProfileProcesses(profileDir!)
        .find(candidate => candidate.pid === pid);
      if (ownedProcess?.command.includes(profileDir!)) {
        process.kill(Number(pid), 'SIGKILL');
      }
    }

    if (profileDir && existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  }
}, 15_000);

it('removes the temp profile when the browser has already exited', async () => {
  const profileDir = fs.mkdtempSync('/tmp/xbrowser-chrome-test-');
  const child = {
    exitCode: 0,
    killed: false,
    kill: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;

  await killChrome(child, profileDir);

  expect(existsSync(profileDir)).toBe(false);
});
