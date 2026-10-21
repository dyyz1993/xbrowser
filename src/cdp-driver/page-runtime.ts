import type { CDPConnection } from './connection.js';

/** Page.getFrameTree 节点（递归） */
export interface FrameNode {
  frame: { id: string; url: string };
  childFrames?: FrameNode[];
}

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
    const attachedA = await this.tryAttachViaTargets(urlIncludes);
    if (attachedA) {
      try {
        return await evalIn(attachedA);
      } finally {
        this.detachQuietly(attachedA);
      }
    }

    // 路径 B：同进程 iframe——Runtime.enable 收集 executionContextCreated，
    // 用 Page.getFrameTree 做 frameId→URL 映射，contextId 定向执行
    type FrameNode = { frame: { id: string; url: string }; childFrames?: FrameNode[] };
    type CtxEvent = { context?: { id?: number; auxData?: { frameId?: string } } };
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
      // 首选 Page.createIsolatedWorld：按 frameId 同步拿执行上下文，一发必中
      // （旧实现靠 Runtime.executionContextCreated 事件窗口 400ms 收集，
      // headless 负载下时序不稳会漏——mail.qq.com 实战冒烟实证三路未命中）
      try {
        const world = await this.options.conn.send<{ executionContextId: number }>(
          'Page.createIsolatedWorld',
          { frameId: target.id, grantUniveralAccess: true, allowUniversalAccessFromFileURLs: true },
          this.options.sessionId,
        );
        if (world?.executionContextId) {
          return await evalIn(this.options.sessionId, world.executionContextId);
        }
      } catch { /* 落到事件窗口兜底 */ }

      // 兜底：Runtime.executionContextCreated 事件窗口收集（isolated world
      // 不可用时——tunnel 扩展链路等）
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
    const attachedC = await this.tryAttachViaAutoAttach(urlIncludes);
    if (attachedC) {
      try {
        return await evalIn(attachedC);
      } finally {
        this.detachQuietly(attachedC);
      }
    }
    throw new Error(`frame not found for "${urlIncludes}"（OOPIF target、frame 树、auto-attach 三路均未命中；可能仍在加载）`);
  }

  /**
   * 输入专用 frame session 解析（mouse/click/fill --frame）。
   *
   * 与 evaluateInFrame 的区别：必须拿到**真实 target session**（Input 域
   * 事件派发到该 session 才会进入 iframe 的渲染进程——主页面 session 上
   * 派发的输入进不去 OOPIF，qqmail 验证码 4 次页面级拖动全败的实证）。
   * 因此只走 A（getTargets attach）/ C（auto-attach）两路；同进程 frame
   * 没有 session，但 locator 层的坐标偏移本就支持同源 iframe，直接用普通
   * click/fill 即可。
   *
   * 坐标语义：返回的 session 上派发 Input 事件用 **iframe 局部坐标**
   * （与该 session 内 getBoundingClientRect 一致）。
   */
  async resolveFrameSession(urlIncludes: string): Promise<string> {
    if (this.options.isClosed()) throw new Error('Page is closed');
    const viaTargets = await this.tryAttachViaTargets(urlIncludes);
    if (viaTargets) return viaTargets;
    const viaAuto = await this.tryAttachViaAutoAttach(urlIncludes);
    if (viaAuto) return viaAuto;

    // 同进程命中检测：只为给出更准确的错误信息
    type FrameNode = { frame: { id: string; url: string }; childFrames?: FrameNode[] };
    try {
      const tree = await this.options.conn.send<{ frameTree: FrameNode }>('Page.getFrameTree', undefined, this.options.sessionId);
      const urls: string[] = [];
      const walk = (node: FrameNode): void => {
        urls.push(node.frame.url);
        for (const child of node.childFrames || []) walk(child);
      };
      walk(tree.frameTree);
      if (urls.some((u) => u.includes(urlIncludes))) {
        throw new Error(`frame "${urlIncludes}" 是同进程 iframe（无独立 target）——普通 click/fill/mouse 即可（locator 层已支持同源 iframe 坐标偏移）`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('同进程')) throw err;
      // frame 树查询失败不掩盖主错误
    }
    throw new Error(`no OOPIF target for "${urlIncludes}"（用 'xbrowser frames' 查看可见的 iframe target；OOPIF 只在 Target.getTargets 里出现）`);
  }

  /** 完整 frame 树（递归含嵌套——同进程 iframe 祖先链构造用） */
  async frameTreeNodes(): Promise<FrameNode> {
    const tree = await this.options.conn.send<{ frameTree: FrameNode }>('Page.getFrameTree', undefined, this.options.sessionId);
    return tree.frameTree;
  }

  /** 浏览器级 iframe target 列表（OOPIF 可见性——Page.getFrameTree 看不到它们） */
  async listFrameTargets(): Promise<Array<{ url: string; targetId: string }>> {
    try {
      const tg = await this.options.conn.send<{ targetInfos?: Array<{ targetId: string; type: string; url?: string }> }>('Target.getTargets', undefined);
      return (tg.targetInfos || [])
        .filter((t) => t.type === 'iframe')
        .map((t) => ({ url: t.url || '', targetId: t.targetId }));
    } catch {
      return []; // tunnel 扩展链路可能不支持浏览器级 getTargets
    }
  }

  /** 路径 A：浏览器级 Target.getTargets 平铺 iframe target，按 URL 子串 attach。
   *  多次导航后列表里可能残留正在销毁的陈旧 target——attach 后用 location.href
   *  验证候选确实是活目标，不匹配则换下一个（验证码 iframe 重建场景实测会撞上）。 */
  private async tryAttachViaTargets(urlIncludes: string): Promise<string | null> {
    try {
      const tg = await this.options.conn.send<{ targetInfos?: Array<{ targetId: string; type: string; url?: string }> }>('Target.getTargets', undefined);
      const candidates = (tg.targetInfos || []).filter((t) => t.type === 'iframe' && (t.url || '').includes(urlIncludes));
      for (const hit of candidates) {
        try {
          const att = await this.options.conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId: hit.targetId, flatten: true });
          const probe = await this.options.conn.send<{
            result?: { value?: unknown };
            exceptionDetails?: unknown;
          }>('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, att.sessionId);
          const href = typeof probe.result?.value === 'string' ? probe.result.value : '';
          if (probe.exceptionDetails || !href.includes(urlIncludes)) {
            this.detachQuietly(att.sessionId);
            continue; // 陈旧/未加载 target——换下一个候选
          }
          return att.sessionId;
        } catch {
          continue; // attach/evaluate 失败（target 刚被销毁）——换下一个候选
        }
      }
    } catch { /* 落到后续路径（tunnel 扩展链路可能不支持浏览器级 getTargets） */ }
    return null;
  }

  /** 路径 C：Target.setAutoAttach 监听后续 attach 的 iframe target（兜底） */
  private async tryAttachViaAutoAttach(urlIncludes: string): Promise<string | null> {
    type AttachEvent = { sessionId?: string; targetInfo?: { type?: string; url?: string } };
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
    return hit ? hit.sessionId : null;
  }

  private detachQuietly(sessionId: string): void {
    this.options.conn.send('Target.detachFromTarget', { sessionId }).catch(() => {});
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
