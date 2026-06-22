import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardNetworkList, forwardNetworkClear } from '../../src/client/daemon-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: vi.fn().mockRejectedValue(new Error('no daemon in test')),
  getDaemonConfig: vi.fn(),
  stopDaemonProcess: vi.fn(),
  killAllDaemonProcesses: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
}));

describe('forwardNetworkList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ captures: [] }),
      });
    });
  });

  it('should POST to /rpc with method network:list and session name', async () => {
    await forwardNetworkList('my-session');

    const rpcCall = mockFetch.mock.calls.find((c: unknown[]) => (c as [string])[0].includes('/rpc'));
    expect(rpcCall).toBeDefined();
    expect(rpcCall![0]).toBe('http://localhost:9224/rpc');
    expect(rpcCall![1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    const body = JSON.parse(rpcCall![1].body as string);
    expect(body).toEqual({
      method: 'network:list',
      params: { session: 'my-session' },
    });
  });

  it('should include filter/method/limit options when provided', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ captures: [] }),
      });
    });

    await forwardNetworkList('s1', { filter: 'google', method: 'GET', limit: 50 });

    const rpcCall = mockFetch.mock.calls.find((c: unknown[]) => (c as [string])[0].includes('/rpc'));
    const body = JSON.parse(rpcCall![1].body as string);
    expect(body.params).toEqual({
      session: 's1',
      filter: 'google',
      method: 'GET',
      limit: 50,
    });
  });

  it('should return parsed JSON response directly', async () => {
    const responseData = { captures: [{ id: 1, url: 'https://example.com' }] };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: true, json: async () => responseData });
    });

    const result = await forwardNetworkList('s1');
    expect(result).toEqual(responseData);
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: false,
        statusText: 'Internal Server Error',
      });
    });

    await expect(forwardNetworkList('s1')).rejects.toThrow('Daemon error: Internal Server Error');
  });

  it('should surface the specific error from body, not the generic statusText', async () => {
    // daemon (xcli-core) 在 500 时把真实错误放在 body 的 { error } 字段里。
    // rpcCall 必须读 body 而非 statusText，否则用户只看到 "Internal Server Error"。
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: false,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Chrome/Chromium not found' }),
      });
    });

    await expect(forwardNetworkList('s1')).rejects.toThrow('Chrome/Chromium not found');
  });

  it('should handle empty captures list', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ captures: [] }) });
    });

    const result = (await forwardNetworkList('s1')) as { captures: unknown[] };
    expect(result.captures).toEqual([]);
  });

  it('should handle captures with full data', async () => {
    const fullCaptures = {
      captures: [
        {
          id: 'c1',
          url: 'https://api.example.com/users',
          method: 'GET',
          status: 200,
          contentType: 'application/json',
          requestHeaders: { accept: '*/*' },
          responseHeaders: { 'content-type': 'application/json' },
          requestBody: null,
          responseBody: '{"users":[]}',
          timing: { startTime: 1000, endTime: 1500 },
        },
        {
          id: 'c2',
          url: 'https://api.example.com/login',
          method: 'POST',
          status: 401,
          contentType: 'application/json',
          requestHeaders: { 'content-type': 'application/json' },
          responseHeaders: { 'content-type': 'application/json' },
          requestBody: '{"user":"admin"}',
          responseBody: '{"error":"unauthorized"}',
          timing: { startTime: 2000, endTime: 2200 },
        },
      ],
    };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({ ok: true, json: async () => fullCaptures });
    });

    const result = (await forwardNetworkList('s1', { filter: 'api' })) as { captures: unknown[] };
    expect(result.captures).toHaveLength(2);
    expect(result.captures[0]).toHaveProperty('url', 'https://api.example.com/users');
    expect(result.captures[1]).toHaveProperty('status', 401);
  });
});

describe('forwardNetworkClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ cleared: 5 }),
      });
    });
  });

  it('should POST to /rpc with method network:clear and session name', async () => {
    await forwardNetworkClear('my-session');

    const rpcCall = mockFetch.mock.calls.find((c: unknown[]) => (c as [string])[0].includes('/rpc'));
    expect(rpcCall).toBeDefined();
    expect(rpcCall![0]).toBe('http://localhost:9224/rpc');
    expect(rpcCall![1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    const body = JSON.parse(rpcCall![1].body as string);
    expect(body).toEqual({
      method: 'network:clear',
      params: { session: 'my-session' },
    });
  });

  it('should return parsed JSON response directly', async () => {
    const responseData = { cleared: 3 };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responseData),
      });
    });

    const result = await forwardNetworkClear('s1');
    expect(result).toEqual({ cleared: 3 });
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
      }
      return Promise.resolve({
        ok: false,
        statusText: 'Bad Gateway',
      });
    });

    await expect(forwardNetworkClear('s1')).rejects.toThrow('Daemon error: Bad Gateway');
  });
});
