import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/session/session-client.js', () => ({
  closeSession: vi.fn().mockResolvedValue(undefined),
  closeAllSessions: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
}));

describe('session builtins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('session close - error cases', () => {
    it('should exit when closeSession throws', async () => {
      const { sessionCloseBuiltin } = await import('../../src/builtins/session.js');
      const sessClient = await import('../../src/session/session-client.js');
      vi.mocked(sessClient.closeSession).mockRejectedValueOnce(new Error('Not found'));
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
      const errors: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errors.push(args.join(' '));
      await expect(sessionCloseBuiltin.execute([], { name: 'missing' }, { cwd: process.cwd() })).rejects.toThrow('exit');
      console.error = origErr;
      exitSpy.mockRestore();
      expect(errors.some(e => e.includes('Not found'))).toBe(true);
    });
  });

  describe('session list - error cases', () => {
    it('should exit when listSessions throws', async () => {
      const { sessionListBuiltin } = await import('../../src/builtins/session.js');
      const sessClient = await import('../../src/session/session-client.js');
      vi.mocked(sessClient.listSessions).mockRejectedValueOnce(new Error('Network error'));
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
      const errors: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errors.push(args.join(' '));
      await expect(sessionListBuiltin.execute([], {}, { cwd: process.cwd() })).rejects.toThrow('exit');
      console.error = origErr;
      exitSpy.mockRestore();
      expect(errors.some(e => e.includes('Network error'))).toBe(true);
    });
  });

  describe('session kill - error cases', () => {
    it('should exit when closeSession throws for kill', async () => {
      const { sessionKillBuiltin } = await import('../../src/builtins/session.js');
      const sessClient = await import('../../src/session/session-client.js');
      vi.mocked(sessClient.closeSession).mockRejectedValueOnce(new Error('Cannot kill'));
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
      const errors: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errors.push(args.join(' '));
      await expect(sessionKillBuiltin.execute([], { name: 'test' }, { cwd: process.cwd() })).rejects.toThrow('exit');
      console.error = origErr;
      exitSpy.mockRestore();
      expect(errors.some(e => e.includes('Cannot kill'))).toBe(true);
    });
  });

  describe('handleSessionHelp', () => {
    it('should return help string with usage info', async () => {
      const { handleSessionHelp } = await import('../../src/builtins/session.js');
      const help = handleSessionHelp();
      expect(help).toContain('Usage:');
      expect(help).toContain('session');
      expect(help).toContain('close');
      expect(help).toContain('list');
      expect(help).toContain('--session');
    });
  });
});
