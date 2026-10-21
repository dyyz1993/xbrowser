import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { outputError, outputResult } from '../cli/output.js';
import { buildConsoleOverview } from './facade.js';
import { renderOverviewHtml } from './overview-template.js';

const DEFAULT_PORT = 9225;

function parsePort(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : DEFAULT_PORT;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, null, 2));
}

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function handleConsoleServe(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
): Promise<void> {
  const port = parsePort(options.port ?? args[0]);
  const server: Server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    try {
      if (pathname === '/health') {
        sendJson(response, 200, { ok: true, readonly: true });
        return;
      }
      if (pathname !== '/' && pathname !== '/overview' && pathname !== '/api/overview') {
        sendJson(response, 404, { error: 'NOT_FOUND', readonly: true });
        return;
      }
      const body = request.method === 'POST' ? await readJson(request) : {};
      const overview = await buildConsoleOverview({
        recentSession: typeof body.recentSession === 'string' ? body.recentSession : undefined,
        includeEvidence: body.includeEvidence !== false,
      });
      if (pathname === '/api/overview' || request.headers.accept?.includes('application/json')) {
        sendJson(response, 200, overview);
      } else {
        sendHtml(response, renderOverviewHtml(overview));
      }
    } catch (error) {
      sendJson(response, 500, {
        error: 'CONSOLE_FACADE_ERROR',
        message: error instanceof Error ? error.message : String(error),
        readonly: true,
      });
    }
  });

  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  server.listen(port, '127.0.0.1', () => {
    const output = {
      ok: true,
      readonly: true,
      url: `http://127.0.0.1:${port}`,
      endpoints: ['GET /', 'GET /overview', 'GET|POST /api/overview', 'GET /health'],
    };
    if (mode === 'json') outputResult(output, mode);
    else {
      console.log(`\n  Console Facade (readonly): ${output.url}`);
      console.log('  Endpoints: /overview, /api/overview, /health');
      console.log('  Press Ctrl+C to stop\n');
    }
  });

  if (process.env.NODE_ENV === 'test') {
    (handleConsoleServe as unknown as { __serverForTests?: Server }).__serverForTests = server;
  }

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') outputError(`Console port ${port} is already in use`);
    else outputError(error.message);
    process.exit(1);
  });
}
