import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// R104 后 rpcCall 走原生 http —— 桥接 mock（防 CI 上真实连 9224）
vi.mock('node:http', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:http')>();
  return {
    ...orig,
    request: vi.fn((...args: unknown[]) => {
      const cb = args[args.length - 1] as (res: unknown) => void;
      const req = { setTimeout: vi.fn(), on: vi.fn(), end: vi.fn() } as unknown as NodeJS.ReadableStream;
      const res = {
        statusCode: 200,
        on: (ev: string, fn: (d?: Buffer) => void) => {
          if (ev === 'data') setTimeout(() => fn(Buffer.from('{"success":true}')), 1);
          if (ev === 'end') setTimeout(() => fn(), 5);
        },
      };
      if (typeof cb === 'function') setTimeout(() => cb(res), 0);
      return req;
    }),
  };
});

const mockStartDaemon = vi.fn().mockResolvedValue({ pid: 99999, port: 9224 });

vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: mockStartDaemon,
  getDaemonConfig: vi.fn(),
  stopDaemonProcess: vi.fn(),
  killAllDaemonProcesses: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
}));

describe('ensureDaemonRunning — CLI hang prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function importFresh() {
    vi.resetModules();
    const mod = await import('../../src/client/daemon-client.js');
    return mod;
  }

  it('should retry health check before starting daemon', async () => {
    let callCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        callCount++;
        if (callCount <= 2) return Promise.reject(new Error('timeout'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    });

    const { forwardSessionList } = await importFresh();
    const result = await forwardSessionList();

    expect(callCount).toBeGreaterThanOrEqual(3);
    expect(mockStartDaemon).not.toHaveBeenCalled();
  });

  it('should NOT call startDaemonProcess when daemon is healthy', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const { forwardSessionList } = await importFresh();
    await forwardSessionList();

    expect(mockStartDaemon).not.toHaveBeenCalled();
  });

  it('should call startDaemonProcess only when health check fails all retries', async () => {
    let daemonStarted = false;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        if (daemonStarted) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    mockStartDaemon.mockImplementation(() => {
      daemonStarted = true;
      return Promise.resolve({ pid: 12345, port: 9224 });
    });

    const { forwardSessionList } = await importFresh();
    await forwardSessionList();

    expect(mockStartDaemon).toHaveBeenCalledTimes(1);
  });

  it('should not kill a running daemon on transient health check timeout', async () => {
    let healthCallCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        healthCallCount++;
        if (healthCallCount === 1) return Promise.reject(new Error('timeout'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const { forwardSessionList } = await importFresh();
    await forwardSessionList();

    expect(healthCallCount).toBeGreaterThanOrEqual(2);
    expect(mockStartDaemon).not.toHaveBeenCalled();
  });
});
