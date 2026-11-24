import { describe, it, expect, vi, beforeEach } from 'vitest';

const stopDaemonProcess = vi.fn().mockResolvedValue(undefined);
const startDaemonProcess = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/daemon/daemon.js', () => ({
  stopDaemonProcess: (...args: unknown[]) => stopDaemonProcess(...args),
  startDaemonProcess: (...args: unknown[]) => startDaemonProcess(...args),
}));

vi.mock('../../src/version.js', () => ({ version: '1.35.0', buildId: 'cli-build' }));

import { checkDaemonHealth, forwardSessionList } from '../../src/client/daemon-client.js';

const cli = { version: '1.35.0', buildId: 'cli-build' };

describe('checkDaemonHealth', () => {
  it('refuses to restart a differently-built daemon that is serving sessions', () => {
    const check = checkDaemonHealth(
      { status: 'ok', version: '1.35.0', buildId: 'other-build', activeSessions: 2 },
      cli,
      false,
    );
    expect(check.action).toBe('refuse');
    expect(check.reason).toMatch(/2 active session/);
    expect(check.reason).toMatch(/XBROWSER_DAEMON_PORT=/);
    expect(check.reason).toMatch(/XBROWSER_DAEMON_SKIP_BUILD_CHECK=1/);
  });

  it('restarts a differently-built daemon that has no sessions', () => {
    const check = checkDaemonHealth(
      { status: 'ok', version: '1.35.0', buildId: 'other-build', activeSessions: 0 },
      cli,
      false,
    );
    expect(check.action).toBe('restart');
  });

  it('falls back to a session count learned through the RPC when /health predates the field', () => {
    const health = { status: 'ok', version: '1.35.0', buildId: 'other-build' };
    expect(checkDaemonHealth(health, cli, false, 1).action).toBe('refuse');
    expect(checkDaemonHealth(health, cli, false, 0).action).toBe('restart');
    expect(checkDaemonHealth(health, cli, false, null).action).toBe('restart');
    expect(checkDaemonHealth(health, cli, false).action).toBe('restart');
  });

  it('restarts a differently-built daemon that does not report its sessions (older daemon)', () => {
    const check = checkDaemonHealth({ status: 'ok', version: '1.35.0', buildId: 'other-build' }, cli, false);
    expect(check.action).toBe('restart');
  });

  it('still restarts on a version mismatch even when sessions are open', () => {
    const check = checkDaemonHealth(
      { status: 'ok', version: '1.34.0', buildId: 'cli-build', activeSessions: 2 },
      cli,
      false,
    );
    expect(check.action).toBe('restart');
    expect(check.reason).toMatch(/version/);
  });

  it('uses a daemon from the same build', () => {
    expect(checkDaemonHealth({ status: 'ok', version: '1.35.0', buildId: 'cli-build', activeSessions: 3 }, cli, false).action).toBe('use');
  });

  it('skips the build check when asked to', () => {
    expect(checkDaemonHealth({ status: 'ok', version: '1.35.0', buildId: 'other-build', activeSessions: 3 }, cli, true).action).toBe('use');
  });

  it('does not compare dev builds', () => {
    expect(checkDaemonHealth({ status: 'ok', version: '1.35.0', buildId: 'dev', activeSessions: 3 }, cli, false).action).toBe('use');
  });
});

describe('ensureDaemonRunning', () => {
  beforeEach(() => {
    stopDaemonProcess.mockClear();
    startDaemonProcess.mockClear();
  });

  function stubDaemon(health: Record<string, unknown>, sessions: unknown[]): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const body = String(url).endsWith('/rpc') ? sessions : health;
        return Promise.resolve({ ok: true, json: async () => body });
      }),
    );
  }

  it('does not stop a busy daemon on a build mismatch and explains the way out', async () => {
    stubDaemon({ status: 'ok', version: '1.35.0', buildId: 'other-build', activeSessions: 1 }, []);
    try {
      await expect(forwardSessionList()).rejects.toThrow(/Refusing to restart/);
      expect(stopDaemonProcess).not.toHaveBeenCalled();
      expect(startDaemonProcess).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks an older daemon for its sessions before restarting it', async () => {
    // /health without activeSessions, as served by daemons that predate the field.
    stubDaemon({ status: 'ok', version: '1.35.0', buildId: 'other-build' }, [{ id: '1', name: 'busy' }]);
    try {
      await expect(forwardSessionList()).rejects.toThrow(/Refusing to restart/);
      expect(stopDaemonProcess).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restarts an older daemon that reports no sessions', async () => {
    stubDaemon({ status: 'ok', version: '1.35.0', buildId: 'other-build' }, []);
    try {
      await forwardSessionList().catch(() => undefined);
      expect(stopDaemonProcess).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
