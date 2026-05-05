import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(null),
          url: vi.fn().mockReturnValue('about:blank'),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BrowserWorker', () => {
    it('should construct with default context', async () => {
      const { BrowserWorker } = await import('../src/worker.js');
      const worker = new BrowserWorker();
      expect(worker).toBeDefined();
      expect(typeof worker.init).toBe('function');
      expect(typeof worker.execute).toBe('function');
      expect(typeof worker.destroy).toBe('function');
    });

    it('should construct with custom context', async () => {
      const { BrowserWorker } = await import('../src/worker.js');
      const worker = new BrowserWorker({
        chromiumPath: '/usr/bin/chromium',
        cdpEndpoint: 'http://localhost:9222',
      });
      expect(worker).toBeDefined();
    });
  });

  describe('routeWorkerCommand', () => {
    it('should throw on unknown method', async () => {
      const { routeWorkerCommand } = await import('../src/worker.js');
      await expect(
        routeWorkerCommand('unknown.method', {})
      ).rejects.toThrow('Unknown method: unknown.method');
    });

    it('should list sessions when empty', async () => {
      const { routeWorkerCommand, BrowserWorker } = await import('../src/worker.js');
      const worker = new BrowserWorker();
      await worker.init();
      const result = await routeWorkerCommand('session.list', {});
      expect(result).toEqual({ sessions: [] });
      await worker.destroy();
    });
  });

  describe('BrowserWorker lifecycle', () => {
    it('should init, execute session.list, and destroy', async () => {
      const { BrowserWorker } = await import('../src/worker.js');
      const worker = new BrowserWorker();
      await worker.init();
      const result = await worker.execute('session.list', {});
      expect(result).toEqual({ sessions: [] });
      await worker.destroy();
    });

    it('should handle destroy without init', async () => {
      const { BrowserWorker } = await import('../src/worker.js');
      const worker = new BrowserWorker();
      await expect(worker.destroy()).resolves.toBeUndefined();
    });
  });
});
