import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    unref: vi.fn(),
    pid: 54321,
    on: vi.fn(),
  }),
}));

const mockXcliCore = {
  getDaemonStatus: vi.fn(),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@dyyz1993/xcli-core', () => mockXcliCore);

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
      mockXcliCore.getDaemonStatus.mockReturnValue({ running: false, port: 0, pid: 0 });

      const { getDaemonProcessStatus } = await import('../../src/daemon/daemon.js');
      const result = getDaemonProcessStatus();
      expect(result.running).toBe(false);
      expect(result.pid).toBe(0);
      expect(result.port).toBe(0);
      expect(result.info).toBeNull();
    });

    it('should return running status', async () => {
      mockXcliCore.getDaemonStatus.mockReturnValue({ running: true, port: 9224, pid: 12345 });

      const { getDaemonProcessStatus } = await import('../../src/daemon/daemon.js');
      const result = getDaemonProcessStatus();
      expect(result.running).toBe(true);
      expect(result.pid).toBe(12345);
      expect(result.port).toBe(9224);
      expect(result.info).not.toBeNull();
      expect(result.info!.pid).toBe(12345);
    });
  });

  describe('startDaemonProcess', () => {
    it('should return existing daemon info when already running', async () => {
      mockXcliCore.getDaemonStatus.mockReturnValue({ running: true, port: 9224, pid: 54321 });

      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      const result = await startDaemonProcess(9224);

      expect(result.pid).toBe(54321);
      expect(result.port).toBe(9224);
    });

    it('should spawn worker process and wait for config', async () => {
      vi.useFakeTimers();
      // First call: not running yet
      // Second call: running
      mockXcliCore.getDaemonStatus
        .mockReturnValueOnce({ running: false, port: 0, pid: 0 })
        .mockReturnValueOnce({ running: true, port: 9224, pid: 54321 });

      const { spawn } = await import('child_process');
      const mockProcess = { unref: vi.fn(), pid: 54321, on: vi.fn() };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProcess);

      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      const promise = startDaemonProcess(9224);
      vi.advanceTimersByTime(500);
      const config = await promise;

      expect(config.pid).toBe(54321);
      expect(config.port).toBe(9224);
      vi.useRealTimers();
    });

    it('should reject on spawn error', async () => {
      vi.useRealTimers();
      mockXcliCore.getDaemonStatus.mockReturnValue({ running: false, port: 0, pid: 0 });
      const { spawn } = await import('child_process');
      let errorHandler: ((err: Error) => void) | null = null;
      const mockProcess = {
        unref: vi.fn(),
        pid: 54321,
        on: vi.fn((_event: string, handler: (err: Error) => void) => {
          errorHandler = handler;
        }),
      };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProcess);

      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      const promise = startDaemonProcess(9224);

      // Simulate spawn error
      if (errorHandler) {
        setImmediate(() => errorHandler(new Error('spawn failed')));
      }
      await expect(promise).rejects.toThrow('spawn failed');
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
