import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/daemon/network-store.js', () => ({
  networkStore: {
    add: vi.fn(),
    list: vi.fn().mockReturnValue({ session: 'default', total: 0, captures: [] }),
    inspect: vi.fn().mockReturnValue({ session: 'default', capture: null }),
    clear: vi.fn(),
  },
}));

vi.mock('playwright', () => {
  const responseCallbacks: Array<(response: any) => void> = [];
  const mockPage = {
    url: vi.fn().mockReturnValue('about:blank'),
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, callback: any) => {
      if (event === 'response') responseCallbacks.push(callback);
    }),
    _responseCallbacks: responseCallbacks,
  };
  const mockContext = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(mockPage),
    pages: vi.fn().mockReturnValue([]),
  };
  const mockBrowser = {
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue(mockContext),
    contexts: vi.fn().mockReturnValue([]),
    isConnected: vi.fn().mockReturnValue(true),
  };
  return {
    chromium: {
      launch: vi.fn().mockResolvedValue(mockBrowser),
      connectOverCDP: vi.fn().mockResolvedValue(mockBrowser),
    },
    _mockBrowser: mockBrowser,
    _mockContext: mockContext,
    _mockPage: mockPage,
  };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { _mockBrowser, _mockContext, _mockPage } from 'playwright';
import { createSession, resetForTesting } from '../src/browser.js';
import { networkStore } from '../src/daemon/network-store.js';

const mockPage = _mockPage as typeof _mockPage & {
  url: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _responseCallbacks: Array<(response: any) => void>;
};
const mockContext = _mockContext as typeof _mockContext & {
  close: ReturnType<typeof vi.fn>;
  newPage: ReturnType<typeof vi.fn>;
  pages: ReturnType<typeof vi.fn>;
};
const mockBrowser = _mockBrowser as typeof _mockBrowser & {
  close: ReturnType<typeof vi.fn>;
  newContext: ReturnType<typeof vi.fn>;
  contexts: ReturnType<typeof vi.fn>;
};

function createMockResponse(overrides: {
  url?: string;
  status?: number;
  contentType?: string;
  method?: string;
  resourceType?: string;
  body?: string;
  textError?: Error;
}) {
  const textFn = overrides.textError
    ? vi.fn().mockRejectedValue(overrides.textError)
    : vi.fn().mockResolvedValue(overrides.body ?? '');
  return {
    url: vi.fn().mockReturnValue(overrides.url ?? 'https://api.example.com/data'),
    status: vi.fn().mockReturnValue(overrides.status ?? 200),
    headers: vi.fn().mockReturnValue({
      'content-type': overrides.contentType ?? 'application/json',
    }),
    request: vi.fn().mockReturnValue({
      method: vi.fn().mockReturnValue(overrides.method ?? 'GET'),
      resourceType: vi.fn().mockReturnValue(overrides.resourceType ?? 'fetch'),
      headers: vi.fn().mockReturnValue({}),
      postData: vi.fn().mockReturnValue(null),
    }),
    text: textFn,
  };
}

describe('network capture', () => {
  const originalDaemonWorker = process.env.XBROWSER_DAEMON_WORKER;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage._responseCallbacks.length = 0;
    mockContext.close.mockResolvedValue(undefined);
    mockContext.pages.mockReturnValue([]);
    mockContext.newPage.mockResolvedValue(mockPage);
    mockPage.url.mockReturnValue('about:blank');
    mockPage.goto.mockResolvedValue(undefined);
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

    expect(mockPage.on).not.toHaveBeenCalledWith('response', expect.any(Function));
  });

  it('should install network capture when daemon worker', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('daemon-session');

    expect(mockPage.on).toHaveBeenCalledWith('response', expect.any(Function));
    expect(mockPage._responseCallbacks.length).toBe(1);
  });

  it('should capture response data and push to networkStore', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('capture-session');

    const mockResponse = createMockResponse({
      url: 'https://api.example.com/data',
      status: 200,
      contentType: 'application/json',
      method: 'GET',
      resourceType: 'fetch',
      body: '{"key":"value"}',
    });

    await mockPage._responseCallbacks[0](mockResponse);

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

    const mockResponse = createMockResponse({
      textError: new Error('response body read failed'),
    });

    await expect(mockPage._responseCallbacks[0](mockResponse)).resolves.toBeUndefined();

    expect(networkStore.add).toHaveBeenCalledWith('error-session', expect.objectContaining({
      url: 'https://api.example.com/data',
      body: undefined,
    }));
  });

  it('should parse JSON bodies <= 10KB', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('json-session');

    const smallJson = '{"name":"test","items":[1,2,3]}';
    const mockResponse = createMockResponse({
      contentType: 'application/json',
      body: smallJson,
    });

    await mockPage._responseCallbacks[0](mockResponse);

    expect(networkStore.add).toHaveBeenCalledWith('json-session', expect.objectContaining({
      body: { name: 'test', items: [1, 2, 3] },
      size: smallJson.length,
    }));
  });

  it('should skip body parsing for large bodies (>10KB)', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('large-body-session');

    const largeBody = 'x'.repeat(10241);
    const mockResponse = createMockResponse({
      contentType: 'application/json',
      body: largeBody,
    });

    await mockPage._responseCallbacks[0](mockResponse);

    expect(networkStore.add).toHaveBeenCalledWith('large-body-session', expect.objectContaining({
      body: undefined,
      size: 10241,
    }));
  });

  it('should store truncated text for non-JSON text content under 10KB', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('text-session');

    const textBody = 'not valid json content';
    const mockResponse = createMockResponse({
      contentType: 'text/html',
      body: textBody,
    });

    await mockPage._responseCallbacks[0](mockResponse);

    expect(networkStore.add).toHaveBeenCalledWith('text-session', expect.objectContaining({
      body: textBody.slice(0, 200),
      size: textBody.length,
    }));
  });

  it('should record size only for binary/non-text content types', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('binary-session');

    const mockResponse = createMockResponse({
      contentType: 'image/png',
      body: 'binary-data-here',
    });

    await mockPage._responseCallbacks[0](mockResponse);

    expect(networkStore.add).toHaveBeenCalledWith('binary-session', expect.objectContaining({
      body: undefined,
      size: 'binary-data-here'.length,
    }));
  });

  it('should silently ignore capture errors without throwing', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';

    await createSession('capture-error-session');

    const badResponse = {
      url: vi.fn().mockReturnValue('https://api.example.com/data'),
      status: vi.fn().mockReturnValue(200),
      headers: vi.fn().mockImplementation(() => {
        throw new Error('headers access failed');
      }),
      request: vi.fn().mockReturnValue({
        method: vi.fn().mockReturnValue('GET'),
        resourceType: vi.fn().mockReturnValue('fetch'),
        headers: vi.fn().mockReturnValue({}),
        postData: vi.fn().mockReturnValue(null),
      }),
      text: vi.fn().mockResolvedValue(''),
    };

    await expect(mockPage._responseCallbacks[0](badResponse)).resolves.toBeUndefined();

    expect(networkStore.add).not.toHaveBeenCalled();
  });
});
