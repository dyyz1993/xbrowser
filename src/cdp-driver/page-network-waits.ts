import type { CDPConnection } from './connection.js';
import type { XBRequest, XBResponse } from './types.js';
import { createResponsePredicate, createRequestPredicate, createXBResponse, createXBRequest, matchGlob, type PageLike } from './page-helpers.js';
import type { WaitUntilState } from './types.js';

export class NetworkWaitService {
  constructor(private readonly options: {
    conn: CDPConnection;
    sessionId: string;
    responses: Map<string, { requestId: string; status: number; url: string; headers: Record<string, string> }>;
    requests: Map<string, { requestId: string; url: string; method: string; headers: Record<string, string>; postData: string | null; resourceType: string }>;
    on(eventName: 'response' | 'request' | 'framenavigated', handler: (...args: unknown[]) => void): void;
    off(eventName: 'response' | 'request' | 'framenavigated', handler: (...args: unknown[]) => void): void;
    currentUrl(): string;
  }) {}

  // ── waitForResponse ─────────────────────────────────────────

  async waitForResponse(
    urlOrPredicate: string | RegExp | ((response: XBResponse) => boolean),
    opts: { timeout?: number } = {},
  ): Promise<XBResponse> {
    const timeout = opts.timeout ?? 30000;
    const predicate = createResponsePredicate(urlOrPredicate);

    // Check existing responses
    for (const [, data] of this.options.responses) {
      const response = createXBResponse(data, this.options.conn, this.options.sessionId);
      if (predicate(response)) return response;
    }

    // Wait for future responses
    return new Promise<XBResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.options.off('response', handler);
        reject(new Error(`waitForResponse timed out after ${timeout}ms`));
      }, timeout);

      const handler = (params: unknown): void => {
        // Handle both raw CDP format and pre-built XBResponse objects
        let response: XBResponse;
        const respObj = params as { requestId?: string; response?: { status?: number; url?: string; headers?: Record<string, string> } };
        if (respObj.response) {
          const data = {
            requestId: respObj.requestId || '',
            status: respObj.response.status || 0,
            url: respObj.response.url || '',
            headers: respObj.response.headers || {},
          };
          response = createXBResponse(data, this.options.conn, this.options.sessionId);
        } else if (typeof (params as XBResponse).status === 'function') {
          response = params as XBResponse;
        } else {
          return;
        }
        if (predicate(response)) {
          clearTimeout(timer);
          this.options.off('response', handler);
          resolve(response);
        }
      };

      this.options.on('response', handler);
    });
  }

  // ── waitForRequest ──────────────────────────────────────────

  async waitForRequest(
    urlOrPredicate: string | RegExp | ((request: XBRequest) => boolean),
    opts: { timeout?: number } = {},
  ): Promise<XBRequest> {
    const timeout = opts.timeout ?? 30000;
    const predicate = createRequestPredicate(urlOrPredicate);

    // Check existing requests
    for (const [, data] of this.options.requests) {
      const request = createXBRequest(this.pageLike(), data);
      if (predicate(request)) return request;
    }

    // Wait for future requests
    return new Promise<XBRequest>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.options.off('request', handler);
        reject(new Error(`waitForRequest timed out after ${timeout}ms`));
      }, timeout);

      const handler = (params: unknown): void => {
        // Handle both raw CDP format and pre-built XBRequest objects
        let request: XBRequest;
        const reqObj = params as { requestId?: string; request?: { url?: string; method?: string; headers?: Record<string, string>; postData?: string }; type?: string };
        if (reqObj.request) {
          request = createXBRequest(this.pageLike(), {
            requestId: reqObj.requestId || '',
            url: reqObj.request.url || '',
            method: reqObj.request.method || '',
            headers: reqObj.request.headers || {},
            postData: reqObj.request.postData ?? null,
            resourceType: reqObj.type || '',
          });
        } else if (typeof (params as XBRequest).url === 'function') {
          request = params as XBRequest;
        } else {
          return;
        }
        if (predicate(request)) {
          clearTimeout(timer);
          this.options.off('request', handler);
          resolve(request);
        }
      };

      this.options.on('request', handler);
    });
  }

  // ── waitForURL ──────────────────────────────────────────────

  async waitForURL(
    url: string | RegExp | ((url: string) => boolean),
    opts: { timeout?: number; waitUntil?: WaitUntilState } = {},
  ): Promise<void> {
    const timeout = opts.timeout ?? 30000;
    const checkFn = typeof url === 'function'
      ? url
      : typeof url === 'string'
        ? (current: string) => matchGlob(url, current)
        : (current: string) => url.test(current);

    // Check current URL
    if (checkFn(this.options.currentUrl())) return;

    // Wait for URL change
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.options.off('framenavigated', handler);
        reject(new Error(`waitForURL timed out after ${timeout}ms`));
      }, timeout);

      const handler = (): void => {
        if (checkFn(this.options.currentUrl())) {
          clearTimeout(timer);
          this.options.off('framenavigated', handler);
          resolve();
        }
      };

      this.options.on('framenavigated', handler);
    });
  }

  private pageLike(): PageLike {
    return {
      _networkResponses: this.options.responses,
      _connection: this.options.conn,
      sessionId: this.options.sessionId,
    };
  }
}
