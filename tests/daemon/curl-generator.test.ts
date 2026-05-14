import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { generateCurl, replayEntry } from '../../src/daemon/curl-generator';
import type { NetworkCaptureEntry } from '../../src/daemon/network-store';

function makeEntry(overrides: Partial<NetworkCaptureEntry> = {}): NetworkCaptureEntry {
  return {
    id: 1,
    timestamp: Date.now(),
    method: 'GET',
    url: 'https://api.example.com/data',
    path: '/data',
    status: 200,
    contentType: 'application/json',
    size: 1024,
    headers: { 'content-type': 'application/json' },
    resourceType: 'fetch',
    ...overrides,
  };
}

describe('curl-generator', () => {
  describe('generateCurl', () => {
    it('simple GET request', () => {
      const entry = makeEntry({ method: 'GET', url: 'https://example.com/api' });
      const result = generateCurl(entry);
      expect(result.command).toMatch(/curl/);
      expect(result.command).toMatch(/-X 'GET'/);
      expect(result.command).toMatch(/'https:\/\/example\.com\/api'/);
      expect(result.method).toBe('GET');
      expect(result.url).toBe('https://example.com/api');
    });

    it('POST with JSON body includes -d flag', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://example.com/api',
        requestBody: { key: 'value' },
      });
      const result = generateCurl(entry);
      expect(result.hasBody).toBe(true);
      expect(result.command).toMatch(/-d '\{"key":"value"}'/);
    });

    it('POST with headers includes -H flags', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://example.com/api',
        requestHeaders: {
          'content-type': 'application/json',
          'x-custom': 'hello',
          authorization: 'Bearer token',
        },
        requestBody: { data: 1 },
      });
      const result = generateCurl(entry);
      expect(result.headerCount).toBe(3);
      expect(result.command).toMatch(/-H 'x-custom: hello'/);
      expect(result.command).toMatch(/-H 'authorization: Bearer token'/);
    });

    it('skips noise headers', () => {
      const entry = makeEntry({
        requestHeaders: {
          'content-type': 'application/json',
          host: 'example.com',
          connection: 'keep-alive',
          'accept-encoding': 'gzip',
          'accept-language': 'en-US',
          'sec-ch-ua': '"Chromium"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          priority: 'u=1',
        },
      });
      const result = generateCurl(entry);
      expect(result.headerCount).toBe(1);
      expect(result.command).not.toMatch(/-H 'host:/);
      expect(result.command).not.toMatch(/-H 'connection:/);
      expect(result.command).toMatch(/-H 'content-type: application\/json'/);
    });

    it('skips HTTP/2 pseudo-headers', () => {
      const entry = makeEntry({
        requestHeaders: {
          ':method': 'GET',
          ':path': '/api',
          ':authority': 'example.com',
          ':scheme': 'https',
          'content-type': 'application/json',
        },
      });
      const result = generateCurl(entry);
      expect(result.headerCount).toBe(1);
      expect(result.command).not.toMatch(/-H ':method/);
      expect(result.command).not.toMatch(/-H ':path/);
    });

    it('escapes single quotes in body', () => {
      const entry = makeEntry({
        method: 'POST',
        requestBody: { name: "O'Brien" },
      });
      const result = generateCurl(entry);
      expect(result.command).toContain("O'\\''Brien");
    });

    it('escapes single quotes in header values', () => {
      const entry = makeEntry({
        requestHeaders: { 'x-name': "it's test" },
      });
      const result = generateCurl(entry);
      expect(result.command).toContain("it'\\''s test");
    });

    it('compressed=false omits --compressed', () => {
      const entry = makeEntry();
      const result = generateCurl(entry, { compressed: false });
      expect(result.command).not.toMatch(/--compressed/);
    });

    it('compressed=true (default) includes --compressed', () => {
      const entry = makeEntry();
      const result = generateCurl(entry);
      expect(result.command).toMatch(/--compressed/);
    });

    it('insecure=true adds -k flag', () => {
      const entry = makeEntry();
      const result = generateCurl(entry, { insecure: true });
      expect(result.command).toMatch(/-k/);
    });

    it('insecure=false (default) omits -k', () => {
      const entry = makeEntry();
      const result = generateCurl(entry);
      expect(result.command).not.toMatch(/ -k /);
    });

    it('DELETE method', () => {
      const entry = makeEntry({
        method: 'DELETE',
        url: 'https://example.com/api/1',
        requestBody: { confirm: true },
      });
      const result = generateCurl(entry);
      expect(result.method).toBe('DELETE');
      expect(result.command).toMatch(/-X 'DELETE'/);
      expect(result.hasBody).toBe(true);
    });

    it('no body for GET requests', () => {
      const entry = makeEntry({ method: 'GET', requestBody: 'ignored' });
      const result = generateCurl(entry);
      expect(result.hasBody).toBe(false);
      expect(result.command).not.toMatch(/-d/);
    });

    it('includeHeaders=false skips headers', () => {
      const entry = makeEntry({
        requestHeaders: { 'content-type': 'application/json', 'x-test': 'yes' },
      });
      const result = generateCurl(entry, { includeHeaders: false });
      expect(result.headerCount).toBe(0);
      expect(result.command).not.toMatch(/-H/);
    });

    it('includeBody=false skips body', () => {
      const entry = makeEntry({
        method: 'POST',
        requestBody: { data: 1 },
      });
      const result = generateCurl(entry, { includeBody: false });
      expect(result.command).not.toMatch(/-d/);
    });

    it('body as string is used directly', () => {
      const entry = makeEntry({
        method: 'POST',
        requestBody: 'raw-string-body',
      });
      const result = generateCurl(entry);
      expect(result.command).toMatch(/-d 'raw-string-body'/);
    });

    it('PUT method with body', () => {
      const entry = makeEntry({
        method: 'PUT',
        requestBody: { id: 1, name: 'test' },
      });
      const result = generateCurl(entry);
      expect(result.method).toBe('PUT');
      expect(result.hasBody).toBe(true);
      expect(result.command).toMatch(/-X 'PUT'/);
    });

    it('PATCH method with body', () => {
      const entry = makeEntry({
        method: 'PATCH',
        requestBody: { name: 'updated' },
      });
      const result = generateCurl(entry);
      expect(result.method).toBe('PATCH');
      expect(result.hasBody).toBe(true);
    });

    it('command parts are joined with backslash-newline', () => {
      const entry = makeEntry({ method: 'GET', url: 'https://example.com/api' });
      const result = generateCurl(entry);
      expect(result.command).toContain('\\\n  ');
    });
  });

  describe('replayEntry', () => {
    const mockFetch = vi.fn();

    beforeAll(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('successful replay returns status 200 and metrics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{"result":"ok"}',
      });

      const entry = makeEntry({
        method: 'POST',
        url: 'https://example.com/api',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: { data: 'test' },
      });

      const result = await replayEntry(entry);

      expect(result.curlCommand).toContain('curl');
      expect(result.replay).not.toBeNull();
      expect(result.replay!.success).toBe(true);
      expect(result.replay!.status).toBe(200);
      expect(result.replay!.statusText).toBe('OK');
      expect(result.replay!.contentType).toBe('application/json');
      expect(result.replay!.size).toBe(15);
      expect(result.replay!.duration).toBeGreaterThanOrEqual(0);
    });

    it('failed replay (network error) returns error with null status', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const entry = makeEntry({ method: 'GET', url: 'https://unreachable.example.com', requestHeaders: {} });

      const result = await replayEntry(entry);

      expect(result.replay).not.toBeNull();
      expect(result.replay!.success).toBe(false);
      expect(result.replay!.status).toBeNull();
      expect(result.replay!.error).toBe('ECONNREFUSED');
    });

    it('replay with no body does not include body in fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<html></html>',
      });

      const entry = makeEntry({ method: 'GET', requestBody: undefined, requestHeaders: {} });

      const result = await replayEntry(entry);

      expect(result.replay!.success).toBe(true);
      expect(result.replay!.status).toBe(200);
      const fetchCall = mockFetch.mock.calls[0];
      const fetchOpts = fetchCall[1] as RequestInit;
      expect(fetchOpts.body).toBeUndefined();
    });

    it('replay skips hop-by-hop headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: async () => 'ok',
      });

      const entry = makeEntry({
        method: 'GET',
        requestHeaders: {
          host: 'example.com',
          connection: 'keep-alive',
          'content-length': '100',
          'transfer-encoding': 'chunked',
          'x-custom': 'kept',
        },
      });

      await replayEntry(entry);

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers['host']).toBeUndefined();
      expect(headers['connection']).toBeUndefined();
      expect(headers['content-length']).toBeUndefined();
      expect(headers['transfer-encoding']).toBeUndefined();
      expect(headers['x-custom']).toBe('kept');
    });

    it('replay adds content-type for POST without explicit content-type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: async () => '{}',
      });

      const entry = makeEntry({
        method: 'POST',
        requestHeaders: { 'x-custom': 'yes' },
        requestBody: { data: 1 },
      });

      await replayEntry(entry);

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers['content-type']).toBe('application/json');
    });

    it('replay skips HTTP/2 pseudo-headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: async () => '{}',
      });

      const entry = makeEntry({
        requestHeaders: {
          ':method': 'GET',
          ':path': '/api',
          'content-type': 'application/json',
        },
      });

      await replayEntry(entry);

      const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers[':method']).toBeUndefined();
      expect(headers[':path']).toBeUndefined();
      expect(headers['content-type']).toBe('application/json');
    });

    it('replay with non-OK status returns success=false', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Map(),
        text: async () => 'server error',
      });

      const entry = makeEntry({ method: 'GET', requestHeaders: {} });

      const result = await replayEntry(entry);

      expect(result.replay!.success).toBe(false);
      expect(result.replay!.status).toBe(500);
    });
  });
});
