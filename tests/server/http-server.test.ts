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

async function createTestServer(config?: { port?: number; tokens?: string[] }) {
  const server = new HTTPServer({
    host: '127.0.0.1',
    port: config?.port ?? randomPort(),
    tokens: config?.tokens,
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
});
