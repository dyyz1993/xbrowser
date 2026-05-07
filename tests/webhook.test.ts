import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('WebhookNotifier', () => {
  let WebhookNotifier: typeof import('../src/webhook.js').WebhookNotifier;
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/webhook.js');
    WebhookNotifier = mod.WebhookNotifier;
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.XBROWSER_NOTIFY_URL;
  });

  it('should use provided URL', () => {
    const notifier = new WebhookNotifier('https://hooks.example.com/notify');
    notifier.notify({ event: 'session-started', timestamp: new Date().toISOString() });
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.example.com/notify', expect.anything());
  });

  it('should fall back to XBROWSER_NOTIFY_URL env', () => {
    process.env.XBROWSER_NOTIFY_URL = 'https://env.example.com/hook';
    const notifier = new WebhookNotifier();
    notifier.notify({ event: 'captcha-detected', timestamp: new Date().toISOString() });
    expect(mockFetch).toHaveBeenCalledWith('https://env.example.com/hook', expect.anything());
  });

  it('should return false when no URL configured', async () => {
    const notifier = new WebhookNotifier();
    const result = await notifier.notify({ event: 'session-started', timestamp: new Date().toISOString() });
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send POST with JSON body', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const notifier = new WebhookNotifier('https://hook.example.com');
    const payload = { event: 'captcha-detected' as const, timestamp: '2025-01-01T00:00:00Z', sessionId: 's1', url: 'https://example.com' };
    const result = await notifier.notify(payload);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hook.example.com',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const call = mockFetch.mock.calls[0][1];
    expect(JSON.parse(call.body)).toEqual(payload);
  });

  it('should return false on non-2xx response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const notifier = new WebhookNotifier('https://hook.example.com');
    const result = await notifier.notify({ event: 'captcha-resolved', timestamp: new Date().toISOString() });
    expect(result).toBe(false);
  });

  it('should return false on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const notifier = new WebhookNotifier('https://hook.example.com');
    const result = await notifier.notify({ event: 'session-ended', timestamp: new Date().toISOString() });
    expect(result).toBe(false);
  });

  it('should include all payload fields', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const notifier = new WebhookNotifier('https://hook.example.com');
    const payload = {
      event: 'captcha-detected' as const,
      timestamp: '2025-01-01T00:00:00Z',
      sessionId: 's1',
      url: 'https://example.com/captcha',
      reason: 'recaptcha',
      previewUrl: 'http://localhost:9223',
      targetUrl: 'https://example.com/submit',
      timeout: 120,
    };
    await notifier.notify(payload);
    const call = mockFetch.mock.calls[0][1];
    const body = JSON.parse(call.body);
    expect(body).toEqual(payload);
  });

  it('should prioritize constructor URL over env variable', async () => {
    process.env.XBROWSER_NOTIFY_URL = 'https://env.example.com/hook';
    const notifier = new WebhookNotifier('https://constructor.example.com/hook');
    await notifier.notify({ event: 'session-started', timestamp: new Date().toISOString() });
    expect(mockFetch).toHaveBeenCalledWith('https://constructor.example.com/hook', expect.anything());
  });
});
