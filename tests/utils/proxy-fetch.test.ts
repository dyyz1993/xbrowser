import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
const mockAgent = { dispatch: vi.fn() };
const MockEnvHttpProxyAgent = vi.fn(() => mockAgent);
const ufdInstance = { append: vi.fn() };
const MockUFormData = vi.fn(() => ufdInstance);

vi.mock('undici', () => ({
  EnvHttpProxyAgent: MockEnvHttpProxyAgent,
  fetch: mockFetch,
  FormData: MockUFormData,
}));

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  delete process.env.https_proxy;
  delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy;
  delete process.env.HTTP_PROXY;
  delete process.env.all_proxy;
  delete process.env.ALL_PROXY;
});

describe('ensureProxyFetch', () => {
  it('should patch fetch when https_proxy is set', async () => {
    process.env.https_proxy = 'http://proxy:8080';
    const { ensureProxyFetch } = await import('../../src/utils/proxy-fetch.js');
    await ensureProxyFetch();
    expect(globalThis.fetch).not.toBe(originalFetch);
  });

  it('should call undici fetch with dispatcher', async () => {
    const patchedFetch = globalThis.fetch as typeof fetch;
    await patchedFetch('http://example.com', { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://example.com',
      expect.objectContaining({ dispatcher: mockAgent, method: 'GET' }),
    );
  });

  it('should extract href from URL input', async () => {
    await globalThis.fetch(new URL('http://example.com/path?q=1'));

    expect(mockFetch).toHaveBeenCalledWith(
      'http://example.com/path?q=1',
      expect.objectContaining({ dispatcher: mockAgent }),
    );
  });

  it('should convert global FormData to undici FormData for Blob entries', async () => {
    const gfd = new FormData();
    gfd.append('key', 'value');
    const blob = new Blob(['content'], { type: 'text/plain' });
    gfd.append('file', blob, 'test.txt');

    await globalThis.fetch('http://example.com/upload', { method: 'POST', body: gfd });

    expect(MockUFormData).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://example.com/upload',
      expect.objectContaining({ body: ufdInstance, dispatcher: mockAgent }),
    );
  });

  it('should be idempotent (patched flag prevents re-patch)', async () => {
    const { ensureProxyFetch } = await import('../../src/utils/proxy-fetch.js');
    const beforeFetch = globalThis.fetch;
    await ensureProxyFetch();
    expect(globalThis.fetch).toBe(beforeFetch);
  });

  it('should handle no proxy env (early return after patched)', async () => {
    delete process.env.https_proxy;
    const { ensureProxyFetch } = await import('../../src/utils/proxy-fetch.js');
    const beforeFetch = globalThis.fetch;
    await ensureProxyFetch();
    expect(globalThis.fetch).toBe(beforeFetch);
  });
});
