import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/session/session-client.js', () => ({
  openSession: vi.fn().mockResolvedValue({ id: 'test-id', name: 'default', url: 'https://example.com' }),
  closeSession: vi.fn().mockResolvedValue(undefined),
  closeAllSessions: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
}));

describe('session builtins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('session open', () => {
    it('opens a session and prints info', async () => {
      const { sessionOpenBuiltin } = await import('../../src/builtins/session.js');
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await sessionOpenBuiltin.execute(
        ['https://example.com'],
        { name: 'default' },
        { cwd: process.cwd() }
      );
      console.log = origLog;

      expect(logs.some((l) => l.includes('test-id'))).toBe(true);
    });
  });

  describe('session close', () => {
    it('closes a named session', async () => {
      const { sessionCloseBuiltin } = await import('../../src/builtins/session.js');
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await sessionCloseBuiltin.execute([], { name: 'default' }, { cwd: process.cwd() });
      console.log = origLog;

      expect(logs[0]).toContain('default');
      expect(logs[0]).toContain('closed');
    });

    it('closes all sessions with --all flag', async () => {
      const { sessionCloseBuiltin } = await import('../../src/builtins/session.js');
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await sessionCloseBuiltin.execute([], { all: true }, { cwd: process.cwd() });
      console.log = origLog;

      const { closeAllSessions } = await import('../../src/session/session-client.js');
      expect(closeAllSessions).toHaveBeenCalled();
    });
  });

  describe('session list', () => {
    it('shows no active sessions when empty', async () => {
      const { sessionListBuiltin } = await import('../../src/builtins/session.js');
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await sessionListBuiltin.execute([], {}, { cwd: process.cwd() });
      console.log = origLog;

      expect(logs[0]).toContain('No active sessions');
    });

    it('lists active sessions', async () => {
      const { sessionListBuiltin } = await import('../../src/builtins/session.js');
      const sessClient = await import('../../src/session/session-client.js');
      vi.mocked(sessClient.listSessions).mockResolvedValueOnce([
        { id: 'abc', name: 'default' },
      ]);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await sessionListBuiltin.execute([], {}, { cwd: process.cwd() });
      console.log = origLog;

      expect(logs.some((l) => l.includes('abc'))).toBe(true);
    });
  });

  describe('session kill', () => {
    it('kills a session by name', async () => {
      const { sessionKillBuiltin } = await import('../../src/builtins/session.js');
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      await sessionKillBuiltin.execute([], { name: 'test' }, { cwd: process.cwd() });
      console.log = origLog;

      expect(logs[0]).toContain('test');
      expect(logs[0]).toContain('killed');
    });
  });
});
