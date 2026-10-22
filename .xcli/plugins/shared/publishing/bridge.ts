/**
 * chrome-bridge 传输层（发布插件共用）。
 *
 * 走 HTTP 9347 `/exec`，复用用户 Chrome 里的登录态（扩展通道）。
 * 与 `gemini/bridge.ts` 的差异：这里额外提供发布场景需要的
 * 「可信点击」与「页面内求值」封装。
 */

const BRIDGE_PORT = 9347;

export interface BridgeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** bridge 命令通道 */
export interface BridgeTransport {
  call(cmd: string, args: Record<string, unknown>): Promise<unknown>;
}

/** 判断 bridge 是否可用（扩展已连接） */
export async function isBridgeAvailable(port = BRIDGE_PORT): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'tabs', args: {} }),
      signal: AbortSignal.timeout(1500),
    }).then((x) => x.json());
    return Boolean(r && (r as BridgeResponse).ok);
  } catch {
    return false;
  }
}

/** 创建 HTTP bridge 传输 */
export function createHttpBridge(port = BRIDGE_PORT): BridgeTransport {
  const base = `http://127.0.0.1:${port}/exec`;
  return {
    async call(cmd, args) {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, args }),
      }).then((x) => x.json()) as BridgeResponse;
      if (r && r.ok === false && r.error) throw new Error(String(r.error).slice(0, 200));
      return r?.data;
    },
  };
}

/** 页面内求值（返回原始 value） */
export async function evaluateInTab<T = unknown>(
  bridge: BridgeTransport,
  expression: string,
  tabId: number,
): Promise<T> {
  const r = (await bridge.call('evaluate', { expression, tabId })) as { value?: T; error?: string };
  if (r && typeof r === 'object' && 'error' in r && r.error) {
    throw new Error(String(r.error).slice(0, 200));
  }
  return (r?.value) as T;
}

/** CDP 原始命令 */
export async function cdpCall<T = unknown>(
  bridge: BridgeTransport,
  method: string,
  params: Record<string, unknown>,
  tabId: number,
): Promise<T> {
  const r = (await bridge.call('cdp', { method, params, tabId })) as { data?: { data?: T }; error?: string };
  if (r && typeof r === 'object' && 'error' in r && r.error) {
    throw new Error(String(r.error).slice(0, 200));
  }
  const payload = (r as { data?: { data?: T } })?.data;
  return (payload?.data ?? (r as unknown as T)) as T;
}

/**
 * 可信点击（CDP Input 域，isTrusted=true）。
 *
 * 关键：`mouseMoved` 的 callback 会被 Chrome 合成器推迟到帧渲染（重页面
 * 实测 5-12s/次），因此这里**不等待** mouseMoved 的返回，只保证事件已
 * 派发；`mousePressed`/`mouseReleased` 仍等待回执。
 */
export async function trustedClick(
  bridge: BridgeTransport,
  tabId: number,
  x: number,
  y: number,
): Promise<void> {
  await bridge.call('cdp', {
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseMoved', x, y, buttons: 0 },
    tabId,
  });
  await new Promise((r) => setTimeout(r, 120));
  await bridge.call('cdp', {
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 },
    tabId,
  });
  await new Promise((r) => setTimeout(r, 60));
  await bridge.call('cdp', {
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 },
    tabId,
  });
  await new Promise((r) => setTimeout(r, 600));
}

/** 页面内矩形信息 */
export interface ElementPoint {
  x: number;
  y: number;
  text?: string;
  tag?: string;
  inViewport?: boolean;
}

/**
 * 在页面里按「可见文本 + 选择器范围」定位元素并返回中心点。
 *
 * 命中判定放宽到 `elementsFromPoint` 栈顶为 BUTTON 的内部 SPAN——
 * 否则按钮内部的文本节点会被误判成"被遮挡"（ERR-20261022-011）。
 */
export async function locateByText(
  bridge: BridgeTransport,
  tabId: number,
  options: {
    text: string | RegExp;
    scope?: string;
    exact?: boolean;
    requireViewport?: boolean;
  },
): Promise<ElementPoint | null> {
  const { text, scope = 'body', exact = false, requireViewport = true } = options;
  const isReg = text instanceof RegExp;
  // pattern 必须内联进页面表达式——页面作用域里没有这个变量
  const literal = isReg ? text.source : JSON.stringify(text);
  const expression = `(function(){
    var scopeEl = document.querySelector(${JSON.stringify(scope)}) || document.body;
    var pattern = ${literal};
    var isReg = ${isReg ? 'true' : 'false'};
    var re = isReg ? new RegExp(pattern) : null;
    var candidates = scopeEl.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit], label, .ant-radio-wrapper, .ant-checkbox-wrapper');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var raw = (el.textContent || el.value || '').replace(/\\s+/g, ' ').trim();
      if (!raw || raw.length > 24) continue;
      var hit = isReg ? re.test(raw) : (${exact ? 'raw === pattern' : 'raw.indexOf(pattern) >= 0'});
      if (!hit) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (${requireViewport ? 'true' : 'false'} && (rect.top < 0 || rect.top > window.innerHeight)) continue;
      var x = Math.round(rect.x + rect.width / 2);
      var y = Math.round(rect.y + rect.height / 2);
      var stack = document.elementsFromPoint(x, y);
      var top = stack[0];
      var topTag = top ? top.tagName : '';
      var topText = top ? (top.textContent || '').replace(/\\s+/g, ' ').trim() : '';
      var ok = el.contains(top) || top === el || topTag === 'BUTTON' || topTag === 'A';
      if (!ok) continue;
      return JSON.stringify({ x: x, y: y, text: raw, tag: el.tagName, inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight });
    }
    return null;
  })()`;
  const raw = await evaluateInTab<string | null>(bridge, expression, tabId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ElementPoint;
  } catch {
    return null;
  }
}

/** 定位并可信点击 */
export async function clickByText(
  bridge: BridgeTransport,
  tabId: number,
  options: {
    text: string | RegExp;
    scope?: string;
    exact?: boolean;
    requireViewport?: boolean;
  },
): Promise<boolean> {
  const point = await locateByText(bridge, tabId, options);
  if (!point) return false;
  await trustedClick(bridge, tabId, point.x, point.y);
  return true;
}

/** 打开命名任务分组 tab，返回 tabId */
export async function openTaskTab(
  bridge: BridgeTransport,
  name: string,
  url: string,
): Promise<number> {
  const opened = (await bridge.call('task-open', { name, url })) as { tabId?: number };
  if (!opened?.tabId) throw new Error(`bridge task-open 失败（${name}）——扩展未连接？`);
  return opened.tabId;
}

/** 关闭命名任务分组 tab */
export async function closeTaskTab(bridge: BridgeTransport, name: string): Promise<void> {
  await bridge.call('task-close', { name }).catch(() => undefined);
}

/** 轮询等待条件成立 */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  options: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const timeout = options.timeout ?? 15000;
  const interval = options.interval ?? 500;
  const deadline = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v as T;
      last = v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`等待超时（${timeout}ms）：${String(last ?? '').slice(0, 120)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
