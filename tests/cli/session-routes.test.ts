import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockOpenSession,
  mockCloseSession,
  mockListSessions,
  mockHandleSessionHelp,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockOpenSession: vi.fn(),
  mockCloseSession: vi.fn(),
  mockListSessions: vi.fn(),
  mockHandleSessionHelp: vi.fn().mockReturnValue('session help text'),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/session/session-client.js', () => ({
  openSession: mockOpenSession,
  closeSession: mockCloseSession,
  listSessions: mockListSessions,
}));

vi.mock('../../src/builtins/index.js', () => ({
  handleSessionHelp: mockHandleSessionHelp,
}));

import { handleSession } from '../../src/cli/session-routes.js';

describe('session-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
  });

  it('should open a session with url and default name', async () => {
    mockOpenSession.mockResolvedValue({ id: '1', name: 'default', url: 'https://example.com' });
    await handleSession(['open', 'https://example.com'], {}, 'json');
    expect(mockOpenSession).toHaveBeenCalledWith('default', 'https://example.com', { cdpEndpoint: undefined });
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, name: 'default' }),
      'json'
    );
  });

  it('should open a session with custom name', async () => {
    mockOpenSession.mockResolvedValue({ id: '2', name: 'my-session' });
    await handleSession(['open', 'https://example.com'], { name: 'my-session' }, 'text');
    expect(mockOpenSession).toHaveBeenCalledWith('my-session', 'https://example.com', { cdpEndpoint: undefined });
  });

  it('should output error when open has no url', async () => {
    await expect(handleSession(['open'], {}, 'text')).rejects.toThrow('EXIT');
    expect(mockOutputError).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('should close a session with default name', async () => {
    mockCloseSession.mockResolvedValue(undefined);
    await handleSession(['close'], {}, 'json');
    expect(mockCloseSession).toHaveBeenCalledWith('default');
    expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, name: 'default' }, 'json');
  });

  it('should close a session with custom name', async () => {
    mockCloseSession.mockResolvedValue(undefined);
    await handleSession(['close'], { name: 'my-session' }, 'text');
    expect(mockCloseSession).toHaveBeenCalledWith('my-session');
    expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, name: 'my-session' }, 'text');
  });

  it('should list sessions', async () => {
    mockListSessions.mockResolvedValue([{ id: '1', name: 'default' }]);
    await handleSession(['list'], {}, 'json');
    expect(mockListSessions).toHaveBeenCalled();
    expect(mockOutputResult).toHaveBeenCalledWith(
      { sessions: [{ id: '1', name: 'default' }] },
      'json'
    );
  });

  it('should list sessions with ls alias', async () => {
    mockListSessions.mockResolvedValue([]);
    await handleSession(['ls'], {}, 'json');
    expect(mockListSessions).toHaveBeenCalled();
  });

  it('should kill a session', async () => {
    mockCloseSession.mockResolvedValue(undefined);
    await handleSession(['kill'], { name: 'test' }, 'json');
    expect(mockCloseSession).toHaveBeenCalledWith('test');
    expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, name: 'test', killed: true }, 'json');
  });

  it('should show help for unknown subcommand', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleSession(['unknown'], {}, 'text');
    expect(mockHandleSessionHelp).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should pass cdpEndpoint to openSession', async () => {
    mockOpenSession.mockResolvedValue({ id: '3', name: 'default' });
    await handleSession(['open', 'https://example.com'], {}, 'text', 'http://localhost:9222');
    expect(mockOpenSession).toHaveBeenCalledWith('default', 'https://example.com', {
      cdpEndpoint: 'http://localhost:9222',
    });
  });
});
