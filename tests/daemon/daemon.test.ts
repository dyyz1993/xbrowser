import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    unref: vi.fn(),
    pid: 54321,
    on: vi.fn(),
  }),
}));

const mockXcliCore = {
  isDaemonRunning: vi.fn(),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@dyyz1993/xcli-core', () => mockXcliCore);

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

vi.mock('url', () => ({
  fileURLToPath: vi.fn().mockReturnValue('/home/test/project/dist/daemon/daemon.js'),
}));

describe('Daemon API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDaemonProcessStatus', () => {
    it('should return not running when no config', async () => {
      mockXcliCore.isDaemonRunning.mockReturnValue(false);
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const { getDaemonProcessStatus } = await import('../../src/daemon/daemon.js');
      const result = getDaemonProcessStatus();
      expect(result.running).toBe(false);
    });

    it('should return running status', async () => {
      mockXcliCore.isDaemonRunning.mockReturnValue(true);
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        pid: 12345,
        port: 9224,
        startedAt: Date.now(),
      }));

      const { getDaemonProcessStatus } = await import('../../src/daemon/daemon.js');
      const result = getDaemonProcessStatus();
      expect(result.running).toBe(true);
      expect(result.pid).toBe(12345);
      expect(result.port).toBe(9224);
    });
  });

  describe('startDaemonProcess', () => {
    it('should spawn worker process and wait for config', async () => {
      vi.useFakeTimers();
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({
        pid: 54321,
        port: 9224,
        startedAt: Date.now(),
      }));
      const { spawn } = await import('child_process');
      const mockProcess = { unref: vi.fn(), pid: 54321, on: vi.fn() };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProcess);

      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      const promise = startDaemonProcess('auto', 9224);
      vi.advanceTimersByTime(500);
      const config = await promise;

      expect(config.pid).toBe(54321);
      expect(config.port).toBe(9224);
      vi.useRealTimers();
    });

    it('should reject on spawn error', async () => {
      vi.useRealTimers();
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const { spawn } = await import('child_process');
      const mockProcess = {
        unref: vi.fn(),
        pid: 54321,
        on: vi.fn((_event: string, handler: (err: Error) => void) => {
          setImmediate(() => handler(new Error('spawn failed')));
        }),
      };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProcess);

      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      await expect(startDaemonProcess('auto', 9224)).rejects.toThrow('spawn failed');
    });
  });

  describe('stopDaemonProcess', () => {
    it('should delegate to xcli-core stopDaemon', async () => {
      const { stopDaemonProcess } = await import('../../src/daemon/daemon.js');
      await stopDaemonProcess();
      expect(mockXcliCore.stopDaemon).toHaveBeenCalled();
    });
  });
});
