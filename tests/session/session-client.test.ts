import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue({ status: () => 200 }),
          url: vi.fn().mockReturnValue('https://example.com'),
        }),
        close: vi.fn().mockResolvedValue(undefined),
        browser: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

describe('Session Client', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetForTesting } = await import('../../src/browser.js');
    resetForTesting();
  });

  describe('openSession', () => {
    it('should create a session and return info', async () => {
      const { openSession } = await import('../../src/session/session-client.js');
      const info = await openSession('test', 'https://example.com');
      expect(info.name).toBe('test');
      expect(info.id).toBeDefined();
    });
  });

  describe('listSessions', () => {
    it('should return empty when no sessions', async () => {
      const { listSessions } = await import('../../src/session/session-client.js');
      const result = await listSessions();
      expect(result).toEqual([]);
    });

    it('should list created sessions', async () => {
      const { openSession, listSessions } = await import('../../src/session/session-client.js');
      await openSession('test', 'https://example.com');
      const result = await listSessions();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test');
    });
  });

  describe('closeSession', () => {
    it('should close a session by name', async () => {
      const { openSession, closeSession, listSessions } = await import('../../src/session/session-client.js');
      await openSession('test', 'https://example.com');
      await closeSession('test');
      const result = await listSessions();
      expect(result).toEqual([]);
    });
  });

  describe('closeAllSessions', () => {
    it('should close all sessions', async () => {
      const { openSession, closeAllSessions, listSessions } = await import('../../src/session/session-client.js');
      await openSession('test1', 'https://example.com');
      await openSession('test2', 'https://example.com');
      await closeAllSessions();
      const result = await listSessions();
      expect(result).toEqual([]);
    });
  });
});
