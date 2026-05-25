import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockOpenSession,
  mockCloseSession,
  mockListSessions,
  mockHandleSessionHelp,
  mockIsDaemonRunning,
  mockForwardSessionCreate,
  mockForwardSessionClose,
  mockForwardSessionList,
  mockStartDaemonProcess,
  mockStopDaemonProcess,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockOpenSession: vi.fn(),
  mockCloseSession: vi.fn(),
  mockListSessions: vi.fn(),
  mockHandleSessionHelp: vi.fn().mockReturnValue('session help text'),
  mockIsDaemonRunning: vi.fn().mockResolvedValue(true),
  mockForwardSessionCreate: vi.fn(),
  mockForwardSessionClose: vi.fn(),
  mockForwardSessionList: vi.fn(),
  mockStartDaemonProcess: vi.fn(),
  mockStopDaemonProcess: vi.fn(),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/session/session-client.js', () => ({
  closeSession: mockCloseSession,
  listSessions: mockListSessions,
}));

vi.mock('../../src/builtins/index.js', () => ({
  handleSessionHelp: mockHandleSessionHelp,
}));

vi.mock('../../src/client/daemon-client.js', () => ({
  isDaemonRunning: mockIsDaemonRunning,
  forwardSessionCreate: mockForwardSessionCreate,
  forwardSessionClose: mockForwardSessionClose,
  forwardSessionList: mockForwardSessionList,
}));

vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: mockStartDaemonProcess,
  stopDaemonProcess: mockStopDaemonProcess,
}));

import { handleSession } from '../../src/cli/session-routes.js';

describe('session-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
    // Daemon is running by default
    mockIsDaemonRunning.mockResolvedValue(true);
  });

  // ── open ──

  it('should open a session with url and default name', async () => {
    mockForwardSessionCreate.mockResolvedValue({ id: '1', name: 'default', url: 'https://example.com' });
    await handleSession(['open', 'https://example.com'], {}, 'json');
    expect(mockForwardSessionCreate).toHaveBeenCalledWith('default', 'https://example.com', undefined);
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, name: 'default' }),
      'json'
    );
  });

  it('should open a session with custom name', async () => {
    mockForwardSessionCreate.mockResolvedValue({ id: '2', name: 'my-session', url: 'https://example.com' });
    await handleSession(['open', 'https://example.com'], { name: 'my-session' }, 'text');
    expect(mockForwardSessionCreate).toHaveBeenCalledWith('my-session', 'https://example.com', undefined);
  });

  it('should output error when open has no url', async () => {
    await expect(handleSession(['open'], {}, 'text')).rejects.toThrow('EXIT');
    expect(mockOutputError).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('should pass cdpEndpoint to forwardSessionCreate', async () => {
    mockForwardSessionCreate.mockResolvedValue({ id: '3', name: 'default', url: 'https://example.com' });
    await handleSession(['open', 'https://example.com'], {}, 'text', 'http://localhost:9222');
    expect(mockForwardSessionCreate).toHaveBeenCalledWith('default', 'https://example.com', 'http://localhost:9222');
  });

  // ── close ──

  it('should close a session with default name', async () => {
    mockForwardSessionClose.mockResolvedValue({ ok: true });
    await handleSession(['close'], {}, 'json');
    expect(mockForwardSessionClose).toHaveBeenCalledWith('default');
    expect(mockCloseSession).toHaveBeenCalledWith('default');
    expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, name: 'default' }, 'json');
  });

  it('should close a session with custom name', async () => {
    mockForwardSessionClose.mockResolvedValue({ ok: true });
    await handleSession(['close'], { name: 'my-session' }, 'text');
    expect(mockForwardSessionClose).toHaveBeenCalledWith('my-session');
    expect(mockCloseSession).toHaveBeenCalledWith('my-session');
    expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, name: 'my-session' }, 'text');
  });

  // ── list ──

  it('should list sessions', async () => {
    mockForwardSessionList.mockResolvedValue([{ id: '1', name: 'default', url: 'https://example.com' }]);
    await handleSession(['list'], {}, 'json');
    expect(mockForwardSessionList).toHaveBeenCalled();
    expect(mockOutputResult).toHaveBeenCalledWith(
      { sessions: [{ id: '1', name: 'default', url: 'https://example.com' }] },
      'json'
    );
  });

  it('should list sessions with ls alias', async () => {
    mockForwardSessionList.mockResolvedValue([]);
    await handleSession(['ls'], {}, 'json');
    expect(mockForwardSessionList).toHaveBeenCalled();
  });

  it('should fallback to session-client when daemon list fails', async () => {
    mockForwardSessionList.mockRejectedValue(new Error('daemon down'));
    mockListSessions.mockResolvedValue([{ id: '2', name: 'fallback' }]);
    await handleSession(['list'], {}, 'json');
    expect(mockListSessions).toHaveBeenCalled();
  });

  // ── kill ──

  it('should kill a session (close + daemon stop)', async () => {
    mockForwardSessionClose.mockResolvedValue({ ok: true });
    await handleSession(['kill'], { name: 'test' }, 'json');
    expect(mockForwardSessionClose).toHaveBeenCalledWith('test');
    expect(mockCloseSession).toHaveBeenCalledWith('test');
    expect(mockStopDaemonProcess).toHaveBeenCalled();
    expect(mockOutputResult).toHaveBeenCalledWith(
      { ok: true, name: 'test', killed: true, daemon: 'stopped' },
      'json'
    );
  });

  // ── unknown subcommand ──

  it('should show help for unknown subcommand', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleSession(['unknown'], {}, 'text');
    expect(mockHandleSessionHelp).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  // ── XBROWSER_SESSION env var ──

  it('should use XBROWSER_SESSION as default name for close', async () => {
    mockForwardSessionClose.mockResolvedValue({ ok: true });
    process.env.XBROWSER_SESSION = 'env-close';
    try {
      await handleSession(['close'], {}, 'json');
      expect(mockForwardSessionClose).toHaveBeenCalledWith('env-close');
      expect(mockCloseSession).toHaveBeenCalledWith('env-close');
    } finally {
      delete process.env.XBROWSER_SESSION;
    }
  });

  it('should use XBROWSER_SESSION as default name for kill', async () => {
    mockForwardSessionClose.mockResolvedValue({ ok: true });
    process.env.XBROWSER_SESSION = 'env-kill';
    try {
      await handleSession(['kill'], {}, 'json');
      expect(mockForwardSessionClose).toHaveBeenCalledWith('env-kill');
      expect(mockCloseSession).toHaveBeenCalledWith('env-kill');
    } finally {
      delete process.env.XBROWSER_SESSION;
    }
  });

  it('should prefer --name over XBROWSER_SESSION', async () => {
    mockForwardSessionClose.mockResolvedValue({ ok: true });
    process.env.XBROWSER_SESSION = 'env-name';
    try {
      await handleSession(['close'], { name: 'flag-name' }, 'json');
      expect(mockForwardSessionClose).toHaveBeenCalledWith('flag-name');
    } finally {
      delete process.env.XBROWSER_SESSION;
    }
  });
});
