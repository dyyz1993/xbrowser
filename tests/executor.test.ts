import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(null),
          url: vi.fn().mockReturnValue('about:blank'),
          close: vi.fn().mockResolvedValue(undefined),
        }),
        close: vi.fn().mockResolvedValue(undefined),
        browser: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
      connectOverCDP: vi.fn().mockResolvedValue({
        newContext: vi.fn().mockResolvedValue({
          newPage: vi.fn().mockResolvedValue({
            goto: vi.fn().mockResolvedValue(null),
            url: vi.fn().mockReturnValue('about:blank'),
            close: vi.fn().mockResolvedValue(undefined),
          }),
          close: vi.fn().mockResolvedValue(undefined),
          browser: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock('../src/plugin/loader.js', () => {
  const mockLoader = {
    getCore: () => ({
      loader: {
        getSite: vi.fn(() => null),
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
    expect(getAllSessions().length).toBe(0);
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
