import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

type Group = {
  id: number;
  title: string;
  color?: string;
};

type TaskGroup = {
  name: string;
  groupId: number;
  tabs: Array<{ id: number; url?: string; title?: string }>;
};

type Tab = {
  id: number;
  groupId: number;
  url?: string;
};

type ChromeLike = {
  runtime: {
    id: string;
    lastError?: { message: string };
    getManifest: () => { version: string };
    onMessage: { addListener: ReturnType<typeof vi.fn> };
  };
  action: {
    setBadgeText: ReturnType<typeof vi.fn>;
    setBadgeBackgroundColor: ReturnType<typeof vi.fn>;
  };
  alarms: {
    create: ReturnType<typeof vi.fn>;
    onAlarm: { addListener: ReturnType<typeof vi.fn> };
  };
  debugger: {
    attach: (target: unknown, version: string, callback: (error?: unknown) => void) => void;
    sendCommand: (
      target: unknown,
      method: string,
      params: unknown,
      callback: (result?: unknown) => void,
    ) => void;
    onDetach: { addListener: ReturnType<typeof vi.fn> };
    onEvent: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  };
  tabs: {
    query: (query: { groupId?: number; active?: boolean; currentWindow?: boolean; url?: string }) => Promise<Tab[]>;
    onRemoved: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    onUpdated: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    onReplaced: { addListener: ReturnType<typeof vi.fn> };
    get: (tabId: number) => Promise<Tab>;
    create: (options: { url: string; active: boolean }) => Promise<Tab>;
    update: (tabId: number, changeInfo: { url?: string }) => Promise<unknown>;
    group: (options: { tabIds: number | number[] }) => Promise<number>;
    remove: (tabId: number) => Promise<void>;
    ungroup: (tabId: number) => Promise<void>;
  };
  tabGroups: {
    query: () => Promise<Group[]>;
    update: (groupId: number, properties: { title?: string; color?: string }) => Promise<void>;
    get: (groupId: number) => Promise<Group>;
  };
  storage: {
    local: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
    session: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
  cookies: {
    getAll: (filter?: { domain?: string }) => Promise<Array<Record<string, unknown>>>;
  };
  scripting: {
    executeScript: (options: unknown) => Promise<Array<{ result?: unknown; error?: unknown }>>;
  };
};

type Executor = (args: Record<string, unknown>) => Promise<unknown>;

const EXPECTED_COLORS = ['blue', 'purple', 'cyan', 'green', 'yellow', 'red', 'pink', 'orange'];

// 假 WS：记下实例与发出的帧，测试可以直接往 onmessage 喂一条桥命令
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  onopen: unknown = null;
  onclose: unknown = null;
  onerror: unknown = null;
  onmessage: unknown = null;
  constructor() { FakeWebSocket.instances.push(this); }
  close(): void {}
  send(frame: string): void { this.sent.push(frame); }
}

type BridgeSocket = { sent: string[]; onmessage: ((event: { data: string }) => Promise<void>) | null };

async function loadBridge(chrome: ChromeLike): Promise<{ executors: Record<string, Executor>; socket: BridgeSocket }> {
  const source = await readFile(new URL('../../.xcli/plugins/login-bridge/extension/background.js', import.meta.url), 'utf8');
  vi.stubGlobal('chrome', chrome);
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);

  // Raw concatenation: background source contains template literals and
  // interpolating it into another template corrupts its syntax.
  const load = new Function('globalThis', source + '\n; return async () => executors;');
  const executors = await load(globalThis)() as Record<string, Executor>;
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  return { executors, socket: socket as unknown as BridgeSocket };
}

async function loadExecutors(chrome: ChromeLike): Promise<Record<string, Executor>> {
  return (await loadBridge(chrome)).executors;
}

/** 经 WS 消息路径执行一条桥命令，返回扩展的回复帧。 */
async function bridgeCommand(socket: BridgeSocket, id: number, cmd: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!socket.onmessage) throw new Error('extension did not install ws.onmessage');
  await socket.onmessage({ data: JSON.stringify({ id, cmd, args }) });
  const frame = socket.sent.map((sent) => JSON.parse(sent) as Record<string, unknown>).find((message) => message.id === id);
  if (!frame) throw new Error(`no reply for ${cmd}#${id}`);
  return frame;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function createChrome() {
  const groups: Group[] = [];
  const tabs: Tab[] = [];
  let nextGroupId = 1000;
  let nextTabId = 10;
  const updates: Array<{ id: number; title?: string; color?: string }> = [];
  const removed: number[] = [];
  // storage.local / storage.session 都用内存存：桥靠它们记「哪些 tab 是自己建的」和任务状态
  const localStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {};
  const pick = (store: Record<string, unknown>, keys: string | string[]) => {
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
    return Object.fromEntries(names.filter((name) => name in store).map((name) => [name, store[name]]));
  };
  let createdCount = 0;

  const chrome: ChromeLike = {
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ version: 'test' }),
      onMessage: { addListener: vi.fn() },
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
    debugger: {
      attach: (_target, _version, callback) => callback(),
      sendCommand: (_target, method, _params, callback) => {
        callback(method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script' } : undefined);
      },
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: async (query) => {
        if (query.url) return tabs.filter((tab) => (tab.url ?? '').includes('example.com'));
        return query.groupId == null ? tabs : tabs.filter((tab) => tab.groupId === query.groupId);
      },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onReplaced: { addListener: vi.fn() },
      get: async (tabId) => {
        const tab = tabs.find((item) => item.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      update: vi.fn(async () => ({})),
      create: async (options) => {
        createdCount += 1;
        const tab: Tab = { id: nextTabId++, groupId: -1, url: options.url };
        tabs.push(tab);
        return tab;
      },
      group: async ({ tabIds }) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const group: Group = { id: nextGroupId++, title: '' };
        groups.push(group);
        for (const id of ids) {
          const tab = tabs.find((item) => item.id === id);
          if (tab) tab.groupId = group.id;
        }
        return group.id;
      },
      ungroup: async (tabId) => {
        const tab = tabs.find((item) => item.id === tabId);
        if (!tab) return;
        tab.groupId = -1;
        for (let index = groups.length - 1; index >= 0; index -= 1) {
          if (!tabs.some((item) => item.groupId === groups[index].id)) groups.splice(index, 1);
        }
      },
      remove: async (tabId) => {
        removed.push(tabId);
        const index = tabs.findIndex((tab) => tab.id === tabId);
        if (index < 0) return;
        const groupId = tabs[index].groupId;
        tabs.splice(index, 1);
        if (groupId != null && !tabs.some((tab) => tab.groupId === groupId)) {
          const groupIndex = groups.findIndex((group) => group.id === groupId);
          if (groupIndex >= 0) groups.splice(groupIndex, 1);
        }
      },
    },
    tabGroups: {
      query: async () => [...groups],
      update: async (groupId, properties) => {
        const group = groups.find((item) => item.id === groupId);
        if (!group) throw new Error(`unknown group ${groupId}`);
        Object.assign(group, properties);
        updates.push({ id: groupId, ...properties });
      },
      get: async (groupId) => {
        const group = groups.find((item) => item.id === groupId);
        if (!group) throw new Error(`unknown group ${groupId}`);
        return group;
      },
    },
    storage: {
      local: {
        get: async (keys) => pick(localStore, keys),
        set: async (values) => { Object.assign(localStore, values); },
      },
      session: {
        get: async (keys) => pick(sessionStore, keys),
        set: async (values) => { Object.assign(sessionStore, values); },
      },
    },
    cookies: {
      getAll: async () => [],
    },
    scripting: {
      executeScript: async () => [{ result: [] }],
    },
  };

  return { chrome, groups, tabs, updates, removed, sessionStore, state: { get createdCount() { return createdCount; } } };
}

function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return EXPECTED_COLORS[hash % EXPECTED_COLORS.length];
}

describe('login-bridge task groups', () => {
  it('exports only the authorized site through the bridge cookie API', async () => {
    const harness = createChrome();
    harness.tabs.push({ id: 77, groupId: -1, url: 'https://www.example.com/jobs' });
    const urlQueries: Array<string | undefined> = [];
    const originalQuery = harness.chrome.tabs.query;
    harness.chrome.tabs.query = async (query) => {
      urlQueries.push(query.url);
      return originalQuery(query);
    };
    const cookieCalls: Array<Record<string, unknown>> = [];
    const originalGet = harness.chrome.cookies.getAll;
    harness.chrome.cookies.getAll = async (filter?: { domain?: string }) => {
      if (filter) cookieCalls.push(filter);
      return originalGet(filter);
    };
    const fetchCalls: Array<{ url: unknown; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: unknown, init?: { body?: unknown }) => {
      fetchCalls.push({ url, body: init?.body });
      return { json: async () => ({ ok: true }) };
    });
    const executors = await loadExecutors(harness.chrome);

    const result = await executors['export-site-cookies']({ domain: 'example.com' }) as {
      ok: boolean; domain: string; count: number; localStorage: number; tabId: number | undefined;
    };

    expect(result).toEqual({ ok: true, domain: 'example.com', count: 0, localStorage: 0, tabId: 77 });
    expect(cookieCalls).toEqual([{ domain: 'example.com' }]);
    expect(urlQueries).toEqual(['https://example.com/*', 'https://*.example.com/*']);
    expect(fetchCalls).toEqual([{
      url: 'http://127.0.0.1:9355/cookies',
      body: expect.stringContaining('"domain":"example.com"'),
    }]);
  });

  it('get-site-cookies returns authorized cookies directly without archiving them', async () => {
    const harness = createChrome();
    const cookieCalls: Array<{ domain?: string }> = [];
    const originalGet = harness.chrome.cookies.getAll;
    harness.chrome.cookies.getAll = async (filter?: { domain?: string }) => {
      if (filter) cookieCalls.push(filter);
      return originalGet(filter);
    };
    const executors = await loadExecutors(harness.chrome);

    const result = await executors['get-site-cookies']({ domain: 'example.com' }) as {
      ok: boolean; domain: string; count: number; cookies: unknown[];
    };

    expect(result).toMatchObject({ ok: true, domain: 'example.com', count: 0, cookies: [] });
    expect(cookieCalls).toEqual([{ domain: 'example.com' }]);
  });

  it('colors each task name with the same stable Chrome color', async () => {
    const harness = createChrome();
    const executors = await loadExecutors(harness.chrome);

    const first = (await executors['task-open']({ name: 'search', url: 'https://example.com/search' })) as { groupId: number };
    const repeat = (await executors['task-open']({ name: 'search', url: 'https://example.com/search-again' })) as { groupId: number; reused: boolean };

    const created = harness.groups.find((group) => group.id === first.groupId);
    expect(created?.title).toBe('xb-task-search');
    expect(created?.color).toBe(colorForName('search'));
    expect(EXPECTED_COLORS).toContain(created?.color);
    expect(repeat.groupId).toBe(first.groupId);
    expect(repeat.reused).toBe(true);

    const other = (await executors['task-open']({ name: 'upload', url: 'https://example.com/upload' })) as { groupId: number };
    const otherGroup = harness.groups.find((group) => group.id === other.groupId);
    expect(otherGroup?.color).toBe(colorForName('upload'));
  });

  it('creates separate groups for concurrent task names without changing either color', async () => {
    const harness = createChrome();
    const executors = await loadExecutors(harness.chrome);

    const [alpha, beta, gamma] = await Promise.all([
      executors['task-open']({ name: 'alpha', url: 'https://example.com/a' }),
      executors['task-open']({ name: 'beta', url: 'https://example.com/b' }),
      executors['task-open']({ name: 'gamma', url: 'https://example.com/c' }),
    ]) as Array<{ groupId: number }>;

    const ids = [alpha.groupId, beta.groupId, gamma.groupId];
    expect(new Set(ids).size).toBe(3);
    const colors = ids.map((id) => harness.groups.find((group) => group.id === id)?.color);
    expect(colors).toEqual([colorForName('alpha'), colorForName('beta'), colorForName('gamma')]);
    expect(new Set(colors).size).toBe(3);
  });

  it('serializes concurrent opens for one task and reuses the same colored group', async () => {
    const harness = createChrome();
    const executors = await loadExecutors(harness.chrome);
    const updateOrder: string[] = [];
    const originalUpdate = harness.chrome.tabGroups.update;
    harness.chrome.tabGroups.update = async (groupId, properties) => {
      updateOrder.push(properties.title ?? String(groupId));
      await originalUpdate(groupId, properties);
    };

    const results = await Promise.all(Array.from({ length: 6 }, () => executors['task-open']({ name: 'same', url: 'https://example.com/work' }))) as Array<{ groupId: number; reused?: boolean }>;

    expect(harness.groups.filter((group) => group.title === 'xb-task-same')).toHaveLength(1);
    expect(harness.tabs).toHaveLength(1);
    expect(updateOrder).toEqual(['xb-task-same']);
    expect(new Set(results.map((result) => result.groupId))).toContain(1000);
    expect(results.slice(1).every((result) => result.reused)).toBe(true);
    expect(results[0].groupId).toBe(1000);
  });

  it('lets read-only commands run between creating a group and completing its lifecycle work', async () => {
    const harness = createChrome();
    const executors = await loadExecutors(harness.chrome);
    const queries: string[] = [];
    let releaseOpen: (() => void) | undefined;
    const firstCreated = new Promise<void>((resolve) => {
      const check = () => {
        if (harness.state.createdCount > 0) resolve();
        else setImmediate(check);
      };
      check();
    });
    const originalUpdate = harness.chrome.tabGroups.update;
    harness.chrome.tabGroups.update = async (groupId, properties) => {
      if (properties.title === 'xb-task-blocked') {
        // Suspended after creation/grouping, before lifecycle completion.
        releaseOpen?.();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await originalUpdate(groupId, properties);
    };
    const originalQuery = harness.chrome.tabGroups.query;
    harness.chrome.tabGroups.query = async () => {
      queries.push('task-list-query');
      return originalQuery();
    };

    const blocked = executors['task-open']({ name: 'blocked', url: 'https://example.com/blocked' });
    await firstCreated;
    await vi.waitFor(() => {
      expect(harness.groups.some((group) => group.title === 'xb-task-blocked')).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    queries.length = 0;
    const listing = executors['task-list']({});

    const listed = await listing as TaskGroup[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: 'blocked', groupId: expect.any(Number) });
    expect(Array.isArray(listed[0].tabs)).toBe(true);
    expect(queries.filter((entry) => entry === 'task-list-query')).toHaveLength(1);
    expect(harness.state.createdCount).toBe(1);
    releaseOpen?.();
    await blocked;
  });

  it('deletes a named task group and preserves other colored groups', async () => {
    const harness = createChrome();
    const executors = await loadExecutors(harness.chrome);

    const first = (await executors['task-open']({ name: 'finish-me', url: 'https://example.com/finish' })) as { groupId: number };
    const second = (await executors['task-open']({ name: 'still-open', url: 'https://example.com/open' })) as { groupId: number };

    const closeResult = (await executors['task-close']({ name: 'finish-me' })) as { closed: number };

    expect(closeResult.closed).toBe(1);
    expect(harness.groups.some((group) => group.id === first.groupId)).toBe(false);
    expect(harness.groups.find((group) => group.id === second.groupId)?.title).toBe('xb-task-still-open');
    expect(harness.removed).toEqual([10]);
  });
});

describe('login-bridge task status titles', () => {
  it('task-status writes「任务名 · 状态」into the title and task-list reports it', async () => {
    const harness = createChrome();
    const { executors } = await loadBridge(harness.chrome);
    const opened = (await executors['task-open']({ name: 'pub-csdn', url: 'https://example.com' })) as { groupId: number };

    const running = (await executors['task-status']({ name: 'pub-csdn', status: '草稿：填写正文' })) as Record<string, unknown>;
    expect(running).toMatchObject({ ok: true, title: 'xb-task-pub-csdn · 草稿：填写正文', state: 'running' });
    expect(harness.groups[0].color).toBe(colorForName('pub-csdn'));

    await executors['task-status']({ name: 'pub-csdn', status: '草稿已就绪，待你确认后发布', state: 'awaiting-user' });
    expect(harness.groups[0]).toMatchObject({ title: 'xb-task-pub-csdn · 草稿已就绪，待你确认后发布', color: 'yellow' });

    const listed = (await executors['task-list']({})) as Array<Record<string, unknown>>;
    expect(listed[0]).toMatchObject({
      name: 'pub-csdn', kind: 'explicit', state: 'awaiting-user',
      title: 'xb-task-pub-csdn · 草稿已就绪，待你确认后发布', status: '草稿已就绪，待你确认后发布',
    });

    // 改过标题的组仍能按任务名找到；复用 = 任务重新开跑，回到「进行中」
    const reused = (await executors['task-open']({ name: 'pub-csdn' })) as { groupId: number; reused: boolean };
    expect(reused).toEqual({ tabId: expect.any(Number), groupId: opened.groupId, reused: true });
    expect(harness.groups[0]).toMatchObject({ title: 'xb-task-pub-csdn · 进行中', color: colorForName('pub-csdn') });

    expect(await executors['task-close']({ name: 'pub-csdn' })).toEqual({ closed: 1, ungrouped: 0 });
    expect(harness.groups).toHaveLength(0);
    expect(await executors['task-status']({ name: 'pub-csdn', status: 'x' })).toMatchObject({ ok: false });
  });

  it('refreshes the title with the action being performed (read-only commands keep the last status)', async () => {
    const harness = createChrome();
    const { executors, socket } = await loadBridge(harness.chrome);
    const opened = (await executors['task-open']({ name: 'pub-csdn', url: 'https://example.com' })) as { tabId: number };

    await bridgeCommand(socket, 1, 'fill', { selector: '#title', value: 'hello', tabId: opened.tabId });
    await vi.waitFor(() => expect(harness.groups[0].title).toBe('xb-task-pub-csdn · 填写 #title'));

    await bridgeCommand(socket, 2, 'evaluate', { expression: '1 + 1', tabId: opened.tabId });
    await bridgeCommand(socket, 3, 'cdp', { method: 'Runtime.evaluate', params: { expression: '2' }, tabId: opened.tabId });
    await settle();
    expect(harness.groups[0].title).toBe('xb-task-pub-csdn · 填写 #title');

    await bridgeCommand(socket, 4, 'cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed' }, tabId: opened.tabId });
    await vi.waitFor(() => expect(harness.groups[0].title).toBe('xb-task-pub-csdn · 点击页面'));

    await bridgeCommand(socket, 5, 'cdp', { method: 'DOM.setFileInputFiles', params: {}, tabId: opened.tabId });
    await vi.waitFor(() => expect(harness.groups[0].title).toBe('xb-task-pub-csdn · 上传文件'));
  });

  it('keeps「需要协助」sticky against automatic statuses until an explicit status arrives', async () => {
    const harness = createChrome();
    const { executors, socket } = await loadBridge(harness.chrome);
    const opened = (await executors['task-open']({ name: 'pub-x', url: 'https://example.com' })) as { tabId: number };

    await executors['task-status']({ name: 'pub-x', status: '需要协助：完成登录', state: 'needs-human' });
    expect(harness.groups[0]).toMatchObject({ title: 'xb-task-pub-x · 需要协助：完成登录', color: 'red' });

    // 插件没等就继续往下点：自动状态不许盖掉「需要协助」
    await bridgeCommand(socket, 1, 'fill', { selector: '#a', value: 'b', tabId: opened.tabId });
    await settle();
    expect(harness.groups[0]).toMatchObject({ title: 'xb-task-pub-x · 需要协助：完成登录', color: 'red' });

    await executors['task-status']({ name: 'pub-x', status: '已完成（未经人工确认）', state: 'done' });
    expect(harness.groups[0]).toMatchObject({ title: 'xb-task-pub-x · 已完成（未经人工确认）', color: 'green' });

    // 任务重新动起来（自动动作）→ 回到任务色
    await bridgeCommand(socket, 2, 'click', { selector: '#a', tabId: opened.tabId });
    await vi.waitFor(() => expect(harness.groups[0]).toMatchObject({ title: 'xb-task-pub-x · 点击 #a', color: colorForName('pub-x') }));
  });

  it('routes a named command to its own group even when another task has an explicit group', async () => {
    const harness = createChrome();
    const { executors, socket } = await loadBridge(harness.chrome);
    const debuggerTargets: number[] = [];
    const send = harness.chrome.debugger.sendCommand;
    harness.chrome.debugger.sendCommand = (target, method, params, callback) => {
      // 只记测试自己的求值命令落在哪个 tab（任务 tab 初始化时还有一批 stealth 注入，其中也有 Runtime.evaluate）
      if (method === 'Runtime.evaluate' && (params as { expression?: string } | undefined)?.expression === 'location.href') {
        debuggerTargets.push((target as { tabId: number }).tabId);
      }
      send(target, method, params, callback);
    };
    const taskA = (await executors['task-open']({ name: 'task-a', url: 'https://example.com/a' })) as { tabId: number };

    // 客户端 B 带 --task task-b、不带 tabId：必须落到自己的自动组，不能进 task-a 的 tab
    const replyB = await bridgeCommand(socket, 1, 'evaluate', { expression: 'location.href', task: 'task-b' });
    expect(replyB).toMatchObject({ ok: true });
    expect(debuggerTargets).toEqual([expect.any(Number)]);
    expect(debuggerTargets[0]).not.toBe(taskA.tabId);
    expect(harness.groups.map((group) => group.title)).toEqual(['xb-task-task-a', '🤖 task-b']);
    const tabB = debuggerTargets[0];

    // 同一任务的后续命令复用它自己的组（标题带了状态后缀也要找得到）
    await bridgeCommand(socket, 2, 'navigate', { url: 'https://example.com/b', task: 'task-b' });
    await vi.waitFor(() => expect(harness.groups[1].title).toBe('🤖 task-b · 打开 example.com/b'));
    await bridgeCommand(socket, 3, 'evaluate', { expression: 'location.href', task: 'task-b' });
    expect(debuggerTargets).toEqual([tabB, tabB]);
    expect(harness.state.createdCount).toBe(2);

    // 没带任务名的命令沿用旧行为：落在最近的显式组里
    await bridgeCommand(socket, 4, 'evaluate', { expression: 'location.href' });
    expect(debuggerTargets.at(-1)).toBe(taskA.tabId);
    expect(debuggerTargets).toHaveLength(3);

    // 关 B 只关 B 的组
    expect(await executors['task-close']({ name: 'task-b' })).toEqual({ closed: 1, ungrouped: 0 });
    expect(harness.groups.map((group) => group.title)).toEqual(['xb-task-task-a']);
  });

  it('treats an intentional clear as retained when the field reads back empty', async () => {
    const harness = createChrome();
    const { executors } = await loadBridge(harness.chrome);
    let scriptCalls = 0;
    harness.chrome.scripting.executeScript = async () => {
      scriptCalls += 1;
      const result = scriptCalls === 1
        ? { found: true, react: false, richFamily: null, contenteditable: false, controlled: false }
        : scriptCalls === 2 ? { ok: true } : '';
      return [{ result }];
    };

    expect(await executors['fill']({ selector: '#title', value: '', tabId: 1 })).toEqual({ ok: true });

    // 真要写内容却被清空，仍然报 input-not-retained（升级键盘流）
    scriptCalls = 0;
    expect(await executors['fill']({ selector: '#title', value: 'hello', tabId: 1 })).toMatchObject({ ok: false, upgrade: 'cdp-keyboard' });
  }, 10000);
});
