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
