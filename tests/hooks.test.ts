import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionHook } from '../src/hooks/types.js';

describe('loadHooks', () => {
  const originalEnv = process.env.XBROWSER_HOOKS;

  beforeEach(() => {
    delete process.env.XBROWSER_HOOKS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.XBROWSER_HOOKS = originalEnv;
    } else {
      delete process.env.XBROWSER_HOOKS;
    }
  });

  it('should return empty array when XBROWSER_HOOKS is not set', async () => {
    const { loadHooks } = await import('../src/hooks/loader.js');
    const hooks = await loadHooks();
    expect(hooks).toEqual([]);
  });

  it('should return empty array when XBROWSER_HOOKS is empty string', async () => {
    process.env.XBROWSER_HOOKS = '';
    const { loadHooks } = await import('../src/hooks/loader.js');
    const hooks = await loadHooks();
    expect(hooks).toEqual([]);
  });

  it('should load screenshot hook by name', async () => {
    process.env.XBROWSER_HOOKS = 'screenshot';
    const { loadHooks } = await import('../src/hooks/loader.js');
    const hooks = await loadHooks();
    expect(hooks.length).toBe(1);
    expect(hooks[0].name).toBe('screenshot');
  });

  it('should ignore unknown hook names', async () => {
    process.env.XBROWSER_HOOKS = 'nonexistent';
    const { loadHooks } = await import('../src/hooks/loader.js');
    const hooks = await loadHooks();
    expect(hooks).toEqual([]);
  });

  it('should load multiple hooks separated by comma', async () => {
    process.env.XBROWSER_HOOKS = 'screenshot,nonexistent';
    const { loadHooks } = await import('../src/hooks/loader.js');
    const hooks = await loadHooks();
    expect(hooks.length).toBe(1);
    expect(hooks[0].name).toBe('screenshot');
  });

  it('should trim whitespace from hook names', async () => {
    process.env.XBROWSER_HOOKS = ' screenshot ';
    const { loadHooks } = await import('../src/hooks/loader.js');
    const hooks = await loadHooks();
    expect(hooks.length).toBe(1);
    expect(hooks[0].name).toBe('screenshot');
  });

  it('should register custom hook via registerBuiltinHook', async () => {
    const customHook: ExecutionHook = {
      name: 'custom-test',
      async onBeforeCommand() {},
    };
    const { loadHooks, registerBuiltinHook } = await import('../src/hooks/loader.js');
    registerBuiltinHook('custom-test', async () => customHook);

    process.env.XBROWSER_HOOKS = 'custom-test';
    const hooks = await loadHooks();
    expect(hooks.length).toBe(1);
    expect(hooks[0].name).toBe('custom-test');
  });
});

describe('screenshotHook', () => {
  it('should capture screenshot and return base64 data', async () => {
    const mockBuffer = Buffer.from('fake-screenshot-data');
    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(mockBuffer),
      url: vi.fn().mockReturnValue('https://example.com'),
    };

    const { screenshotHook } = await import('../src/hooks/screenshot.js');
    const result = await screenshotHook.onAfterCommand!({
      page: mockPage as never,
      command: 'goto',
      params: { url: 'https://example.com' },
      result: { success: true, data: { url: 'https://example.com' } },
      duration: 100,
    });

    expect(result).toBeDefined();
    expect(result!.screenshot).toBeDefined();
    expect((result!.screenshot as Record<string, unknown>).step).toBe('goto');
    expect((result!.screenshot as Record<string, unknown>).command).toBe('goto');
    expect((result!.screenshot as Record<string, unknown>).base64).toBe(mockBuffer.toString('base64'));
    expect((result!.screenshot as Record<string, unknown>).url).toBe('https://example.com');
    expect(typeof (result!.screenshot as Record<string, unknown>).timestamp).toBe('number');
  });

  it('should use quality from XBROWSER_SCREENSHOT_QUALITY env', async () => {
    const originalQuality = process.env.XBROWSER_SCREENSHOT_QUALITY;
    process.env.XBROWSER_SCREENSHOT_QUALITY = '60';

    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('data')),
      url: vi.fn().mockReturnValue('https://example.com'),
    };

    const { screenshotHook } = await import('../src/hooks/screenshot.js');
    await screenshotHook.onAfterCommand!({
      page: mockPage as never,
      command: 'goto',
      params: {},
      result: {},
      duration: 0,
    });

    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 60 })
    );

    if (originalQuality !== undefined) {
      process.env.XBROWSER_SCREENSHOT_QUALITY = originalQuality;
    } else {
      delete process.env.XBROWSER_SCREENSHOT_QUALITY;
    }
  });

  it('should default to quality 40 when env not set', async () => {
    delete process.env.XBROWSER_SCREENSHOT_QUALITY;

    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('data')),
      url: vi.fn().mockReturnValue('https://example.com'),
    };

    const { screenshotHook } = await import('../src/hooks/screenshot.js');
    await screenshotHook.onAfterCommand!({
      page: mockPage as never,
      command: 'goto',
      params: {},
      result: {},
      duration: 0,
    });

    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 40 })
    );
  });

  it('should return undefined on screenshot failure', async () => {
    const mockPage = {
      screenshot: vi.fn().mockRejectedValue(new Error('page crashed')),
      url: vi.fn().mockReturnValue('about:blank'),
    };

    const { screenshotHook } = await import('../src/hooks/screenshot.js');
    const result = await screenshotHook.onAfterCommand!({
      page: mockPage as never,
      command: 'goto',
      params: {},
      result: {},
      duration: 0,
    });

    expect(result).toBeUndefined();
  });

  it('should have correct hook name', async () => {
    const { screenshotHook } = await import('../src/hooks/screenshot.js');
    expect(screenshotHook.name).toBe('screenshot');
  });

  it('should not have onBeforeCommand defined', async () => {
    const { screenshotHook } = await import('../src/hooks/screenshot.js');
    expect(screenshotHook.onBeforeCommand).toBeUndefined();
  });

  it('should use jpeg type for smaller size', async () => {
    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('data')),
      url: vi.fn().mockReturnValue('https://example.com'),
    };

    const { screenshotHook } = await import('../src/hooks/screenshot.js');
    await screenshotHook.onAfterCommand!({
      page: mockPage as never,
      command: 'goto',
      params: {},
      result: {},
      duration: 0,
    });

    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'jpeg' })
    );
  });
});

describe('Hook integration with executeCommand', () => {
  const hoisted = vi.hoisted(() => {
    const page = {
      goto: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue('about:blank'),
      close: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
      title: vi.fn().mockResolvedValue('Test Page'),
      evaluate: vi.fn().mockResolvedValue(true),
    };
    const browserContext = {
      newPage: vi.fn().mockResolvedValue(page),
      pages: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
      browser: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue(browserContext),
      contexts: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    return { browser };
  });

  vi.mock('../src/cdp-driver/index.js', () => ({
    launch: vi.fn().mockResolvedValue({ browser: hoisted.browser, wsEndpoint: 'ws://localhost:0' }),
  }));

  vi.mock('../src/utils/cdp.js', () => ({
    resolveCDPEndpoint: vi.fn((ep: string) => Promise.resolve(ep)),
  }));

  vi.mock('../src/recorder/session-recorder.js', () => ({
    SessionRecorder: { cleanup: vi.fn() },
  }));

  vi.mock('../src/client/daemon-client.js', () => ({
    isDaemonRunning: vi.fn().mockResolvedValue(false),
    forwardExec: vi.fn(),
    forwardChain: vi.fn(),
  }));

  vi.mock('../src/daemon/daemon.js', () => ({
    startDaemonProcess: vi.fn().mockRejectedValue(new Error('no daemon in test')),
    stopDaemonProcess: vi.fn(),
    getDaemonProcessStatus: vi.fn(),
  }));

  vi.mock('os', () => ({
    default: { homedir: () => '/tmp/xbrowser-test-hooks' },
    homedir: vi.fn().mockReturnValue('/tmp/xbrowser-test-hooks'),
  }));

  const mockGetSite = vi.fn(() => null);

  vi.mock('../src/plugin/loader.js', () => {
    const mockLoader = {
      getCore: () => ({
        loader: {
          getSite: mockGetSite,
        },
      }),
      scanAndLoad: vi.fn(),
    };
    return {
      XBrowserPluginLoader: vi.fn(() => mockLoader),
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.XBROWSER_HOOKS;
    delete process.env.XBROWSER_SCREENSHOT_QUALITY;
  });

  it('should include hookOutputs when XBROWSER_HOOKS=screenshot', async () => {
    process.env.XBROWSER_HOOKS = 'screenshot';

    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');

    const result = await executeCommand('title', {});

    expect(result.hookOutputs).toBeDefined();
    expect(result.hookOutputs!.length).toBe(1);
    expect(result.hookOutputs![0]._hook).toBe('screenshot');
    expect(result.hookOutputs![0].screenshot).toBeDefined();
  });

  it('should not include hookOutputs when XBROWSER_HOOKS is not set', async () => {
    delete process.env.XBROWSER_HOOKS;

    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');

    const result = await executeCommand('title', {});

    expect(result.hookOutputs).toBeUndefined();
  });

  it('should not include hookOutputs when session has no page', async () => {
    process.env.XBROWSER_HOOKS = 'screenshot';

    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');

    const result = await executeCommand('nonexistent_cmd', {});

    expect(result.success).toBe(false);
    expect(result.hookOutputs).toBeUndefined();
  });
});
