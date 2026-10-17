import type { CDPConnection } from './connection.js';

export interface XBElementHandleLike {
  asElement(): { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> } | null;
}

export class RuntimeEvaluationService {
  constructor(private readonly options: {
    conn: CDPConnection;
    sessionId: string;
    isClosed(): boolean;
    url(): string;
  }) {}

  async title(): Promise<string> {
    let title = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        title = await this.evaluate<string>('document.title');
        if (title) return title;
      } catch {
        // Execution context may not be ready yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return title;
  }

  async content(): Promise<string> {
    return this.evaluate<string>('document.documentElement.outerHTML');
  }

  // ── Evaluation ──────────────────────────────────────────────

  async evaluate<R = unknown>(
    fn: string | Function,
    ...args: unknown[]
  ): Promise<R> {
    if (this.options.isClosed()) throw new Error('Page is closed');

    // Dismiss any pending dialog before evaluation (prevents hanging on stale alerts)
    this.options.conn.send('Page.handleJavaScriptDialog', { accept: false }, this.options.sessionId).catch(() => {});

    let expression: string;
    if (typeof fn === 'string') {
      expression = fn;
    } else {
      const argStr = args.length > 0
        ? `...${JSON.stringify(args)}`
        : '';
      expression = `(()=>{const __fn=(${fn.toString()});return __fn(${argStr});})()`;
    }

    const result = await this.options.conn.send<{
      result?: { type: string; value?: unknown; description?: string; subtype?: string };
      exceptionDetails?: {
        text: string;
        exception?: { description?: string; value?: string };
      };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, this.options.sessionId);

    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.exception?.value
        ?? result.exceptionDetails.text;
      throw new Error(`${detail}`);
    }

    return result.result?.value as R;
  }

  /**
   * 在指定 iframe 上下文中执行表达式（攻防 D16 能力建设，2026-08-19）。
   *
   * 双路径：
   *  1. 同进程 iframe —— Runtime.enable 收集 executionContextCreated，
   *     找到目标 frameId 的 contextId，用 contextId 定向执行；
   *  2. 跨域 OOPIF（独立 target）—— Target.setAutoAttach(flatten) 监听
   *     attachedToTarget 中 type==='iframe' 的会话，用其 sessionId 执行。
   *
   * 这绕过了页面同源策略（那是页面 JS 的约束，CDP 是调试通道）——
   * 支付窗/验证码/第三方嵌入内容的读写都靠它。
   */
  async evaluateInFrame<R = unknown>(urlIncludes: string, expression: string): Promise<R> {
    if (this.options.isClosed()) throw new Error('Page is closed');

    const evalIn = async (sessionId: string | undefined, contextId?: number): Promise<R> => {
      const params: Record<string, unknown> = { expression, returnByValue: true, awaitPromise: true };
      if (contextId !== undefined) params.contextId = contextId;
      const result = await this.options.conn.send<{
        result?: { value?: unknown };
        exceptionDetails?: { text: string; exception?: { description?: string; value?: string } };
      }>('Runtime.evaluate', params, sessionId);
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.exception?.value
          ?? result.exceptionDetails.text;
        throw new Error(`[frame ${urlIncludes}] ${detail}`);
      }
      return result.result?.value as R;
    };

    // 路径 A（首选）：OOPIF 是独立 CDP target——浏览器级 Target.getTargets
    // 直接按 type==='iframe' + URL 匹配，attach 后执行。实测 Page.getFrameTree
    // 对 OOPIF 不可靠（树里没有，但 target 存在且正常渲染）。
    try {
      const tg = await this.options.conn.send<{ targetInfos?: Array<{ targetId: string; type: string; url?: string }> }>('Target.getTargets', undefined);
      const hit = (tg.targetInfos || []).find((t) => t.type === 'iframe' && (t.url || '').includes(urlIncludes));
      if (hit) {
        const att = await this.options.conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId: hit.targetId, flatten: true });
        return evalIn(att.sessionId);
      }
    } catch { /* 落到路径 B（tunnel 扩展链路可能不支持浏览器级 getTargets） */ }

    // 路径 B：同进程 iframe——Runtime.enable 收集 executionContextCreated，
    // 用 Page.getFrameTree 做 frameId→URL 映射，contextId 定向执行
    type FrameNode = { frame: { id: string; url: string }; childFrames?: FrameNode[] };
    type CtxEvent = { context?: { id?: number; auxData?: { frameId?: string } } };
    type AttachEvent = { sessionId?: string; targetInfo?: { type?: string; url?: string } };
    const tree = await this.options.conn.send<{ frameTree: FrameNode }>('Page.getFrameTree', undefined, this.options.sessionId);
    const all: Array<{ id: string; url: string }> = [];
    const walk = (node: FrameNode): void => {
      all.push({ id: node.frame.id, url: node.frame.url });
      for (const child of node.childFrames || []) walk(child);
    };
    walk(tree.frameTree);
    const mainId = tree.frameTree?.frame?.id;
    const target = all.find((f) => f.id !== mainId && f.url.includes(urlIncludes));

    if (target) {
      const contexts: Array<{ id: number; frameId: string }> = [];
      const onCtx = (raw: unknown): void => {
        const c = (raw as CtxEvent)?.context;
        if (c?.id && c?.auxData?.frameId) contexts.push({ id: c.id, frameId: c.auxData.frameId });
      };
      this.options.conn.on('Runtime.executionContextCreated', onCtx);
      try {
        await this.options.conn.send('Runtime.enable', undefined, this.options.sessionId).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
      } finally {
        this.options.conn.off('Runtime.executionContextCreated', onCtx);
      }
      const ctx = contexts.find((c) => c.frameId === target.id);
      if (ctx) return evalIn(this.options.sessionId, ctx.id);
    }

    // 路径 C：Target.setAutoAttach 监听后续 attach 的 iframe target（兜底）
    const attached: Array<{ sessionId: string; url: string }> = [];
    const onAttach = (raw: unknown): void => {
      const ev = raw as AttachEvent;
      if (ev?.sessionId && ev.targetInfo?.type === 'iframe') {
        attached.push({ sessionId: ev.sessionId, url: ev.targetInfo.url || '' });
      }
    };
    this.options.conn.on('Target.attachedToTarget', onAttach);
    try {
      await this.options.conn.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }, this.options.sessionId);
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      this.options.conn.off('Target.attachedToTarget', onAttach);
      this.options.conn.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, this.options.sessionId).catch(() => {});
    }
    const hit = attached.find((a) => a.url.includes(urlIncludes));
    if (!hit) {
      throw new Error(`frame not found for "${urlIncludes}"（OOPIF target、frame 树、auto-attach 三路均未命中；可能仍在加载）`);
    }
    return evalIn(hit.sessionId);
  }

  /** evaluateHandle — evaluates fn and returns a handle for element bounding box */
  async evaluateHandle(
    fn: string | Function,
    ...args: unknown[]
  ): Promise<{
    asElement: () => { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> } | null;
  }> {
    let expression: string;
    if (typeof fn === 'string') {
      expression = fn;
    } else {
      const argStr = args.length > 0 ? `...${JSON.stringify(args)}` : '';
      expression = `(()=>{const __fn=(${fn.toString()});const __el=__fn(${argStr});if(__el&&typeof __el.getBoundingClientRect==='function'){const r=__el.getBoundingClientRect();return JSON.parse(JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}));}return null;})()`;
    }
    const result = await this.options.conn.send<{
      result?: { value?: string | null };
      exceptionDetails?: unknown;
    }>('Runtime.evaluate', { expression, returnByValue: true }).catch(() => ({ result: { value: null } }));
    let box: { x: number; y: number; width: number; height: number } | null = null;
    try { box = JSON.parse(result.result?.value as string); } catch { /* ignore */ }
    return {
      asElement: () => box ? { boundingBox: async () => box } : null,
    };
  }

  async $eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    const selJSON = JSON.stringify(selector);
    const xpathPrefix = selector.startsWith('xpath=') ? JSON.stringify(selector.slice(6)) : 'null';
    return this.evaluate<R>(
      `(function(sel, xpathExpr, fnStr, ...evalArgs) {
        const el = xpathExpr
          ? document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
          : document.querySelector(sel);
        if (!el) throw new Error('No element found for selector: ' + sel);
        const fn = new Function('return ' + fnStr)();
        return fn(el, ...evalArgs);
      })(${selJSON}, ${xpathPrefix}, ${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
    );
  }

  async $$eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R> {
    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    const selJSON = JSON.stringify(selector);
    const xpathPrefix = selector.startsWith('xpath=') ? JSON.stringify(selector.slice(6)) : 'null';
    return this.evaluate<R>(
      `(function(sel, xpathExpr, fnStr, ...evalArgs) {
        const els = xpathExpr
          ? (() => { const it = document.evaluate(xpathExpr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const r=[]; for(let i=0;i<it.snapshotLength;i++) r.push(it.snapshotItem(i)); return r; })()
          : Array.from(document.querySelectorAll(sel));
        const fn = new Function('return ' + fnStr)();
        return fn(els, ...evalArgs);
      })(${selJSON}, ${xpathPrefix}, ${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
    );
  }
}
