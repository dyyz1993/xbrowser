import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/daemon/network-store.js', () => ({
  networkStore: {
    add: vi.fn(),
    list: vi.fn().mockReturnValue({ session: 'default', total: 0, captures: [] }),
    inspect: vi.fn().mockReturnValue({ session: 'default', capture: null }),
    clear: vi.fn(),
  },
  commandLogStore: {
    clear: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

// Use vi.hoisted to share mock state between factory and test
const hoisted = vi.hoisted(() => {
  const eventCallbacks = new Map<string, Array<(...args: unknown[]) => void>>();
  const mockPage = {
    url: vi.fn().mockReturnValue('about:blank'),
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (!eventCallbacks.has(event)) eventCallbacks.set(event, []);
      eventCallbacks.get(event)!.push(callback);
    }),
    off: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(true),
    isClosed: vi.fn().mockReturnValue(false),
    _cdpSend: vi.fn().mockResolvedValue({ body: '', base64Encoded: false }),
  };
  const mockContext = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(mockPage),
    pages: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  };
  const mockBrowser = {
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue(mockContext),
    contexts: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
    disconnected: false,
  };
  return { mockPage, mockContext, mockBrowser, eventCallbacks };
});

vi.mock('../src/cdp-driver/index.js', () => ({
  launch: vi.fn().mockResolvedValue({ browser: hoisted.mockBrowser, wsEndpoint: 'ws://localhost:0' }),
}));

vi.mock('../src/utils/cdp.js', () => ({
  resolveCDPEndpoint: vi.fn((ep: string) => Promise.resolve(ep)),
}));

vi.mock('../src/recorder/session-recorder.js', () => ({
  SessionRecorder: { cleanup: vi.fn() },
}));

import { createSession, resetForTesting } from '../src/browser.js';
import { networkStore } from '../src/daemon/network-store.js';

const { mockPage, eventCallbacks } = hoisted;

function emitEvent(event: string, params: unknown): void {
  const cbs = eventCallbacks.get(event);
  if (cbs) {
    for (const cb of cbs) cb(params);
  }
}

function simulateNetworkRequest(opts: {
  requestId?: string;
  url?: string;
  method?: string;
  status?: number;
  contentType?: string;
  mimeType?: string;
  resourceType?: string;
  body?: string;
  requestHeaders?: Record<string, string>;
  postData?: string | null;
  responseHeaders?: Record<string, string>;
}): void {
  const requestId = opts.requestId ?? `req-${Date.now()}`;
  const url = opts.url ?? 'https://api.example.com/data';
  const method = opts.method ?? 'GET';
  const status = opts.status ?? 200;
  const contentType = opts.contentType ?? 'application/json';
  const responseHeaders = opts.responseHeaders ?? { 'content-type': contentType };

  emitEvent('request', {
    requestId,
    request: {
      url,
      method,
      headers: opts.requestHeaders ?? {},
      postData: opts.postData ?? undefined,
    },
    type: opts.resourceType ?? 'fetch',
  });

  emitEvent('response', {
    requestId,
    type: opts.resourceType ?? 'fetch',
    response: {
      status,
      url,
      headers: responseHeaders,
      mimeType: opts.mimeType ?? contentType,
    },
  });

  mockPage._cdpSend.mockResolvedValueOnce({
    body: opts.body ?? '',
    base64Encoded: false,
  });

  emitEvent('requestfinished', { requestId });
}

describe('network capture', () => {
  const originalDaemonWorker = process.env.XBROWSER_DAEMON_WORKER;

  beforeEach(() => {
    vi.clearAllMocks();
    eventCallbacks.clear();
    hoisted.mockContext.close.mockResolvedValue(undefined);
    hoisted.mockContext.pages.mockReturnValue([]);
    hoisted.mockContext.newPage.mockResolvedValue(mockPage);
    mockPage.url.mockReturnValue('about:blank');
    mockPage.goto.mockResolvedValue(undefined);
    // mockReset clears the mockResolvedValueOnce queue AND implementation, then re-set default
    mockPage._cdpSend.mockReset();
    mockPage._cdpSend.mockResolvedValue({ body: '', base64Encoded: false });
    delete process.env.XBROWSER_DAEMON_WORKER;
    resetForTesting();
  });

  afterEach(() => {
    if (originalDaemonWorker === undefined) {
      delete process.env.XBROWSER_DAEMON_WORKER;
    } else {
      process.env.XBROWSER_DAEMON_WORKER = originalDaemonWorker;
    }
    resetForTesting();
  });

  it('should NOT install network capture when not daemon worker', async () => {
    expect(process.env.XBROWSER_DAEMON_WORKER).toBeUndefined();

    await createSession('no-daemon');

    expect(mockPage.on).not.toHaveBeenCalledWith('request', expect.any(Function));
    expect(mockPage.on).not.toHaveBeenCalledWith('response', expect.any(Function));
  });

  it('should install network capture when daemon worker', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('daemon-session');

    expect(mockPage.on).toHaveBeenCalledWith('request', expect.any(Function));
    expect(mockPage.on).toHaveBeenCalledWith('response', expect.any(Function));
    expect(mockPage.on).toHaveBeenCalledWith('requestfinished', expect.any(Function));
  });

  it('should capture response data and push to networkStore', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('capture-session');

    await new Promise(r => setTimeout(r, 100));

    simulateNetworkRequest({
      url: 'https://api.example.com/data',
      status: 200,
      contentType: 'application/json',
      method: 'GET',
      resourceType: 'fetch',
      body: '{"key":"value"}',
    });

    await new Promise(r => setTimeout(r, 200));

    expect(networkStore.add).toHaveBeenCalledWith('capture-session', expect.objectContaining({
      url: 'https://api.example.com/data',
      status: 200,
      method: 'GET',
      resourceType: 'fetch',
      contentType: 'application/json',
      path: '/data',
      body: { key: 'value' },
    }));
  });

  it('should handle response errors gracefully', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('error-session');

    await new Promise(r => setTimeout(r, 100));

    mockPage._cdpSend.mockRejectedValueOnce(new Error('body read failed'));

    simulateNetworkRequest({
      body: '',
    });

    await new Promise(r => setTimeout(r, 200));

    expect(networkStore.add).toHaveBeenCalledWith('error-session', expect.objectContaining({
      url: 'https://api.example.com/data',
      body: undefined,
    }));
  });

  it('should parse JSON bodies <= 10KB', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('json-session');

    await new Promise(r => setTimeout(r, 100));

    const smallJson = '{"name":"test","items":[1,2,3]}';
    simulateNetworkRequest({
      contentType: 'application/json',
      body: smallJson,
    });

    await new Promise(r => setTimeout(r, 200));

    expect(networkStore.add).toHaveBeenCalledWith('json-session', expect.objectContaining({
      body: { name: 'test', items: [1, 2, 3] },
      size: smallJson.length,
    }));
  });

  it('should skip body parsing for large bodies (>10KB)', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('large-body-session');

    await new Promise(r => setTimeout(r, 100));

    const largeBody = 'x'.repeat(10241);
    simulateNetworkRequest({
      contentType: 'application/json',
      body: largeBody,
    });

    await new Promise(r => setTimeout(r, 200));

    expect(networkStore.add).toHaveBeenCalledWith('large-body-session', expect.objectContaining({
      body: undefined,
      size: 10241,
    }));
  });

  it('should store truncated text for non-JSON text content under 10KB', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('text-session');

    await new Promise(r => setTimeout(r, 100));

    const textBody = 'not valid json content';
    simulateNetworkRequest({
      contentType: 'text/html',
      body: textBody,
    });

    await new Promise(r => setTimeout(r, 200));

    expect(networkStore.add).toHaveBeenCalledWith('text-session', expect.objectContaining({
      body: textBody.slice(0, 200),
      size: textBody.length,
    }));
  });

  it('should record size only for binary/non-text content types', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('binary-session');

    await new Promise(r => setTimeout(r, 100));

    const binBody = 'binary-data-here';
    simulateNetworkRequest({
      contentType: 'image/png',
      body: binBody,
    });

    await new Promise(r => setTimeout(r, 200));

    expect(networkStore.add).toHaveBeenCalledWith('binary-session', expect.objectContaining({
      body: undefined,
      size: binBody.length,
    }));
  });

  it('should silently ignore capture errors without throwing', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('capture-error-session');

    await new Promise(r => setTimeout(r, 100));

    emitEvent('request', {
      requestId: 'bad-req',
      request: { url: 'https://api.example.com/data', method: 'GET', headers: {} },
      type: 'fetch',
    });

    emitEvent('requestfinished', { requestId: 'bad-req' });

    await new Promise(r => setTimeout(r, 200));

    expect(networkStore.add).not.toHaveBeenCalled();
  });
});
