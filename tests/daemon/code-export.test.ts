import { describe, it, expect } from 'vitest';
import { exportEntry } from '../../src/daemon/code-export';
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
    headers: {},
    body: undefined,
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: undefined,
    resourceType: 'fetch',
    ...overrides,
  };
}

describe('code-export', () => {
  describe('TypeScript export', () => {
    it('GET request', () => {
      const entry = makeEntry({ method: 'GET', url: 'https://example.com/api/users' });
      const result = exportEntry(entry, 'ts');
      expect(result.lang).toBe('ts');
      expect(result.code).toContain("await fetch('https://example.com/api/users'");
      expect(result.code).toContain("method: 'GET'");
      expect(result.code).toContain('await response.json()');
    });

    it('POST with JSON body', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://example.com/api/users',
        requestBody: { name: 'test', age: 25 },
      });
      const result = exportEntry(entry, 'ts');
      expect(result.code).toContain("method: 'POST'");
      expect(result.code).toContain('JSON.stringify');
      expect(result.code).toContain('"name"');
      expect(result.code).toContain('"test"');
    });

    it('filters noise headers', () => {
      const entry = makeEntry({
        method: 'GET',
        requestHeaders: {
          'content-type': 'application/json',
          host: 'example.com',
          connection: 'keep-alive',
          'accept-encoding': 'gzip',
          'accept-language': 'en-US',
          'sec-ch-ua': '"Chromium"',
          'sec-fetch-mode': 'cors',
          ':method': 'GET',
          'x-custom': 'kept',
        },
      });
      const result = exportEntry(entry, 'ts');
      expect(result.code).not.toContain('host');
      expect(result.code).not.toContain(':method');
      expect(result.code).toContain('x-custom');
      expect(result.code).toContain('kept');
    });

    it('escapes special characters in URL', () => {
      const entry = makeEntry({ url: "https://example.com/path?q=it's&x=\"hello\"" });
      const result = exportEntry(entry, 'ts');
      expect(result.code).toContain("it\\'s");
      expect(result.code).toContain('\\"hello\\"');
    });

    it('no body for GET requests', () => {
      const entry = makeEntry({ method: 'GET', requestBody: 'ignored' });
      const result = exportEntry(entry, 'ts');
      expect(result.code).not.toContain('body:');
    });

    it('includes body for PUT requests', () => {
      const entry = makeEntry({ method: 'PUT', requestBody: { id: 1 } });
      const result = exportEntry(entry, 'ts');
      expect(result.code).toContain('body:');
    });

    it('includes body for DELETE requests', () => {
      const entry = makeEntry({ method: 'DELETE', requestBody: { confirm: true } });
      const result = exportEntry(entry, 'ts');
      expect(result.code).toContain('body:');
    });
  });

  describe('Python export', () => {
    it('GET request', () => {
      const entry = makeEntry({ method: 'GET', url: 'https://example.com/api/data' });
      const result = exportEntry(entry, 'python');
      expect(result.lang).toBe('python');
      expect(result.code).toContain('import requests');
      expect(result.code).toContain("requests.get('https://example.com/api/data'");
      expect(result.code).toContain('print(response.json())');
    });

    it('POST with body', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://example.com/api/users',
        requestBody: { name: 'test' },
      });
      const result = exportEntry(entry, 'python');
      expect(result.code).toContain("requests.post('https://example.com/api/users'");
      expect(result.code).toContain('json=');
    });

    it('PUT request', () => {
      const entry = makeEntry({
        method: 'PUT',
        url: 'https://example.com/api/users/1',
        requestBody: { name: 'updated' },
      });
      const result = exportEntry(entry, 'python');
      expect(result.code).toContain("requests.put('https://example.com/api/users/1'");
    });

    it('truncates large body', () => {
      const bigBody = { data: 'x'.repeat(300) };
      const entry = makeEntry({ method: 'POST', requestBody: bigBody });
      const result = exportEntry(entry, 'python');
      expect(result.code).toContain('truncate');
    });

    it('includes headers', () => {
      const entry = makeEntry({
        method: 'GET',
        requestHeaders: { 'x-api-key': 'abc123', host: 'skip-this' },
      });
      const result = exportEntry(entry, 'python');
      expect(result.code).toContain('x-api-key');
      expect(result.code).not.toContain('skip-this');
    });
  });

  describe('Curl export', () => {
    it('delegates to generateCurl', () => {
      const entry = makeEntry({ method: 'GET', url: 'https://example.com/api' });
      const result = exportEntry(entry, 'curl');
      expect(result.lang).toBe('curl');
      expect(result.code).toContain('curl');
      expect(result.code).toContain('https://example.com/api');
    });

    it('POST with body includes -d flag', () => {
      const entry = makeEntry({
        method: 'POST',
        requestBody: { data: 1 },
      });
      const result = exportEntry(entry, 'curl');
      expect(result.code).toContain('-d');
    });
  });

  it('default lang is ts', () => {
    const entry = makeEntry();
    const result = exportEntry(entry);
    expect(result.lang).toBe('ts');
    expect(result.code).toContain('await fetch');
  });
});
