import type { CDPConnection } from './connection.js';
import { createXBRequest, createXBResponse } from './page-helpers.js';

export interface NetworkEventState {
  inflightRequests: Set<string>;
}

export function setupNetworkEvents(options: {
  conn: CDPConnection;
  sessionId: string;
  state: NetworkEventState;
  emit(event: string, ...args: unknown[]): void;
  storeRequest(requestId: string, data: { url: string; method: string; headers: Record<string, string>; postData: string | null; resourceType: string }): void;
  storeResponse(requestId: string, data: { status: number; url: string; headers: Record<string, string> }): void;
  checkNetworkIdle(): void;
  addSubscription(unsubscribe: () => void): void;
}): void {
    options.addSubscription(
      options.conn.subscribe('Network.requestWillBeSent', options.sessionId, (params: unknown) => {
        const p = params as {
          requestId: string;
          request: { url: string; method: string; headers: Record<string, string>; postData?: string };
          type: string;
        };
        options.state.inflightRequests.add(p.requestId);
        options.storeRequest(p.requestId, {
          url: p.request.url,
          method: p.request.method,
          headers: p.request.headers,
          postData: p.request.postData ?? null,
          resourceType: p.type,
        });
        options.emit('request', createXBRequest(
          null,
          { requestId: p.requestId, url: p.request.url, method: p.request.method,
            headers: p.request.headers, postData: p.request.postData ?? null, resourceType: p.type },
        ));
        options.checkNetworkIdle();
      }),
    );

    options.addSubscription(
      options.conn.subscribe('Network.responseReceived', options.sessionId, (params: unknown) => {
        const p = params as {
          requestId: string;
          type: string;
          response: {
            status: number;
            url: string;
            headers: Record<string, string>;
            mimeType: string;
          };
        };
        options.storeResponse(p.requestId, {
          status: p.response.status,
          url: p.response.url,
          headers: p.response.headers,
        });
        options.emit('response', createXBResponse(
          { requestId: p.requestId, status: p.response.status, url: p.response.url, headers: p.response.headers },
          options.conn,
          options.sessionId,
        ));
      }),
    );

    options.addSubscription(
      options.conn.subscribe('Network.loadingFinished', options.sessionId, (params: unknown) => {
        const p = params as { requestId: string };
        options.state.inflightRequests.delete(p.requestId);
        options.emit('requestfinished', p);
        options.checkNetworkIdle();
      }),
    );

    options.addSubscription(
      options.conn.subscribe('Network.loadingFailed', options.sessionId, (params: unknown) => {
        const p = params as { requestId: string };
        options.state.inflightRequests.delete(p.requestId);
        options.checkNetworkIdle();
      }),
    );
}
