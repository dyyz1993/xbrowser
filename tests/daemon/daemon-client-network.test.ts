import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardNetworkList, forwardNetworkClear } from '../../src/client/daemon-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('forwardNetworkList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should POST to /rpc with method network:list and session name', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ captures: [] }),
    });

    await forwardNetworkList('my-session');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9224/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0] as unknown[])[1]!.body as string);
    expect(body).toEqual({
      method: 'network:list',
      params: { session: 'my-session' },
    });
  });

  it('should include filter/method/limit options when provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ captures: [] }),
    });

    await forwardNetworkList('s1', { filter: 'google', method: 'GET', limit: 50 });

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown[])[1]!.body as string);
    expect(body.params).toEqual({
      session: 's1',
      filter: 'google',
      method: 'GET',
      limit: 50,
    });
  });

  it('should return parsed JSON response directly', async () => {
    const responseData = { captures: [{ id: 1, url: 'https://example.com' }] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responseData,
    });

    const result = await forwardNetworkList('s1');
    expect(result).toEqual(responseData);
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
    });

    await expect(forwardNetworkList('s1')).rejects.toThrow('Daemon error: Internal Server Error');
  });

  it('should handle empty captures list', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ captures: [] }),
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
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => fullCaptures,
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
  });

  it('should POST to /rpc with method network:clear and session name', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ cleared: 5 }),
    });

    await forwardNetworkClear('my-session');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9224/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0] as unknown[])[1]!.body as string);
    expect(body).toEqual({
      method: 'network:clear',
      params: { session: 'my-session' },
    });
  });

  it('should return parsed JSON response directly', async () => {
    const responseData = { cleared: 3 };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responseData,
    });

    const result = await forwardNetworkClear('s1');
    expect(result).toEqual({ cleared: 3 });
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Bad Gateway',
    });

    await expect(forwardNetworkClear('s1')).rejects.toThrow('Daemon error: Bad Gateway');
  });
});
