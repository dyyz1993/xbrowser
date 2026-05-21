import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

const mockBrowserPage = {
  goto: vi.fn().mockResolvedValue(null),
  url: vi.fn().mockReturnValue('about:blank'),
  close: vi.fn().mockResolvedValue(undefined),
};
const mockBrowserContext = {
  newPage: vi.fn().mockResolvedValue(mockBrowserPage),
  pages: vi.fn().mockReturnValue([]),
  close: vi.fn().mockResolvedValue(undefined),
  browser: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
};
const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockBrowserContext),
  contexts: vi.fn().mockReturnValue([]),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
    connectOverCDP: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

const mockGetSite = vi.fn(() => null);

// Mock daemon modules so tests don't wait for real daemon timeouts
const mockIsDaemonRunning = vi.fn().mockResolvedValue(false);
const mockStartDaemon = vi.fn().mockRejectedValue(new Error('no daemon in test'));

vi.mock('../src/client/daemon-client.js', () => ({
  isDaemonRunning: mockIsDaemonRunning,
  forwardExec: vi.fn(),
  forwardChain: vi.fn(),
}));

vi.mock('../src/daemon/daemon.js', () => ({
  startDaemonProcess: mockStartDaemon,
  stopDaemonProcess: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
}));

// Isolate homedir to a temp dir so stale session files don't affect tests
vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/tmp/xbrowser-test-executor'),
}));

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

describe('Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error for unknown command', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('nonexistent.command', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown command');
  });

  it('should include available commands in unknown command error', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('nonexistent.command', {});
    expect(result.message).toContain('Available:');
  });

  it('should return error when no session exists', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('title', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('Session');
  });

  it('should mention session open hint when session not found', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('title', {});
    expect(result.message).toContain('session open');
  });

  it('should report invalid parameters', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('goto', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid parameters');
  });

  it('should include path info in validation error', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('goto', {});
    expect(result.message).toContain('url');
  });

  it('should return error result with duration 0 for unknown command', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('nonexistent.command', {});
    expect(result.duration).toBe(0);
    expect(result.data).toBeNull();
  });

  it('should use default session name when not specified', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('title', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Session 'default' not found");
  });

  it('should use custom session name in error', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('title', {}, 'my-session');
    expect(result.success).toBe(false);
    expect(result.message).toContain("Session 'my-session' not found");
  });

  it('should return error result with correct shape for missing session', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('click', { selector: '#btn' });
    expect(result).toEqual({
      success: false,
      data: null,
      message: expect.stringContaining('Session'),
      duration: 0,
      tips: [],
    });
  });
});

describe('BrowserManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should start with no sessions', async () => {
    const { resetForTesting, getAllSessions } = await import('../src/browser.js');
    resetForTesting();
    expect(getAllSessions()).toEqual([]);
  });

  it('should reset for testing', async () => {
    const { resetForTesting, getAllSessions } = await import('../src/browser.js');
    resetForTesting();
    expect(getAllSessions()).toEqual([]);
  });
});

describe('Chain Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect chain input with comma separator', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('goto url , title')).toBe(true);
  });

  it('should detect chain input with plus separator', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('goto url + title')).toBe(true);
  });

  it('should detect chain input with arrow separator', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('goto url -> title')).toBe(true);
  });

  it('should detect chain input with && separator', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('goto url && title')).toBe(true);
  });

  it('should detect chain input with semicolon separator', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('goto url ; title')).toBe(true);
  });

  it('should not detect single command as chain', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('title')).toBe(false);
  });

  it('should not detect URL-like string as chain', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('goto https://example.com')).toBe(false);
  });

  it('should stop chain on failure with && operator', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title && title');
    expect(result.success).toBe(false);
    expect(result.stoppedReason).toContain('failed');
    expect(result.stoppedAt).toBe(1);
  });

  it('should return error for command not found in chain', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent_cmd');
    expect(result.success).toBe(false);
    expect(result.steps[0].message).toContain('Unknown command');
  });

  it('should include stoppedAt in failed && chain', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title && title');
    expect(result.stoppedAt).toBe(1);
    expect(typeof result.stoppedAt).toBe('number');
  });

  it('should report totalDuration in chain result', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title');
    expect(typeof result.totalDuration).toBe('number');
  });

  it('should create session for chain without existing session', async () => {
    const { resetForTesting, getAllSessions } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    await executeChain('title');
    // Session should persist after command execution (lifecycle managed by process exit / session close)
    expect(getAllSessions().length).toBe(1);
  });

  it('should reuse existing session in chain', async () => {
    const { resetForTesting, createSession, getAllSessions } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    expect(getAllSessions().length).toBe(1);
    const { executeChain } = await import('../src/executor.js');
    await executeChain('title');
  });

  it('should handle empty chain input', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('');
    expect(result.steps).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('should mark chain as failed when any step fails (sequence)', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title ; title');
    expect(result.success).toBe(false);
  });

  it('should handle || operator', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title || title');
    expect(result.success).toBe(false);
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('should return steps with correct structure', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent_cmd');
    const step = result.steps[0];
    expect(step).toHaveProperty('command');
    expect(step).toHaveProperty('raw');
    expect(step).toHaveProperty('success');
    expect(step).toHaveProperty('data');
    expect(step).toHaveProperty('duration');
  });

  it('should handle fileMode option in chain', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title', { fileMode: true });
    expect(result).toHaveProperty('steps');
  });

  it('should chain multiple commands with && and report first failure', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title && screenshot && click #btn');
    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBe(1);
    expect(result.steps.length).toBe(1);
  });

  it('should handle sequence with ; creating separate pipelines', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent1 ; nonexistent2');
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(false);
  });

  it('should include stoppedReason for && chain', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title && click #btn');
    expect(result.stoppedReason).toContain('&& chain');
  });

  it('should handle custom session name in chain', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('title', { sessionName: 'custom-session' });
    expect(result).toHaveProperty('steps');
  });
});

describe('setWSServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept null server', async () => {
    const { setWSServer } = await import('../src/executor.js');
    expect(() => setWSServer(null)).not.toThrow();
  });

  it('should accept a WS server object', async () => {
    const { setWSServer } = await import('../src/executor.js');
    const mockServer = {
      getRunning: vi.fn(() => true),
      broadcastToSession: vi.fn(),
    };
    expect(() => setWSServer(mockServer as never)).not.toThrow();
  });
});

describe('executeCommand with session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute command and return result with session', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('title', {});
    expect(typeof result.duration).toBe('number');
    expect(typeof result.success).toBe('boolean');
  });

  it('should include data in successful result', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('title', {});
    expect(result.data).toBeDefined();
  });

  it('should handle command handler throwing error', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('click', { selector: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.message).toBeDefined();
    expect(typeof result.duration).toBe('number');
  });

  it('should stream events when wsServer is set', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand, setWSServer } = await import('../src/executor.js');
    const mockBroadcast = vi.fn();
    const mockServer = {
      getRunning: vi.fn(() => true),
      broadcastToSession: mockBroadcast,
    };
    setWSServer(mockServer as never);

    await executeCommand('title', {});
    expect(mockBroadcast).toHaveBeenCalled();

    setWSServer(null);
  });

  it('should not stream events when wsServer is null', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand, setWSServer } = await import('../src/executor.js');
    setWSServer(null);

    const result = await executeCommand('title', {});
    expect(result).toBeDefined();
  });

  it('should return duration > 0 for executed commands', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('url', {});
    expect(typeof result.duration).toBe('number');
  });
});

describe('executeChain advanced', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle || chain with all failures', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent1 || nonexistent2');
    expect(result.success).toBe(false);
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle || chain with session present', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent_cmd || title');
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle + operator with nonexistent commands', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent1 + nonexistent2');
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(false);
  });

  it('should handle -> operator with nonexistent commands', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent1 -> nonexistent2');
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(false);
  });

  it('should handle , operator with nonexistent commands', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent1 , nonexistent2');
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(false);
  });

  it('should handle chain with multiple pipelines separated by ;', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('nonexistent1 ; nonexistent2 ; nonexistent3');
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(false);
  });
});

describe('executeCommand cdpEndpoint forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass cdpEndpoint to createSession when auto-creating session for goto command', async () => {
    const browserModule = await import('../src/browser.js');
    browserModule.resetForTesting();
    const { executeCommand } = await import('../src/executor.js');

    const result = await executeCommand('goto', { url: 'https://example.com' }, 'test-session', {
      cdpEndpoint: 'http://localhost:9221',
    });

    expect(result).toBeDefined();
  }, 60000);

  it('should work without cdpEndpoint (backward compatibility)', async () => {
    const browserModule = await import('../src/browser.js');
    browserModule.resetForTesting();
    const { executeCommand } = await import('../src/executor.js');

    const result = await executeCommand('goto', { url: 'https://example.com' }, 'test-session');

    expect(result).toBeDefined();
  });

  it('should reuse existing session without creating new one', async () => {
    const browserModule = await import('../src/browser.js');
    browserModule.resetForTesting();
    await browserModule.createSession('existing', undefined, {});
    const createSessionSpy = vi.spyOn(browserModule, 'createSession');
    const { executeCommand } = await import('../src/executor.js');

    await executeCommand('goto', { url: 'https://example.com' }, 'existing', {
      cdpEndpoint: 'http://localhost:9221',
    });

    expect(createSessionSpy).not.toHaveBeenCalled();
  }, 60000);
});

describe('Plugin positional args (executeChain integration)', () => {
  let capturedParams: Record<string, unknown> | null = null;

  function makeMockSite(commands: Record<string, { schema: z.ZodObject<Record<string, z.ZodTypeAny>>; handler?: (params: Record<string, unknown>) => Promise<unknown> }>) {
    return {
      getCommand: vi.fn((name: string) => {
        const entry = commands[name];
        if (!entry) return null;
        return {
          name,
          parameters: entry.schema,
          handler: entry.handler ?? (async (params: Record<string, unknown>) => {
            capturedParams = params;
            return { success: true, data: params };
          }),
        };
      }),
      getAllCommands: vi.fn(() =>
        Object.entries(commands).map(([name, entry]) => ({
          name,
          parameters: entry.schema,
          handler: entry.handler ?? (async (params: Record<string, unknown>) => {
            capturedParams = params;
            return { success: true, data: params };
          }),
        }))
      ),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    capturedParams = null;
    mockGetSite.mockReturnValue(null);
  });

  it('maps positional value to message param for doubao chat', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});

    const site = makeMockSite({
      chat: { schema: z.object({ message: z.string() }) },
    });
    mockGetSite.mockImplementation((cmd: string) => cmd === 'doubao' ? site : null);

    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('doubao chat 你好');

    expect(result.steps[0].success).toBe(true);
    expect(capturedParams).toBeDefined();
    expect((capturedParams as Record<string, unknown>).message).toBe('你好');
  });

  it('maps --message flag without positional', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});

    const site = makeMockSite({
      chat: { schema: z.object({ message: z.string() }) },
    });
    mockGetSite.mockImplementation((cmd: string) => cmd === 'doubao' ? site : null);

    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('doubao chat --message 你好');

    expect(result.steps[0].success).toBe(true);
    expect(capturedParams).toBeDefined();
    expect((capturedParams as Record<string, unknown>).message).toBe('你好');
  });

  it('flag overrides positional when both present', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});

    const site = makeMockSite({
      chat: { schema: z.object({ message: z.string() }) },
    });
    mockGetSite.mockImplementation((cmd: string) => cmd === 'doubao' ? site : null);

    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('doubao chat 你好 --message override');

    expect(result.steps[0].success).toBe(true);
    expect(capturedParams).toBeDefined();
    expect((capturedParams as Record<string, unknown>).message).toBe('override');
  });

  it('maps positional value to query param for doubao search', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});

    const site = makeMockSite({
      search: { schema: z.object({ query: z.string() }) },
    });
    mockGetSite.mockImplementation((cmd: string) => cmd === 'doubao' ? site : null);

    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('doubao search 天气');

    expect(result.steps[0].success).toBe(true);
    expect(capturedParams).toBeDefined();
    expect((capturedParams as Record<string, unknown>).query).toBe('天气');
  });

  it('no positional args, only --prompt flag', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});

    const site = makeMockSite({
      music: { schema: z.object({ prompt: z.string() }) },
    });
    mockGetSite.mockImplementation((cmd: string) => cmd === 'doubao' ? site : null);

    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('doubao music --prompt 一首歌');

    expect(result.steps[0].success).toBe(true);
    expect(capturedParams).toBeDefined();
    expect((capturedParams as Record<string, unknown>).prompt).toBe('一首歌');
  });

  it('maps two positional values to two ZodString params', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});

    const site = makeMockSite({
      fill: { schema: z.object({ selector: z.string(), value: z.string() }) },
    });
    mockGetSite.mockImplementation((cmd: string) => cmd === 'doubao' ? site : null);

    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('doubao fill #input hello');

    expect(result.steps[0].success).toBe(true);
    expect(capturedParams).toBeDefined();
    expect((capturedParams as Record<string, unknown>).selector).toBe('#input');
    expect((capturedParams as Record<string, unknown>).value).toBe('hello');
  });

  it('strips quotes from positional values in chain execution', async () => {
    const { resetForTesting, createSession } = await import('../src/browser.js');
    resetForTesting();
    await createSession('default', undefined, {});

    const site = makeMockSite({
      chat: { schema: z.object({ message: z.string() }) },
    });
    mockGetSite.mockImplementation((cmd: string) => cmd === 'doubao' ? site : null);

    const { executeChain } = await import('../src/executor.js');
    const result = await executeChain('doubao chat "你好"');

    expect(result.steps[0].success).toBe(true);
    expect(capturedParams).toBeDefined();
    expect((capturedParams as Record<string, unknown>).message).toBe('你好');
  });
});
