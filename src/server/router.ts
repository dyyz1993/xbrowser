import type { IncomingMessage, ServerResponse } from 'http';
import { executeCommand, executeChain } from '../executor.js';
import { findSession, findOrRestoreSession, getAllSessions, createSession, closeSessionByName } from '../browser.js';
import { getCommand, getAllCommands } from '../commands/index.js';
import type { APIRequest, APIResponse } from './types.js';

type RouteHandler = (req: APIRequest) => Promise<APIResponse>;

interface Route {
  method: string;
  pattern: string;
  paramNames: string[];
  handler: RouteHandler;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const routes: Route[] = [
  { method: 'GET', pattern: '/api/v1/health', paramNames: [], handler: healthCheck },
  { method: 'GET', pattern: '/api/v1/commands', paramNames: [], handler: listCommands },
  { method: 'GET', pattern: '/api/v1/sessions', paramNames: [], handler: listSessions },
  { method: 'POST', pattern: '/api/v1/sessions', paramNames: [], handler: createSessionHandler },
  { method: 'DELETE', pattern: '/api/v1/sessions/:name', paramNames: ['name'], handler: closeSession },
  { method: 'POST', pattern: '/api/v1/exec', paramNames: [], handler: execCommand },
  { method: 'POST', pattern: '/api/v1/chain', paramNames: [], handler: execChain },
];

function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;

    const patternParts = route.pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];
      const pathPart = pathParts[i];
      if (pp.startsWith(':')) {
        params[pp.slice(1)] = decodeURIComponent(pathPart);
      } else if (pp !== pathPart) {
        matched = false;
        break;
      }
    }

    if (matched) return { route, params };
  }

  return null;
}

function parseQueryString(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (!search || search === '?') return query;
  const str = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of str.split('&')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) {
      query[decodeURIComponent(pair)] = '';
    } else {
      query[decodeURIComponent(pair.slice(0, eqIndex))] = decodeURIComponent(pair.slice(eqIndex + 1));
    }
  }
  return query;
}

function jsonResponse(statusCode: number, body: unknown, extraHeaders?: Record<string, string>): APIResponse {
  return {
    statusCode,
    body,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  };
}

function errorResponse(statusCode: number, error: string, message: string): APIResponse {
  return jsonResponse(statusCode, { error, message, statusCode });
}

async function healthCheck(): Promise<APIResponse> {
  return jsonResponse(200, { status: 'ok', timestamp: new Date().toISOString() });
}

async function listCommands(): Promise<APIResponse> {
  const commands = getAllCommands().map((c) => ({
    name: c.name,
    description: c.description,
    scope: c.scope,
  }));
  return jsonResponse(200, { commands });
}

async function listSessions(): Promise<APIResponse> {
  const sessions = getAllSessions().map((s) => ({
    id: s.id,
    name: s.name,
    url: s.page?.url() ?? null,
    createdAt: s.createdAt,
    isCDP: s.isCDP ?? false,
  }));
  return jsonResponse(200, { sessions });
}

async function createSessionHandler(req: APIRequest): Promise<APIResponse> {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') {
    return errorResponse(400, 'BAD_REQUEST', 'Request body must be a JSON object');
  }

  const name = body.name;
  if (typeof name !== 'string' || !name) {
    return errorResponse(400, 'BAD_REQUEST', 'Field "name" is required');
  }

  const existing = findSession(name);
  if (existing) {
    return errorResponse(409, 'CONFLICT', `Session "${name}" already exists`);
  }

  const url = typeof body.url === 'string' ? body.url : undefined;
  const cdpEndpoint = typeof body.cdpEndpoint === 'string' ? body.cdpEndpoint : undefined;

  try {
    const session = await createSession(name, url, { cdpEndpoint });
    return jsonResponse(201, {
      id: session.id,
      name: session.name,
      url: session.page?.url() ?? null,
      createdAt: session.createdAt,
    });
  } catch (err) {
    return errorResponse(500, 'INTERNAL_ERROR', (err as Error).message);
  }
}

async function closeSession(req: APIRequest): Promise<APIResponse> {
  const name = req.params['name'];
  if (!name) {
    return errorResponse(400, 'BAD_REQUEST', 'Session name is required');
  }

  const closed = await closeSessionByName(name);
  if (!closed) {
    return errorResponse(404, 'NOT_FOUND', `Session "${name}" not found`);
  }

  return jsonResponse(200, { success: true, message: `Session "${name}" closed` });
}

async function execCommand(req: APIRequest): Promise<APIResponse> {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') {
    return errorResponse(400, 'BAD_REQUEST', 'Request body must be a JSON object');
  }

  const command = body.command;
  if (typeof command !== 'string' || !command) {
    return errorResponse(400, 'BAD_REQUEST', 'Field "command" is required');
  }

  const cmdDef = getCommand(command);
  if (!cmdDef) {
    return errorResponse(404, 'NOT_FOUND', `Unknown command: ${command}`);
  }

  const params = (typeof body.params === 'object' && body.params !== null ? body.params : {}) as Record<string, unknown>;
  const sessionName = typeof body.session === 'string' ? body.session : 'default';
  const cdpEndpoint = typeof body.cdpEndpoint === 'string' ? body.cdpEndpoint : undefined;

  // Ensure session exists before executing — prevents auto-created session
  // from being destroyed by executeCommand's finally block.
  await ensureSession(sessionName, params.url as string | undefined, cdpEndpoint);

  const start = Date.now();
  const result = await executeCommand(command, params, sessionName, cdpEndpoint ? { cdpEndpoint } : undefined);
  const duration = Date.now() - start;

  return jsonResponse(200, {
    success: result.success,
    data: result.data,
    message: result.message,
    duration: result.duration || duration,
  });
}

async function execChain(req: APIRequest): Promise<APIResponse> {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') {
    return errorResponse(400, 'BAD_REQUEST', 'Request body must be a JSON object');
  }

  const chain = body.chain;
  if (typeof chain !== 'string' || !chain) {
    return errorResponse(400, 'BAD_REQUEST', 'Field "chain" is required');
  }

  const sessionName = typeof body.session === 'string' ? body.session : 'default';
  const cdpEndpoint = typeof body.cdpEndpoint === 'string' ? body.cdpEndpoint : undefined;

  // executeChain handles session creation internally (creates if missing,
  // destroys only if it created one), so no need for ensureSession here.

  const result = await executeChain(chain, { sessionName, cdpEndpoint });

  return jsonResponse(200, {
    success: result.success,
    steps: result.steps,
    totalDuration: result.totalDuration,
    stoppedAt: result.stoppedAt,
    stoppedReason: result.stoppedReason,
  });
}

/**
 * Ensure a browser session exists for the given session name.
 *
 * If the session does not exist, creates one with the given URL and options.
 * This prevents `executeCommand` from auto-creating and then destroying the
 * session in its finally block — giving the HTTP API persistent sessions.
 *
 * @param sessionName - The session name to look up or create.
 * @param url - Optional URL to navigate to on creation.
 * @param cdpEndpoint - Optional CDP endpoint for browser connection.
 */
async function ensureSession(
  sessionName: string,
  url?: string,
  cdpEndpoint?: string,
): Promise<void> {
  const existing = await findOrRestoreSession(sessionName, cdpEndpoint);
  if (existing) return;

  await createSession(sessionName, url, cdpEndpoint ? { cdpEndpoint } : {});
}

/**
 * Check if the given URL path matches the health check endpoint.
 *
 * @param pathname - The URL pathname to check.
 * @returns `true` if the path is the health check endpoint.
 */
export function isHealthCheckPath(pathname: string): boolean {
  return pathname === '/api/v1/health';
}

/**
 * Dispatch an incoming HTTP request to the matching route handler.
 *
 * Parses the URL, matches against registered routes, and delegates to the
 * appropriate handler. Returns a 404 for unmatched routes and a 405 for
 * method mismatches.
 *
 * @param method - The HTTP method (GET, POST, DELETE, OPTIONS).
 * @param url - The full request URL including query string.
 * @param headers - Request headers.
 * @param body - Parsed request body.
 * @returns An {@link APIResponse} from the matched handler or an error response.
 */
export async function route(
  method: string,
  url: string,
  headers: Record<string, string | undefined>,
  body: unknown,
): Promise<APIResponse> {
  const parsedUrl = new URL(url, 'http://localhost');
  const pathname = parsedUrl.pathname;
  const query = parseQueryString(parsedUrl.search);

  if (method === 'OPTIONS') {
    return jsonResponse(204, null);
  }

  const match = matchRoute(method, pathname);
  if (!match) {
    const pathMatch = matchRoute('GET', pathname) || matchRoute('POST', pathname) || matchRoute('DELETE', pathname);
    if (pathMatch) {
      return errorResponse(405, 'METHOD_NOT_ALLOWED', `Method ${method} is not allowed for ${pathname}`);
    }
    return errorResponse(404, 'NOT_FOUND', `Route ${method} ${pathname} not found`);
  }

  const req: APIRequest = {
    method,
    url,
    headers,
    body,
    params: match.params,
    query,
  };

  try {
    return await match.route.handler(req);
  } catch (err) {
    return errorResponse(500, 'INTERNAL_ERROR', (err as Error).message);
  }
}

/**
 * Handle an incoming Node.js HTTP request and write the response.
 *
 * Reads the request body for POST/PUT methods, dispatches to the router,
 * and writes the response with appropriate status code, headers, and JSON body.
 *
 * @param req - The native Node.js incoming message.
 * @param res - The native Node.js server response.
 * @param validateAuthFn - Optional auth validation function; called for non-health-check routes.
 */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  validateAuthFn?: (authHeader: string | undefined) => boolean,
): Promise<void> {
  const url = req.url || '/';
  const method = (req.method || 'GET').toUpperCase();
  const pathname = new URL(url, 'http://localhost').pathname;

  if (method === 'OPTIONS') {
    const response = await route(method, url, headersToObject(req.headers), null);
    writeResponse(res, response);
    return;
  }

  if (validateAuthFn && !isHealthCheckPath(pathname)) {
    const authHeader = req.headers['authorization'];
    if (!validateAuthFn(authHeader)) {
      writeResponse(res, errorResponse(401, 'UNAUTHORIZED', 'Invalid or missing authentication token'));
      return;
    }
  }

  let body: unknown = null;
  if (method === 'POST' || method === 'PUT') {
    body = await readBody(req);
  }

  const response = await route(method, url, headersToObject(req.headers), body);
  writeResponse(res, response);
}

function headersToObject(headers: IncomingMessage['headers']): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

function writeResponse(res: ServerResponse, response: APIResponse): void {
  const headers = response.headers || {};
  res.writeHead(response.statusCode, headers);
  res.end(response.body !== null && response.body !== undefined ? JSON.stringify(response.body) : '');
}
