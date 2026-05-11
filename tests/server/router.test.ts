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

  it('handles OPTIONS request with 204 and CORS headers', async () => {
    const res = await route('OPTIONS', '/api/v1/health', {}, null);
    expect(res.statusCode).toBe(204);
    expect(res.headers).toMatchObject({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': expect.any(String),
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
});
