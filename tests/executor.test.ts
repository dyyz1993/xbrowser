import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(null),
          url: vi.fn().mockReturnValue('about:blank'),
        }),
        close: vi.fn().mockResolvedValue(undefined),
        browser: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

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

  it('should return error when no session exists', async () => {
    const { resetForTesting } = await import('../src/browser.js');
    resetForTesting();
    const { executeCommand } = await import('../src/executor.js');
    const result = await executeCommand('title', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('Session');
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

  it('should not detect single command as chain', async () => {
    const { isChainInput } = await import('../src/executor.js');
    expect(isChainInput('title')).toBe(false);
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
});
