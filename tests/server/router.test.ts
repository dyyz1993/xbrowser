import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/executor.js', () => ({
  executeCommand: vi.fn().mockResolvedValue({
    success: true,
    data: { title: 'Test' },
    message: 'ok',
    duration: 10,
  }),
  executeChain: vi.fn().mockResolvedValue({
    success: true,
    steps: [],
    totalDuration: 5,
    stoppedAt: null,
    stoppedReason: null,
  }),
}));

vi.mock('../../src/browser.js', () => ({
  findSession: vi.fn(() => null),
  getAllSessions: vi.fn(() => []),
  findOrRestoreSession: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockImplementation((name: string) =>
    Promise.resolve({
      id: 'sess-1',
      name,
      page: { url: () => 'about:blank' },
      createdAt: new Date().toISOString(),
      isCDP: false,
    }),
  ),
  closeSessionByName: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/commands/index.js', () => ({
  getCommand: vi.fn(() => ({
    name: 'screenshot',
    description: 'Take a screenshot',
    scope: 'read',
    execute: vi.fn(),
  })),
  getAllCommands: vi.fn(() => [
    { name: 'screenshot', description: 'Take a screenshot', scope: 'read' },
    { name: 'title', description: 'Get page title', scope: 'read' },
  ]),
}));

describe('server/router', () => {
  let route: typeof import('../../src/server/router.js').route;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../src/server/router.js');
    route = mod.route;
  });

  it('handles OPTIONS request with 204 and CORS headers for loopback origins', async () => {
    const res = await route('OPTIONS', '/api/v1/health', { origin: 'http://localhost:3000' }, null);
    expect(res.statusCode).toBe(204);
    expect(res.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'http://localhost:3000',
      'Access-Control-Allow-Methods': expect.any(String),
    });
  });

  it('grants no CORS headers to non-loopback origins by default', async () => {
    const res = await route('OPTIONS', '/api/v1/health', { origin: 'https://evil.example' }, null);
    expect(res.statusCode).toBe(204);
    expect(res.headers?.['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('reflects explicit allowlist origins when configured', async () => {
    const res = await route(
      'OPTIONS',
      '/api/v1/health',
      { origin: 'https://app.example' },
      null,
      ['https://app.example'],
    );
    expect(res.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'https://app.example',
    });
  });

  it('allows wildcard only when explicitly configured', async () => {
    const res = await route(
      'OPTIONS',
      '/api/v1/health',
      { origin: 'https://anything.example' },
      null,
      ['*'],
    );
    expect(res.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'https://anything.example',
    });
  });

  it('returns health status for GET /api/v1/health', async () => {
    const res = await route('GET', '/api/v1/health', {}, null);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('returns command list for GET /api/v1/commands', async () => {
    const res = await route('GET', '/api/v1/commands', {}, null);
    expect(res.statusCode).toBe(200);
    const body = res.body as { commands: Array<{ name: string }> };
    expect(body.commands).toBeInstanceOf(Array);
    expect(body.commands.length).toBeGreaterThan(0);
  });

  it('returns session list for GET /api/v1/sessions', async () => {
    const res = await route('GET', '/api/v1/sessions', {}, null);
    expect(res.statusCode).toBe(200);
    const body = res.body as { sessions: unknown[] };
    expect(body.sessions).toBeInstanceOf(Array);
  });

  it('creates session for POST /api/v1/sessions', async () => {
    const res = await route('POST', '/api/v1/sessions', {}, { name: 'test-session' });
    expect(res.statusCode).toBe(201);
    const body = res.body as { name: string };
    expect(body.name).toBe('test-session');
  });

  it('returns 400 for POST /api/v1/sessions without name', async () => {
    const res = await route('POST', '/api/v1/sessions', {}, {});
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('closes session for DELETE /api/v1/sessions/:name', async () => {
    const res = await route('DELETE', '/api/v1/sessions/my-session', {}, null);
    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('executes command for POST /api/v1/exec', async () => {
    const res = await route('POST', '/api/v1/exec', {}, { command: 'screenshot' });
    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns 400 for POST /api/v1/exec without command', async () => {
    const res = await route('POST', '/api/v1/exec', {}, {});
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('returns 404 for POST /api/v1/exec with unknown command', async () => {
    const { getCommand } = await import('../../src/commands/index.js');
    vi.mocked(getCommand).mockReturnValueOnce(null);

    const res = await route('POST', '/api/v1/exec', {}, { command: 'nonexistent' });
    expect(res.statusCode).toBe(404);
    const body = res.body as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  it('executes chain for POST /api/v1/chain', async () => {
    const res = await route('POST', '/api/v1/chain', {}, { chain: 'goto https://example.com && title' });
    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns 400 for POST /api/v1/chain without chain', async () => {
    const res = await route('POST', '/api/v1/chain', {}, {});
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('returns 404 for GET /api/v1/nonexistent', async () => {
    const res = await route('GET', '/api/v1/nonexistent', {}, null);
    expect(res.statusCode).toBe(404);
    const body = res.body as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  it('returns 405 for POST /api/v1/health', async () => {
    const res = await route('POST', '/api/v1/health', {}, null);
    expect(res.statusCode).toBe(405);
    const body = res.body as { error: string };
    expect(body.error).toBe('METHOD_NOT_ALLOWED');
  });

  // ── Request-entry gates (origin + content-type), enforced BEFORE handlers ──

  describe('origin gate', () => {
    it('rejects disallowed Origin with 403 before any executor runs', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route(
        'POST',
        '/api/v1/exec',
        { origin: 'https://evil.example' },
        { command: 'screenshot' },
      );
      expect(res.statusCode).toBe(403);
      expect(executeCommand).not.toHaveBeenCalled();
    });

    it('rejects disallowed Origin on GET routes too (no session listing leak)', async () => {
      const { getAllSessions } = await import('../../src/browser.js');
      const res = await route('GET', '/api/v1/sessions', { origin: 'https://evil.example' }, null);
      expect(res.statusCode).toBe(403);
      expect(getAllSessions).not.toHaveBeenCalled();
    });

    it('rejects disallowed Origin before session creation', async () => {
      const { createSession } = await import('../../src/browser.js');
      const res = await route(
        'POST',
        '/api/v1/sessions',
        { origin: 'https://evil.example' },
        { name: 'pwned' },
      );
      expect(res.statusCode).toBe(403);
      expect(createSession).not.toHaveBeenCalled();
    });

    it('allows requests without Origin (CLI clients like xbrowser remote)', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route('POST', '/api/v1/exec', {}, { command: 'screenshot' });
      expect(res.statusCode).toBe(200);
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });

    it('allows loopback Origin and reaches the executor', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route(
        'POST',
        '/api/v1/exec',
        { origin: 'http://localhost:3000' },
        { command: 'screenshot' },
      );
      expect(res.statusCode).toBe(200);
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });

    it('allows explicit allowlist Origin and reaches the executor', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route(
        'POST',
        '/api/v1/exec',
        { origin: 'https://app.example' },
        { command: 'screenshot' },
        ['https://app.example'],
      );
      expect(res.statusCode).toBe(200);
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });

    it('OPTIONS preflight is exempt from the origin gate (no executor either way)', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route('OPTIONS', '/api/v1/exec', { origin: 'https://evil.example' }, null);
      expect(res.statusCode).toBe(204);
      expect(executeCommand).not.toHaveBeenCalled();
    });
  });

  describe('content-type gate', () => {
    it('rejects text/plain POST with 415 before the executor runs', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route(
        'POST',
        '/api/v1/exec',
        { 'content-type': 'text/plain' },
        { command: 'screenshot' },
      );
      expect(res.statusCode).toBe(415);
      expect(executeCommand).not.toHaveBeenCalled();
    });

    it('rejects form-urlencoded POST (HTML form CSRF surface)', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route(
        'POST',
        '/api/v1/exec',
        { 'content-type': 'application/x-www-form-urlencoded' },
        'command=screenshot',
      );
      expect(res.statusCode).toBe(415);
      expect(executeCommand).not.toHaveBeenCalled();
    });

    it('rejects multipart/form-data POST', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route(
        'POST',
        '/api/v1/exec',
        { 'content-type': 'multipart/form-data; boundary=x' },
        {},
      );
      expect(res.statusCode).toBe(415);
      expect(executeCommand).not.toHaveBeenCalled();
    });

    it('accepts application/json with charset parameter', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route(
        'POST',
        '/api/v1/exec',
        { 'content-type': 'application/json; charset=utf-8' },
        { command: 'screenshot' },
      );
      expect(res.statusCode).toBe(200);
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });

    it('accepts POST without Content-Type header (legacy clients)', async () => {
      const { executeCommand } = await import('../../src/executor.js');
      const res = await route('POST', '/api/v1/exec', {}, { command: 'screenshot' });
      expect(res.statusCode).toBe(200);
      expect(executeCommand).toHaveBeenCalledTimes(1);
    });

    it('GET routes are not affected by the content-type gate', async () => {
      const { getAllSessions } = await import('../../src/browser.js');
      const res = await route('GET', '/api/v1/sessions', { 'content-type': 'text/plain' }, null);
      expect(res.statusCode).toBe(200);
      expect(getAllSessions).toHaveBeenCalledTimes(1);
    });
  });
});
