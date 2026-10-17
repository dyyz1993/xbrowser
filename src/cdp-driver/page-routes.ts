import type { CDPConnection } from './connection.js';
import type { XBRoute } from './types.js';
import { createXBRequest, createXBRouteFetch, globToRegex, type FetchPausedParams } from './page-helpers.js';

export class NetworkRouteService {
  constructor(private readonly options: {
    conn: CDPConnection;
    sessionId: string;
    emit(event: string, ...args: unknown[]): void;
  }) {}

  private routeHandlers: Array<{ pattern: string; regex: RegExp; handler: (route: XBRoute) => Promise<void> | void }> = [];
  private interceptionEnabled = false;
  get isInterceptionEnabled(): boolean { return this.interceptionEnabled; }
  private subscriptions: Array<() => void> = [];

  async route(
    url: string | RegExp,
    handler: (route: XBRoute) => Promise<void> | void,
  ): Promise<void> {
    const regex = typeof url === 'string' ? globToRegex(url) : url;
    this.routeHandlers.push({ pattern: String(url), regex, handler });

    if (!this.interceptionEnabled) {
      this.interceptionEnabled = true;
      await this.options.conn.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }],
        // sup-s9: 保留认证自动响应（Fetch.enable 为替换语义，不带此参数
        // 会顶掉 _init 的 auth 配置）
        handleAuthRequests: true,
      }, this.options.sessionId);

      this.subscriptions.push(
        this.options.conn.subscribe('Fetch.requestPaused', this.options.sessionId, (params: unknown) => {
          this._handleRequestPaused(params as FetchPausedParams);
        }),
      );
    }
  }

  async unroute(
    url: string | RegExp,
    handler?: (route: XBRoute) => Promise<void> | void,
  ): Promise<void> {
    const regex = typeof url === 'string' ? globToRegex(url) : url;
    this.routeHandlers = this.routeHandlers.filter(
      (h) => !(regex.source === h.regex.source && (!handler || h.handler === handler)),
    );

    if (this.routeHandlers.length === 0 && this.interceptionEnabled) {
      this.interceptionEnabled = false;
      await this.options.conn.send('Fetch.disable', undefined, this.options.sessionId).catch(() => {});
    }
  }

  private async _handleRequestPaused(params: FetchPausedParams): Promise<void> {
    const requestUrl = params.request.url;

    for (const { regex, handler } of this.routeHandlers) {
      if (regex.test(requestUrl)) {
        // Emit request event for waitForRequest listeners
        // (Fetch.requestPaused may not be preceded by Network.requestWillBeSent)
        this.options.emit('request', createXBRequest(
          null,
          { requestId: params.requestId, url: params.request.url,
            method: params.request.method,
            headers: params.request.headers,
            postData: params.request.postData ?? null, resourceType: params.resourceType },
        ));

        const route = createXBRouteFetch(this.options.conn, this.options.sessionId, params, undefined);
        try {
          await handler(route);
        } catch {
          // Handler threw — continue the request to prevent stalling
          await this.options.conn.send('Fetch.continueRequest', {
            requestId: params.requestId,
          }, this.options.sessionId).catch(() => {});
        }
        return;
      }
    }

    // No handler matched — continue the request
    await this.options.conn.send('Fetch.continueRequest', {
      requestId: params.requestId,
    }, this.options.sessionId).catch(() => {});
  }
}
