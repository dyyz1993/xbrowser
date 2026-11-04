import { describe, it, expect, vi, beforeEach } from 'vitest';

let injectedError: Error = new Error('connect ECONNREFUSED 127.0.0.1:9222');
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// rpcCall 走原生 http —— mock request 让 req.on('error') 收到注入的传输层错误
vi.mock('node:http', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:http')>();
  return {
    ...orig,
    request: vi.fn(() => {
      const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
      const req = {
        setTimeout: vi.fn(),
        on: (ev: string, cb: (arg?: unknown) => void) => {
          (handlers[ev] ??= []).push(cb);
        },
        end: vi.fn(() => {
          for (const cb of handlers['error'] ?? []) cb(injectedError);
        }),
      };
      return req as unknown as import('node:http').ClientRequest;
    }),
  };
});

vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: vi.fn(),
  stopDaemonProcess: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
  killAllDaemonProcesses: vi.fn(),
}));

async function importFresh(): Promise<typeof import('../../src/client/daemon-client.js')> {
  vi.resetModules();
  return await import('../../src/client/daemon-client.js');
}

describe('forward* friendly daemon errors (#441)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    injectedError = new Error('connect ECONNREFUSED 127.0.0.1:9222');
    // ensureDaemonRunning: daemon 健康且版本一致，不触发重启
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it('forwardExec wraps ECONNREFUSED in an actionable message', async () => {
    const { forwardExec } = await importFresh();

    const result = await forwardExec('title', {}, 'default');

    expect(result.success).toBe(false);
    expect(result.duration).toBe(0);
    expect(result.message).toContain('Daemon 或浏览器不可达');
    expect(result.message).toContain('ECONNREFUSED');
    expect(result.message).toContain('--cdp');
  });

  it('forwardPluginExec wraps ECONNREFUSED in an actionable message', async () => {
    const { forwardPluginExec } = await importFresh();

    const result = await forwardPluginExec('gemini.chat', { message: 'hi' }, 'default');

    expect(result.success).toBe(false);
    expect(result.duration).toBe(0);
    expect(result.message).toContain('Daemon 或浏览器不可达');
    expect(result.message).toContain('ECONNREFUSED');
    expect(result.message).toContain('--cdp');
  });

  it('forwardChain surfaces the friendly message via stoppedReason', async () => {
    const { forwardChain } = await importFresh();

    const result = await forwardChain('goto https://example.com && title') as {
      success: boolean;
      steps: unknown[];
      totalDuration: number;
      stoppedReason: string;
    };

    expect(result.success).toBe(false);
    expect(result.steps).toEqual([]);
    expect(result.totalDuration).toBe(0);
    expect(result.stoppedReason).toContain('Daemon 或浏览器不可达');
    expect(result.stoppedReason).toContain('ECONNREFUSED');
    expect(result.stoppedReason).toContain('--cdp');
  });

  it('maps ETIMEDOUT to a network-unreachable hint', async () => {
    injectedError = new Error('connect ETIMEDOUT 127.0.0.1:9222');
    const { forwardExec } = await importFresh();

    const result = await forwardExec('title', {}, 'default');

    expect(result.success).toBe(false);
    expect(result.message).toContain('网络不可达');
    expect(result.message).toContain('ETIMEDOUT');
    expect(result.message).toContain('防火墙');
  });

  it('passes non-transport errors through unchanged', async () => {
    injectedError = new Error('RPC exec timeout after 1000ms');
    const { forwardExec } = await importFresh();

    const result = await forwardExec('title', {}, 'default', undefined, 1000);

    expect(result.success).toBe(false);
    expect(result.message).toBe('RPC exec timeout after 1000ms');
  });
});
