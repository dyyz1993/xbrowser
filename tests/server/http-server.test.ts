import { describe, it, expect, afterAll } from 'vitest';
import { HTTPServer } from '../../src/server/http-server.js';
import http from 'http';

const randomPort = () => 10000 + Math.floor(Math.random() * 50000);

function request(
  port: number,
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<{ statusCode: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: headers ?? {},
      timeout: 5000,
    };

    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = raw;
        }
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          respHeaders[k] = Array.isArray(v) ? v.join(', ') : v ?? '';
        }
        resolve({ statusCode: res.statusCode ?? 0, body: parsed, headers: respHeaders });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const servers: HTTPServer[] = [];

async function createTestServer(config?: {
  port?: number;
  tokens?: string[];
  hostOverride?: string;
  corsOrigins?: string[];
}) {
  const server = new HTTPServer({
    host: config?.hostOverride ?? '127.0.0.1',
    port: config?.port ?? randomPort(),
    tokens: config?.tokens,
    corsOrigins: config?.corsOrigins,
  });
  servers.push(server);
  const addr = await server.start();
  return { server, port: addr.port };
}

afterAll(async () => {
  for (const s of servers) {
    try {
      await s.stop();
    } catch {}
  }
});

describe('HTTPServer', () => {
  it('starts and listens on configured port', async () => {
    const port = randomPort();
    const { port: actualPort } = await createTestServer({ port });
    expect(actualPort).toBe(port);
  });

  it('responds to health check', async () => {
    const { port } = await createTestServer();
    const res = await request(port, 'GET', '/api/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('succeeds without auth when no tokens configured', async () => {
    const { port } = await createTestServer();
    const res = await request(port, 'GET', '/api/v1/commands');
    expect(res.statusCode).toBe(200);
  });

  it('succeeds with valid token', async () => {
    const { port } = await createTestServer({ tokens: ['my-secret'] });
    const res = await request(port, 'GET', '/api/v1/commands', {
      Authorization: 'Bearer my-secret',
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 with invalid token', async () => {
    const { port } = await createTestServer({ tokens: ['my-secret'] });
    const res = await request(port, 'GET', '/api/v1/commands', {
      Authorization: 'Bearer wrong',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with no auth header when tokens configured', async () => {
    const { port } = await createTestServer({ tokens: ['my-secret'] });
    const res = await request(port, 'GET', '/api/v1/commands');
    expect(res.statusCode).toBe(401);
  });

  it('throws error when started twice', async () => {
    const { server } = await createTestServer();
    await expect(server.start()).rejects.toThrow('already running');
  });

  it('stops gracefully', async () => {
    const { server, port } = await createTestServer();
    const res = await request(port, 'GET', '/api/v1/health');
    expect(res.statusCode).toBe(200);
    await server.stop();
    await expect(request(port, 'GET', '/api/v1/health')).rejects.toThrow();
  });

  it('stop when not running does not throw', async () => {
    const server = new HTTPServer({ host: '127.0.0.1', port: randomPort() });
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('returns null address when not running', () => {
    const server = new HTTPServer({ host: '127.0.0.1', port: randomPort() });
    expect(server.getAddress()).toBeNull();
  });

  it('returns address when running', async () => {
    const { server } = await createTestServer();
    const addr = server.getAddress();
    expect(addr).not.toBeNull();
    expect(addr!.port).toBeGreaterThan(0);
  });

  it('health check bypasses auth', async () => {
    const { port } = await createTestServer({ tokens: ['my-secret'] });
    const res = await request(port, 'GET', '/api/v1/health');
    expect(res.statusCode).toBe(200);
  });

  // ── P0-1: secure defaults ──

  it('defaults to loopback host when host is not configured', async () => {
    const server = new HTTPServer({ port: randomPort() });
    servers.push(server);
    const addr = await server.start();
    expect(addr.host).toBe('127.0.0.1');
  });

  it('refuses to start on non-loopback host without a token', async () => {
    const server = new HTTPServer({ host: '0.0.0.0', port: randomPort() });
    await expect(server.start()).rejects.toThrow(/token/i);
    expect(server.getAddress()).toBeNull();
  });

  it('starts on non-loopback host with a token; protected routes reject missing auth', async () => {
    const { port } = await createTestServer({ tokens: ['my-secret'], hostOverride: '0.0.0.0' });
    const noAuth = await request(port, 'GET', '/api/v1/commands');
    expect(noAuth.statusCode).toBe(401);
    const withAuth = await request(port, 'GET', '/api/v1/commands', {
      Authorization: 'Bearer my-secret',
    });
    expect(withAuth.statusCode).toBe(200);
  });

  it('health endpoint leaks no session or command data', async () => {
    const { port } = await createTestServer();
    const res = await request(port, 'GET', '/api/v1/health');
    expect(res.body).toEqual({ status: 'ok', timestamp: expect.any(String) });
  });

  // ── P0-1: CORS policy ──

  it('reflects loopback browser origins by default', async () => {
    const { port } = await createTestServer();
    const res = await request(port, 'GET', '/api/v1/health', {
      Origin: 'http://localhost:3000',
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not grant CORS to arbitrary web origins by default', async () => {
    const { port } = await createTestServer();
    const res = await request(port, 'GET', '/api/v1/health', {
      Origin: 'https://evil.example',
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('honors an explicit CORS allowlist for remote web clients', async () => {
    const { port } = await createTestServer({ corsOrigins: ['https://app.example'] });
    const allowed = await request(port, 'GET', '/api/v1/health', {
      Origin: 'https://app.example',
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
    const denied = await request(port, 'GET', '/api/v1/health', {
      Origin: 'https://other.example',
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  // ── Entry gates over real HTTP ──

  it('rejects disallowed Origin with 403 at the HTTP layer', async () => {
    const { port } = await createTestServer();
    const res = await request(port, 'POST', '/api/v1/sessions', {
      Origin: 'https://evil.example',
    }, { name: 'pwned' });
    expect(res.statusCode).toBe(403);
  });

  it('rejects text/plain POST with 415 at the HTTP layer', async () => {
    const { port } = await createTestServer();
    const res = await request(port, 'POST', '/api/v1/sessions', {
      'Content-Type': 'text/plain',
    }, JSON.stringify({ name: 'pwned' }));
    expect(res.statusCode).toBe(415);
  });

  it('keeps serving no-Origin JSON clients end to end', async () => {
    const { port } = await createTestServer();
    // Bad-request shape on purpose: proves the request traversed the gates
    // and reached the handler (400 from validation, not 403/415 from gates).
    const res = await request(port, 'POST', '/api/v1/sessions', {
      'Content-Type': 'application/json',
    }, { nonsense: true });
    expect(res.statusCode).toBe(400);
  });
});
