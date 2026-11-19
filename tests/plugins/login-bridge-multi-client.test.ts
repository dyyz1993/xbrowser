/**
 * chrome-bridge 多客户端隔离验收（Layer 2 — 扩展 background.js 真源码）。
 *
 * 场景：同一个浏览器（同一条 WS 连接、同一个扩展），两个 CLI 客户端并发下发
 * 命令。验收断言：每个客户端的命令只落在自己的任务 tab / 任务组上，互不污染、
 * 互不误伤（navigate/evaluate 交错、task-close 只收自己的组）。
 *
 * 两条路由形态分别验收：
 *  - 显式任务组：双客户端各自 task-open，后续命令带返回的 tabId（显式路由）
 *  - 自动任务组：双客户端只带 --task（args.task），靠 getTaskTabId 按任务名解析 ——
 *    该路径读全局 currentTaskName，多客户端消息交错时会互相覆写（onmessage 每条
 *    消息重置一次），本测试负责钉住这个竞态。
 */
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Tab = { id: number; groupId: number; url: string; active?: boolean };
type Group = { id: number; title: string; color?: string };
type DispatchReply = { id: number; ok: boolean; data?: unknown; error?: string };

class FakeWebSocket {
  static last: FakeWebSocket | undefined;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  constructor() { FakeWebSocket.last = this; }
  close(): void { this.readyState = 3; }
  send(data: string): void { this.sent.push(String(data)); }
}

function createChrome() {
  const tabs: Tab[] = [];
  const groups: Group[] = [];
  const store: Record<string, unknown> = {};
  let nextTabId = 100;
  let nextGroupId = 10;

  const chrome = {
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ version: 'test' }),
      onMessage: { addListener: vi.fn() },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    windows: {
      getLastFocused: async () => ({ id: 1, type: 'normal' }),
      getAll: async () => [{ id: 1, type: 'normal' }],
    },
    debugger: {
      attach: (_t: unknown, _v: string, cb: (e?: unknown) => void) => cb(),
      sendCommand: (
        target: { tabId?: number | null },
        method: string,
        params: Record<string, unknown>,
        cb: (r?: unknown) => void,
      ) => {
        if (method === 'Runtime.evaluate' && params.expression === 'location.href') {
          const tab = tabs.find((t) => t.id === target.tabId);
          cb({ result: { value: tab?.url ?? '' } });
          return;
        }
        cb(method === 'Page.addScriptToEvaluateOnNewDocument'
          ? { identifier: 'script' }
          : { result: { value: null } });
      },
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      query: async (q: { groupId?: number }) =>
        (q.groupId == null ? [...tabs] : tabs.filter((t) => t.groupId === q.groupId)),
      get: async (id: number) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`no tab ${id}`);
        return tab;
      },
      create: async (o: { url: string }) => {
        const tab: Tab = { id: nextTabId++, groupId: -1, url: o.url };
        tabs.push(tab);
        return tab;
      },
      update: async (id: number, change: { url?: string }) => {
        const tab = tabs.find((t) => t.id === id);
        if (tab && change.url) tab.url = change.url;
        return tab;
      },
      group: async ({ tabIds }: { tabIds: number | number[] }) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const group: Group = { id: nextGroupId++, title: '' };
        groups.push(group);
        for (const id of ids) {
          const tab = tabs.find((t) => t.id === id);
          if (tab) tab.groupId = group.id;
        }
        return group.id;
      },
      remove: async (id: number) => {
        const index = tabs.findIndex((t) => t.id === id);
        if (index >= 0) tabs.splice(index, 1);
      },
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
      onReplaced: { addListener: vi.fn() },
    },
    tabGroups: {
      query: async () => [...groups],
      update: async (id: number, props: { title?: string; color?: string }) => {
        const group = groups.find((g) => g.id === id);
        if (group) Object.assign(group, props);
      },
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) if (key in store) out[key] = store[key];
          return out;
        },
        set: async (values: Record<string, unknown>) => { Object.assign(store, values); },
      },
    },
    scripting: { executeScript: async () => [{ result: null }] },
    cookies: { getAll: async () => [] },
  };

  return { chrome, tabs, groups };
}

async function loadBridge(chrome: unknown): Promise<FakeWebSocket> {
  const source = await readFile(
    new URL('../../.xcli/plugins/login-bridge/extension/background.js', import.meta.url),
    'utf8',
  );
  vi.stubGlobal('chrome', chrome);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  // Raw concatenation: background source contains template literals and
  // interpolating it into another template corrupts its syntax.
  const load = new Function('globalThis', source + '\n; return async () => executors;');
  await (load(globalThis) as () => Promise<unknown>)();
  const ws = FakeWebSocket.last!;
  ws.onopen?.(); // 触发 hello 上报
  return ws;
}

let nextMsgId = 1;

function replyOf(ws: FakeWebSocket, id: number): DispatchReply {
  const raw = ws.sent.find((s) => (JSON.parse(s) as { id?: number }).id === id);
  if (!raw) throw new Error(`no reply for #${id}`);
  return JSON.parse(raw) as DispatchReply;
}

/** 并发发射：同步触发 onmessage 后返回回复 Promise（多条消息在首个 await 前交错）。 */
function fire(ws: FakeWebSocket, cmd: string, args: Record<string, unknown> = {}): Promise<DispatchReply> {
  const id = nextMsgId++;
  const reply = (async () => {
    await vi.waitFor(() => {
      expect(ws.sent.some((s) => (JSON.parse(s) as { id?: number }).id === id)).toBe(true);
    });
    return replyOf(ws, id);
  })();
  ws.onmessage!({ data: JSON.stringify({ id, cmd, args }) });
  return reply;
}

async function dispatch(ws: FakeWebSocket, cmd: string, args: Record<string, unknown> = {}): Promise<DispatchReply> {
  return fire(ws, cmd, args);
}

function dataOf(reply: DispatchReply): Record<string, unknown> {
  expect(reply.ok).toBe(true);
  return (reply.data ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login-bridge multi-client isolation (single browser, single extension)', () => {
  it('two clients with explicit task groups stay isolated under interleaved commands', async () => {
    const h = createChrome();
    const ws = await loadBridge(h.chrome);

    const openA = dataOf(await dispatch(ws, 'task-open', { name: 'client-a', url: 'https://a.example/start' }));
    const openB = dataOf(await dispatch(ws, 'task-open', { name: 'client-b', url: 'https://b.example/start' }));
    const tabA = openA.tabId as number;
    const tabB = openB.tabId as number;
    expect(tabA).not.toBe(tabB);

    // 两个客户端并发导航各自的 tab
    await Promise.all([
      fire(ws, 'navigate', { tabId: tabA, url: 'https://a.example/page1' }),
      fire(ws, 'navigate', { tabId: tabB, url: 'https://b.example/page1' }),
    ]);

    // 并发读取各自 tab 的 URL —— 交错下不得串台
    const [evalA, evalB] = await Promise.all([
      fire(ws, 'evaluate', { tabId: tabA, expression: 'location.href' }),
      fire(ws, 'evaluate', { tabId: tabB, expression: 'location.href' }),
    ]);
    expect(dataOf(evalA).value).toBe('https://a.example/page1');
    expect(dataOf(evalB).value).toBe('https://b.example/page1');

    // 客户端 A 收尾只关自己的组，B 的组与 tab 必须原样保留
    await dispatch(ws, 'task-close', { name: 'client-a' });
    expect(h.tabs.find((t) => t.id === tabA)).toBeUndefined();
    expect(h.tabs.find((t) => t.id === tabB)?.url).toBe('https://b.example/page1');
    expect(h.groups.some((g) => g.title === 'xb-task-client-b')).toBe(true);
  });

  it('two clients using --task auto groups stay isolated under interleaved commands', async () => {
    const h = createChrome();
    const ws = await loadBridge(h.chrome);

    // 冷启动并发导航：只带 task 名（无 task-open、无 tabId），路由全靠任务名解析
    await Promise.all([
      fire(ws, 'navigate', { task: 'alpha', url: 'https://alpha.example/one' }),
      fire(ws, 'navigate', { task: 'beta', url: 'https://beta.example/one' }),
    ]);

    // 并发读取：各自解析到各自的自动组 tab
    const [evalAlpha, evalBeta] = await Promise.all([
      fire(ws, 'evaluate', { task: 'alpha', expression: 'location.href' }),
      fire(ws, 'evaluate', { task: 'beta', expression: 'location.href' }),
    ]);
    expect(dataOf(evalAlpha).value).toBe('https://alpha.example/one');
    expect(dataOf(evalBeta).value).toBe('https://beta.example/one');

    // 两个任务各自成组、各自成 tab（串台时会塌缩成一组一 tab）
    expect(h.groups.filter((g) => g.title.startsWith('\u{1F916}')).map((g) => g.title).sort())
      .toEqual(['\u{1F916} alpha', '\u{1F916} beta']);
    expect(h.tabs).toHaveLength(2);

    // 收尾 alpha 不影响 beta
    await dispatch(ws, 'task-close', { name: 'alpha' });
    expect(h.groups.some((g) => g.title === '\u{1F916} beta')).toBe(true);
    expect(h.tabs.filter((t) => (t.url ?? '').startsWith('https://beta.example'))).toHaveLength(1);
  });
});
