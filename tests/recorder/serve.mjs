/**
 * Simple HTTP server for recorder e2e tests.
 * Serves fixtures/ on two ports to simulate same-origin and cross-origin.
 *
 * Usage: node serve.mjs
 *   Server A: http://localhost:3847  (same origin)
 *   Server B: http://localhost:3848  (cross origin)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

function createHttpServer(port, label) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    let path = url.pathname === '/' ? '/page-a.html' : url.pathname;
    // Security: only serve files from fixtures/
    const filePath = join(new URL('.', import.meta.url).pathname, 'fixtures', path.replace(/^\//, ''));

    try {
      const data = await readFile(filePath);
      const mime = MIME[extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': `${mime}; charset=utf-8`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    console.log(`[${label}] http://localhost:${port}`);
  });

  return server;
}

const serverA = createHttpServer(3847, 'Server A');
const serverB = createHttpServer(3848, 'Server B (cross-origin)');

// Graceful shutdown
process.on('SIGINT', () => {
  serverA.close();
  serverB.close();
  process.exit(0);
});

// Keep alive
process.stdin.resume();
