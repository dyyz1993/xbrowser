import type { CDPConnection } from './connection.js';
import { queryJS } from './selector-utils.js';

export class DomQueryService {
  constructor(private readonly options: {
    conn: CDPConnection;
    sessionId: string;
    evaluate<T>(script: string): Promise<T>;
  }) {}

  /** Query a single element, returns CDP nodeId or 0 if not found */
  async querySelector(selector: string): Promise<number> {
    // For xpath selectors, use evaluate to find the element, then requestNode
    if (selector.startsWith('xpath=')) {
      const found = await this.options.evaluate<boolean>(`
        (() => { const el = ${queryJS(selector)}; return !!el; })()
      `).catch(() => false);
      if (!found) return 0;
      // Use DOM.performSearch as fallback to get nodeId for xpath
      try {
        const search = await this.options.conn.send<{ nodeId: number }>(
          'DOM.performSearch',
          { query: selector.slice(6) },
          this.options.sessionId,
        );
        if (search.nodeId) return search.nodeId;
      } catch { /* performSearch may not support xpath */ }
      return 1; // Element exists but we can't get nodeId — return truthy
    }
    // Get document root — with timeout guard: on freshly-attached tab
    // sessions the DOM agent can silently never respond (d07: detectCaptcha's
    // page.$ hung forever after a target=_blank tab switch). Time out and
    // report "not found" instead of deadlocking the command.
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);

    const doc = await withTimeout(
      this.options.conn.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 }, this.options.sessionId),
      8000,
    );
    if (!doc) return 0;

    const result = await withTimeout(
      this.options.conn.send<{ nodeId: number }>(
        'DOM.querySelector',
        { nodeId: doc.root.nodeId, selector },
        this.options.sessionId,
      ),
      8000,
    );
    if (!result) return 0;

    return result.nodeId;
  }

  /** Query all matching elements, returns array of CDP nodeIds */
  async querySelectorAll(selector: string): Promise<number[]> {
    const doc = await this.options.conn.send<{ root: { nodeId: number } }>(
      'DOM.getDocument',
      { depth: 0 },
      this.options.sessionId,
    );

    const result = await this.options.conn.send<{ nodeIds: number[] }>(
      'DOM.querySelectorAll',
      { nodeId: doc.root.nodeId, selector },
      this.options.sessionId,
    );

    return result.nodeIds ?? [];
  }

  /** Resolve a CDP nodeId to a RemoteObject for evaluate */
  async resolveNode(nodeId: number): Promise<string> {
    const result = await this.options.conn.send<{ object: { objectId: string } }>(
      'DOM.resolveNode',
      { nodeId },
      this.options.sessionId,
    );
    return result.object.objectId;
  }

  /** Get the box model for a nodeId */
  async getBoxModel(nodeId: number): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
      const result = await this.options.conn.send<{
        model: { content: number[] };
      }>('DOM.getBoxModel', { nodeId }, this.options.sessionId);

      const c = result.model?.content;
      if (!c || c.length < 8) return null;

      const x1 = c[0];
      const y1 = c[1];
      const x2 = c[4];
      const y2 = c[5];

      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    } catch {
      return null;
    }
  }

  /** Call a function on a RemoteObject */
  async callFunctionOn<T = unknown>(
    objectId: string,
    functionDeclaration: string,
    args: unknown[] = [],
  ): Promise<T> {
    const result = await this.options.conn.send<{
      result?: { value?: T; type: string };
      exceptionDetails?: { text: string };
    }>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args.map((a) => ({ value: a })),
      returnByValue: true,
    }, this.options.sessionId);

    if (result.exceptionDetails) {
      throw new Error(`CallFunctionOn error: ${result.exceptionDetails.text}`);
    }

    return result.result?.value as T;
  }

  /** Send a CDP command scoped to this page's session */
  async _cdpSend<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.options.conn.send<T>(method, params, this.options.sessionId);
  }

  /** sup-s11: beforeunload 自动应答语义——'accept'（默认，离开页面，与录制
   * 意图一致）或 'dismiss'（取消导航留守原页，尽力而为：此构建上 CDP
   * accept:false 对浏览器侧导航的取消语义不稳定，不保证）。 */
}