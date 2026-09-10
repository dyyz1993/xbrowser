/**
 * shared/api-fetch helper tests: timeout+status gates that bare
 * fetch().then(r => r.json()) call sites lacked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJson } from '../../.xcli/plugins/shared/api-fetch.js';

const originalFetch = globalThis.fetch;

describe('shared api-fetch fetchJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed JSON on 2xx and passes headers + signal', async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ hello: 'world' }),
    }));
    globalThis.fetch = mock as unknown as typeof fetch;

    const data = await fetchJson('https://api.example.com/v1', { headers: { 'User-Agent': 'x' } });
    expect(data).toEqual({ hello: 'world' });
    const [calledUrl, calledInit] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe('https://api.example.com/v1');
    expect(calledInit.headers).toEqual({ 'User-Agent': 'x' });
    expect(calledInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws HTTP status error on non-2xx by default', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchJson('https://api.example.com/rate-limited'))
      .rejects.toThrow('HTTP 429 Too Many Requests from https://api.example.com/rate-limited');
  });

  it('parses non-2xx body when checkStatus is false (dictionary-style APIs)', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ title: 'No Definitions Found' }),
    })) as unknown as typeof fetch;

    const data = await fetchJson('https://api.example.com/w/zzz', { checkStatus: false });
    expect(data).toEqual({ title: 'No Definitions Found' });
  });

  it('maps AbortSignal TimeoutError to a friendly message with the timeout value', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException('signal timed out', 'TimeoutError');
    }) as unknown as typeof fetch;

    await expect(fetchJson('https://api.example.com/slow', { timeoutMs: 3000 }))
      .rejects.toThrow('Request timed out after 3000ms: https://api.example.com/slow');
  });

  it('propagates JSON parse failures untouched', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    })) as unknown as typeof fetch;

    await expect(fetchJson('https://api.example.com/html-error'))
      .rejects.toThrow('Unexpected token < in JSON');
  });
});
