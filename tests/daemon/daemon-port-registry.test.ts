import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test gets its own HOME, so the registry files below are real files in a temp dir.
let home = '';
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => home };
});

// The worker is replaced by a fake that does the one thing daemon-main does at start:
// write its own daemon.json a moment after being spawned.
vi.mock('child_process', () => ({ spawn: vi.fn() }));

const signals: Array<{ pid: number; signal: string | number }> = [];

function recordFile(port: number): string {
  const base = join(home, '.xbrowser');
  return port === 9224 ? join(base, 'daemon.json') : join(base, 'daemons', String(port), 'daemon.json');
}

/** Register a daemon on `port` as running, the way daemon-main does when it starts. */
function writeRecord(port: number, pid: number): void {
  mkdirSync(join(recordFile(port), '..'), { recursive: true });
  writeFileSync(recordFile(port), JSON.stringify({ port, pid, startedAt: Date.now() }));
}

function readRecord(port: number): { port: number; pid: number } | null {
  const file = recordFile(port);
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, 'utf8')) as { port: number; pid: number };
  return { port: record.port, pid: record.pid };
}

describe('daemon registry is per port', () => {
  let spawn: ReturnType<typeof vi.fn>;
  let savedPort: string | undefined;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'xb-daemon-registry-'));
    signals.length = 0;
    savedPort = process.env.XBROWSER_DAEMON_PORT;
    delete process.env.XBROWSER_DAEMON_PORT;
    // pid 0 probes pass through; anything sent to a daemon is recorded.
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (signal) signals.push({ pid, signal });
      return true;
    }) as typeof process.kill);
    spawn = (await import('child_process')).spawn as unknown as ReturnType<typeof vi.fn>;
    spawn.mockReset();
    spawn.mockImplementation(((...args: unknown[]) => {
      const env = (args[2] as { env?: Record<string, string> }).env ?? {};
      const port = Number(env.XBROWSER_DAEMON_PORT);
      setTimeout(() => writeRecord(port, 54321), 30);
      return { unref: vi.fn(), pid: 54321, on: vi.fn() };
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedPort === undefined) delete process.env.XBROWSER_DAEMON_PORT;
    else process.env.XBROWSER_DAEMON_PORT = savedPort;
    rmSync(home, { recursive: true, force: true });
  });

  it('starting on a private port leaves the daemon on the default port alone', async () => {
    writeRecord(9224, 4242);
    const daemon = await import('../../src/daemon/daemon.js');

    const starting = daemon.startDaemonProcess(9386);
    starting.catch(() => undefined); // the assertion below is the point of this test
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(signals).toEqual([]);

    const info = await starting;

    expect(info).toMatchObject({ pid: 54321, port: 9386 });
    expect(readRecord(9224)).toEqual({ port: 9224, pid: 4242 });
  }, 20000);

  it('starting on the default port leaves a daemon on a private port alone', async () => {
    writeRecord(9386, 4386);
    const daemon = await import('../../src/daemon/daemon.js');

    const info = await daemon.startDaemonProcess(9224);

    expect(info).toMatchObject({ pid: 54321, port: 9224 });
    expect(signals).toEqual([]);
    expect(readRecord(9386)).toEqual({ port: 9386, pid: 4386 });
  });

  it('reuses the daemon already running on the same port', async () => {
    writeRecord(9386, 4386);
    const daemon = await import('../../src/daemon/daemon.js');

    const info = await daemon.startDaemonProcess(9386);

    expect(info).toMatchObject({ pid: 4386, port: 9386 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('follows XBROWSER_DAEMON_PORT for status and stop by default', async () => {
    writeRecord(9224, 4242);
    writeRecord(9386, 4386);
    process.env.XBROWSER_DAEMON_PORT = '9386';
    const daemon = await import('../../src/daemon/daemon.js');

    expect(daemon.getDaemonConfig()).toMatchObject({
      configDir: join(home, '.xbrowser', 'daemons', '9386'),
      basePort: 9386,
    });
    expect(daemon.getDaemonProcessStatus()).toMatchObject({ running: true, pid: 4386, port: 9386 });

    await daemon.stopDaemonProcess();

    expect(signals).toEqual([{ pid: 4386, signal: 'SIGTERM' }]);
    expect(readRecord(9224)).toEqual({ port: 9224, pid: 4242 });
  });

  it('keeps the default port in ~/.xbrowser', async () => {
    const registry = await import('../../src/daemon/registry.js');

    expect(registry.daemonConfigDir(9224, '/home/u')).toBe('/home/u/.xbrowser');
    expect(registry.daemonConfigDir(9386, '/home/u')).toBe('/home/u/.xbrowser/daemons/9386');
  });

  it('reads the daemon port from the environment, falling back to the default', async () => {
    const registry = await import('../../src/daemon/registry.js');

    expect(registry.currentDaemonPort()).toBe(9224);
    process.env.XBROWSER_DAEMON_PORT = '9386';
    expect(registry.currentDaemonPort()).toBe(9386);
    process.env.XBROWSER_DAEMON_PORT = 'not-a-port';
    expect(registry.currentDaemonPort()).toBe(9224);
  });
});
