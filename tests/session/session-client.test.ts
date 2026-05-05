import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Session Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireSession', () => {
    it('should throw when session file does not exist', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const { requireSession } = await import('../../src/session/session-client.js');
      expect(() => requireSession('nonexistent')).toThrow("Session 'nonexistent' not found");
    });

    it('should return session name when session exists', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const { requireSession } = await import('../../src/session/session-client.js');
      expect(requireSession('my-session')).toBe('my-session');
    });

    it('should default to "default" session name', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const { requireSession } = await import('../../src/session/session-client.js');
      expect(requireSession()).toBe('default');
    });
  });

  describe('daemonRequest', () => {
    it('should throw when daemon not running', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const { daemonRequest } = await import('../../src/session/session-client.js');
      await expect(daemonRequest('session.list')).rejects.toThrow('Daemon not running');
    });

    it('should make HTTP request when daemon is running', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ port: 9222 }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ result: 'data' }),
      });

      const { daemonRequest } = await import('../../src/session/session-client.js');
      const result = await daemonRequest('session.list');
      expect(result).toEqual({ result: 'data' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9222/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should throw on non-ok response', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ port: 9222 }));
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { daemonRequest } = await import('../../src/session/session-client.js');
      await expect(daemonRequest('test')).rejects.toThrow('Request failed: 500');
    });

    it('should throw on error in response body', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ port: 9222 }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ error: 'Something went wrong' }),
      });

      const { daemonRequest } = await import('../../src/session/session-client.js');
      await expect(daemonRequest('test')).rejects.toThrow('Something went wrong');
    });
  });

  describe('openSession', () => {
    it('should create session via daemon and save', async () => {
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ port: 9222 }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 'sess-123' }),
      });

      const { openSession } = await import('../../src/session/session-client.js');
      const session = await openSession('test', 'https://example.com');
      expect(session.name).toBe('test');
      expect(session.url).toBe('https://example.com');
      expect(session.id).toBe('sess-123');
      expect(writeFileSync).toHaveBeenCalled();
    });
  });

  describe('closeSession', () => {
    it('should send session.close to daemon', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ port: 9222 }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ok: true }),
      });

      const { closeSession } = await import('../../src/session/session-client.js');
      await closeSession('test');
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('getSession', () => {
    it('should return null when session file does not exist', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const { getSession } = await import('../../src/session/session-client.js');
      const result = await getSession('nonexistent');
      expect(result).toBeNull();
    });

    it('should return session data when file exists', async () => {
      const { existsSync, readFileSync } = await import('fs');
      const sessionData = { id: '1', name: 'test', url: 'https://example.com' };
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(sessionData));
      const { getSession } = await import('../../src/session/session-client.js');
      const result = await getSession('test');
      expect(result).toEqual(sessionData);
    });
  });

  describe('listSessions', () => {
    it('should return empty array when daemon not running', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const { listSessions } = await import('../../src/session/session-client.js');
      const result = await listSessions();
      expect(result).toEqual([]);
    });

    it('should return sessions when daemon is running', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ port: 9222 }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { id: '1', name: 'default' },
          { id: '2', name: 'test' },
        ]),
      });

      const { listSessions } = await import('../../src/session/session-client.js');
      const result = await listSessions();
      expect(result).toHaveLength(2);
    });

    it('should return empty on fetch error', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({ port: 9222 }));
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const { listSessions } = await import('../../src/session/session-client.js');
      const result = await listSessions();
      expect(result).toEqual([]);
    });
  });
});
