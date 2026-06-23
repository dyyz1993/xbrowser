import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    unref: vi.fn(),
    pid: 54321,
    on: vi.fn(),
  }),
}));

const mockXcliCore = {
  isDaemonRunning: vi.fn(),
  getDaemonStatus: vi.fn(),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
  killAllDaemon: vi.fn().mockResolvedValue(undefined),
  registerCommandDefinition: vi.fn(),
  outputFormatter: vi.fn(),
  isCommandResult: vi.fn(),
  helpGenerator: vi.fn(() => ({ generate: vi.fn() })),
};

vi.mock('@dyyz1993/xcli-core', () => mockXcliCore);

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

// Mock fs to prevent real lock file creation in tests
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn((file: string, data: string, opts?: unknown) => {
      // For lock files (flag: 'wx'), always succeed (no lock contention in tests)
      if (typeof opts === 'object' && opts !== null && 'flag' in opts) return;
      return actual.writeFileSync(file, data, opts as Record<string, unknown> | undefined);
    }),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

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

      const { getDaemonProcessStatus } = await import('../../src/daemon/daemon.js');
      const result = getDaemonProcessStatus();
      expect(result.running).toBe(false);
      expect(result.pid).toBe(0);
      expect(result.port).toBe(0);
      expect(result.info).toBeNull();
    });

    it('should return running status', async () => {
      mockXcliCore.isDaemonRunning.mockReturnValue(true);
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
      mockXcliCore.isDaemonRunning.mockReturnValue(true);
      mockXcliCore.getDaemonStatus.mockReturnValue({ running: true, port: 9224, pid: 54321 });

      const { startDaemonProcess } = await import('../../src/daemon/daemon.js');
      const result = await startDaemonProcess(9224);

      expect(result.pid).toBe(54321);
      expect(result.port).toBe(9224);
    });

    it('should spawn worker process and wait for config', async () => {
      vi.useFakeTimers();
      // First call: not running, then running on polling
      mockXcliCore.isDaemonRunning
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      mockXcliCore.getDaemonStatus
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
      mockXcliCore.isDaemonRunning.mockReturnValue(false);
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
