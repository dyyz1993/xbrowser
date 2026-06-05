/**
 * Page Helpers — Utility functions extracted from page.ts
 *
 * Glob matching, network response/request factories, and route creation.
 * Separated to keep page.ts focused on core page operations.
 */

import type { CDPConnection } from './connection.js';
import type { XBResponse, XBRequest, XBRoute } from './types.js';

// ── Types ─────────────────────────────────────────────────────

/**
 * Minimal interface for the page object used by helper functions.
 * Avoids circular dependency with page.ts.
 */
export interface PageLike {
  _networkResponses: Map<string, { requestId: string; status: number; url: string; headers: Record<string, string> }>;
  _connection: CDPConnection;
  sessionId: string;
}

export interface FetchPausedParams {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
  };
  resourceType: string;
  responseStatusCode?: number;
  responseHeaders?: Record<string, string>;
}

// ── Glob Matching ─────────────────────────────────────────────

export function globToRegex(glob: string): RegExp {
  // Convert glob pattern to RegExp
  // ** → .*, * → [^/]*, ? → .
  let pattern = glob
    .replace(/[\\^${}()|[\]+]/g, '\\$&')
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '.');

  // If pattern doesn't start with a protocol, allow any prefix
  if (!pattern.startsWith('http') && !pattern.startsWith('\\.')) {
    pattern = '.*' + pattern;
  }

  return new RegExp('^' + pattern + '$', 'i');
}

export function matchGlob(pattern: string, url: string): boolean {
  return globToRegex(pattern).test(url);
}

// ── Predicate Factories ───────────────────────────────────────

export function createResponsePredicate(
  urlOrPredicate: string | RegExp | ((response: XBResponse) => boolean),
): (response: XBResponse) => boolean {
  if (typeof urlOrPredicate === 'function') {
    return urlOrPredicate as (response: XBResponse) => boolean;
  }
  if (urlOrPredicate instanceof RegExp) {
    return (resp: XBResponse) => urlOrPredicate.test(resp.url());
  }
  // String — glob pattern
  const regex = globToRegex(urlOrPredicate);
  return (resp: XBResponse) => regex.test(resp.url());
}

export function createRequestPredicate(
  urlOrPredicate: string | RegExp | ((request: XBRequest) => boolean),
): (request: XBRequest) => boolean {
  if (typeof urlOrPredicate === 'function') {
    return urlOrPredicate as (request: XBRequest) => boolean;
  }
  if (urlOrPredicate instanceof RegExp) {
    return (req: XBRequest) => urlOrPredicate.test(req.url());
  }
  const regex = globToRegex(urlOrPredicate);
  return (req: XBRequest) => regex.test(req.url());
}

// ── XBResponse / XBRequest Factories ─────────────────────────

export function createXBResponse(
  data: { requestId: string; status: number; url: string; headers: Record<string, string> },
  conn?: CDPConnection,
  sessionId?: string,
  requestData?: { requestId: string; url: string; method: string; headers: Record<string, string>; postData: string | null; resourceType: string },
): XBResponse {
  const request = requestData
    ? createXBRequest(null, requestData)
    : createXBRequest(null, { requestId: data.requestId, url: data.url, method: 'GET', headers: {}, postData: null, resourceType: 'other' });
  return {
    status: () => data.status,
    statusText: () => '',
    url: () => data.url,
    headers: () => data.headers,
    ok: () => data.status >= 200 && data.status < 300,
    body: async () => {
      if (!conn) throw new Error('Response body not available');
      try {
        const resp = await conn.send<{ body: string; base64Encoded: boolean }>(
          'Network.getResponseBody',
          { requestId: data.requestId },
          sessionId,
        );
        return Buffer.from(resp.body, resp.base64Encoded ? 'base64' : 'utf8');
      } catch {
        throw new Error('Response body not available');
      }
    },
    text: async () => {
      if (!conn) throw new Error('Response body not available');
      try {
        const resp = await conn.send<{ body: string; base64Encoded: boolean }>(
          'Network.getResponseBody',
          { requestId: data.requestId },
          sessionId,
        );
        return resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf8') : resp.body;
      } catch {
        throw new Error('Response body not available');
      }
    },
    json: async () => {
      const text = await (async () => {
        if (!conn) throw new Error('Response body not available');
        try {
          const resp = await conn.send<{ body: string; base64Encoded: boolean }>(
            'Network.getResponseBody',
            { requestId: data.requestId },
            sessionId,
          );
          return resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf8') : resp.body;
        } catch {
          throw new Error('Response body not available');
        }
      })();
      return JSON.parse(text);
    },
    request: () => request,
  };
}

export function createXBRequest(
  page: PageLike | null,
  data: { requestId: string; url: string; method: string; headers: Record<string, string>; postData: string | null; resourceType: string },
): XBRequest {
  return {
    url: () => data.url,
    method: () => data.method,
    headers: () => data.headers,
    postData: () => data.postData,
    resourceType: () => data.resourceType,
    response: async () => {
      if (!page?._networkResponses) return null;
      const resp = page._networkResponses.get(data.requestId);
      if (!resp) return null;
      return createXBResponse(resp, page._connection, page.sessionId, data);
    },
  };
}

// ── XBRoute Factory (Fetch domain) ───────────────────────────

export function createXBRouteFetch(
  conn: CDPConnection,
  sessionId: string,
  params: FetchPausedParams,
): XBRoute {
  const request = createXBRequest(null, {
    requestId: params.requestId,
    url: params.request.url,
    method: params.request.method,
    headers: params.request.headers,
    postData: params.request.postData ?? null,
    resourceType: params.resourceType,
  });

  return {
    request: () => request,
    abort: async (errorCode?: string) => {
      await conn.send('Fetch.failRequest', {
        requestId: params.requestId,
        errorReason: errorCode || 'Failed',
      }, sessionId);
    },
    continue: async (opts?: { url?: string; method?: string; headers?: Record<string, string>; postData?: string }) => {
      await conn.send('Fetch.continueRequest', {
        requestId: params.requestId,
        url: opts?.url,
        method: opts?.method,
        headers: opts?.headers ? Object.entries(opts.headers).map(([k, v]) => ({ name: k, value: v })) : undefined,
        postData: opts?.postData ? Buffer.from(opts.postData).toString('base64') : undefined,
      }, sessionId);
    },
    fulfill: async (opts: { status?: number; headers?: Record<string, string>; body?: string | Buffer; contentType?: string }) => {
      const bodyStr = typeof opts.body === 'string' ? opts.body : (opts.body ? opts.body.toString('utf8') : '');
      const bodyBytes = Buffer.from(bodyStr, 'utf8');
      const headers: Record<string, string> = { ...opts.headers };
      if (opts.contentType) headers['content-type'] = opts.contentType;
      headers['access-control-allow-origin'] = '*';

      await conn.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: opts.status ?? 200,
        responseHeaders: Object.entries(headers).map(([k, v]) => ({ name: k, value: v })),
        body: bodyBytes.toString('base64'),
      }, sessionId);
    },
  };
}
