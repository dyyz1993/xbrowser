import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonConfig } from '../../src/daemon/daemon.js';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    unref: vi.fn(),
    pid: 12345,
  }),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

describe('DaemonManager', () => {
  let DaemonManager: typeof import('../../src/daemon/daemon.js').DaemonManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../src/daemon/daemon.js');
    DaemonManager = mod.DaemonManager;
  });

  describe('status', () => {
    it('should return null when no config file', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      expect(daemon.status()).toBeNull();
    });

    it('should return null and clear config when process not running', async () => {
      const { existsSync, readFileSync, unlinkSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        pid: 9999999,
        port: 9222,
        startedAt: '2025-01-01',
      }));
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });

      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      const result = daemon.status();
      expect(result).toBeNull();
      expect(unlinkSync).toHaveBeenCalled();

      process.kill = originalKill;
    });

    it('should return config when process is running', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const config: DaemonConfig = {
        pid: 12345,
        port: 9222,
        startedAt: '2025-01-01T00:00:00Z',
      };
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(config));
      const originalKill = process.kill;
      process.kill = vi.fn();

      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      const result = daemon.status();
      expect(result).toEqual(config);

      process.kill = originalKill;
    });
  });

  describe('start', () => {
    it('should throw when daemon already running', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        pid: 12345,
        port: 9222,
        startedAt: '2025-01-01',
      }));
      const originalKill = process.kill;
      process.kill = vi.fn();

      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      await expect(daemon.start()).rejects.toThrow('Daemon already running');

      process.kill = originalKill;
    });

    it('should spawn process and write config', async () => {
      const { existsSync, writeFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const { spawn } = await import('child_process');
      const mockProcess = {
        unref: vi.fn(),
        pid: 54321,
      };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProcess);

      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      const config = await daemon.start(8080);
      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['/tmp/test-worker.js', 'daemon', 'worker', '--port', '8080'],
        expect.objectContaining({ detached: true, stdio: 'ignore' })
      );
      expect(config.pid).toBe(54321);
      expect(config.port).toBe(8080);
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('should default to port 9222', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const { spawn } = await import('child_process');
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue({ unref: vi.fn(), pid: 11111 });

      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      const config = await daemon.start();
      expect(config.port).toBe(9222);
    });
  });

  describe('stop', () => {
    it('should throw when daemon not running', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      await expect(daemon.stop()).rejects.toThrow('Daemon is not running');
    });

    it('should kill process and clear config', async () => {
      const { existsSync, readFileSync, unlinkSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        pid: 12345,
        port: 9222,
        startedAt: '2025-01-01',
      }));
      const originalKill = process.kill;
      process.kill = vi.fn();

      const daemon = new DaemonManager({
        configDir: '/tmp/xbrowser-test',
        workerScript: '/tmp/test-worker.js',
      });
      await daemon.stop();
      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(unlinkSync).toHaveBeenCalled();

      process.kill = originalKill;
    });
  });
});
