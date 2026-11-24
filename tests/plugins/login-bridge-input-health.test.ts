/**
 * chrome-bridge 三缺陷回归（2026-11-24；判据来自有头 Chromium 实测）：
 *  1. 页面不可见时 Chrome 丢弃鼠标点击与原始按键事件——发这类事件的执行器先过
 *     输入健康门。实测：tab 在后台、窗口被遮挡时页面 outerWidth=0，mouseMoved /
 *     insertText 送达，mousePressed / keyDown 丢失；页面露出时全部送达，与窗口
 *     是否抢到焦点无关
 *  2. win-open 的 popup 窗口让后续 task-open 的 tabs.group 抛 "Grouping is not supported"
 *  3. task-open 复用注册表死 tab（已关/discarded）——复用前探活、清账、开新 tab
 *
 * 全程 mock（fake chrome 对象），不启动浏览器。
 */
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import chromeBridge from '../../.xcli/plugins/chrome-bridge/index.js';

type Window = { id: number; type: 'normal' | 'popup'; state: string; width: number; height: number };
type Group = { id: number; title: string; color?: string };
type Tab = { id: number; groupId: number; url?: string; windowId: number; active?: boolean; discarded?: boolean };

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
  windows: {
    getLastFocused: () => Promise<Window>;
    getAll: (opts?: { windowTypes?: string[] }) => Promise<Window[]>;
    get: (windowId: number) => Promise<Window>;
  };
  tabs: {
    query: (query: { groupId?: number; active?: boolean; currentWindow?: boolean; url?: string }) => Promise<Tab[]>;
    onRemoved: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    onUpdated: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    onReplaced: { addListener: ReturnType<typeof vi.fn> };
    get: (tabId: number) => Promise<Tab>;
    create: (options: { url: string; active: boolean; windowId?: number }) => Promise<Tab>;
    update: (tabId: number, changeInfo: Record<string, unknown>) => Promise<unknown>;
    group: (options: { tabIds: number | number[] }) => Promise<number>;
    move: (tabId: number, options: { windowId: number; index?: number }) => Promise<unknown>;
    remove: (tabId: number) => Promise<void>;
  };
  tabGroups: {
    query: () => Promise<Group[]>;
    update: (groupId: number, properties: { title?: string; color?: string }) => Promise<void>;
  };
  storage: {
    local: {
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

async function loadExecutors(chrome: ChromeLike): Promise<Record<string, Executor>> {
  const source = await readFile(new URL('../../.xcli/plugins/login-bridge/extension/background.js', import.meta.url), 'utf8');
  vi.stubGlobal('chrome', chrome);
  vi.stubGlobal('WebSocket', class FakeWebSocket {
    readyState = 1;
    close(): void {}
    onopen: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    onmessage: unknown = null;
  });
  // Raw concatenation: background source contains template literals and
  // interpolating it into another template corrupts its syntax.
  const load = new Function('globalThis', source + '\n; return async () => executors;');
  return await load(globalThis)() as Record<string, Executor>;
}

function createChrome(opts: { popupLastFocused?: boolean; outer?: [number, number] | null } = {}) {
  const normalWindow: Window = { id: 1, type: 'normal', state: 'normal', width: 1920, height: 1080 };
  const windows: Window[] = [normalWindow];
  if (opts.popupLastFocused) {
    windows.push({ id: 7, type: 'popup', state: 'normal', width: 900, height: 640 });
  }
  const groups: Group[] = [];
  const tabs: Tab[] = [];
  const removed: number[] = [];
  const inputDispatches: Array<{ method: string; params: unknown }> = [];
  let attachCalls = 0;
  let nextGroupId = 1000;
  let nextTabId = 10;
  const storageState: Record<string, unknown> = {};

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
      attach: (_target, _version, callback) => { attachCalls += 1; callback(); },
      sendCommand: (_target, method, params, callback) => {
        if (String(method).startsWith('Input.')) inputDispatches.push({ method: String(method), params });
        callback(method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script' } : undefined);
      },
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: {
      getLastFocused: async () => (opts.popupLastFocused ? windows[windows.length - 1] : normalWindow),
      getAll: async (query?: { windowTypes?: string[] }) =>
        query?.windowTypes ? windows.filter((w) => query.windowTypes!.includes(w.type)) : [...windows],
      get: async (windowId: number) => {
        const win = windows.find((w) => w.id === windowId);
        if (!win) throw new Error(`No window with id: ${windowId}`);
        return win;
      },
    },
    tabs: {
      query: async (query) => {
        if (query.url) return tabs.filter((tab) => (tab.url ?? '').includes('example.com'));
        return query.groupId == null ? tabs : tabs.filter((tab) => tab.groupId === query.groupId);
      },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onReplaced: { addListener: vi.fn() },
      get: async (tabId: number) => {
        const tab = tabs.find((item) => item.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      create: async (options) => {
        const tab: Tab = { id: nextTabId++, groupId: -1, url: options.url, active: options.active, windowId: options.windowId ?? (opts.popupLastFocused ? 7 : 1) };
        tabs.push(tab);
        return tab;
      },
      update: vi.fn(async () => ({})),
      group: async ({ tabIds }) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) {
          const tab = tabs.find((item) => item.id === id);
          const win = tab ? windows.find((w) => w.id === tab.windowId) : undefined;
          // 与真实 Chrome 一致：非 normal 窗口（popup/app）不支持 tabs.group
          if (!win || win.type !== 'normal') throw new Error('Grouping is not supported');
        }
        const group: Group = { id: nextGroupId++, title: '' };
        groups.push(group);
        for (const id of ids) {
          const tab = tabs.find((item) => item.id === id);
          if (tab) tab.groupId = group.id;
        }
        return group.id;
      },
      move: async (tabId, options) => {
        const tab = tabs.find((item) => item.id === tabId);
        if (tab) tab.windowId = options.windowId;
        return {};
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
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          const ks = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of ks) if (k in storageState) out[k] = storageState[k];
          return out;
        },
        set: async (values) => { Object.assign(storageState, values); },
      },
    },
    cookies: {
      getAll: async () => [],
    },
    scripting: {
      // 输入健康门用 executeScript 在页面里量 outerWidth；outer=null 模拟无宿主权限
      // （chrome:// 等）的页面。其余调用（fill / click 等）保持原样。
      executeScript: async (options) => {
        if (String((options as { func?: unknown }).func).includes('outerWidth')) {
          if (opts.outer === null) throw new Error('Cannot access contents of the page');
          return [{ result: opts.outer ?? [1920, 1080] }];
        }
        return [{ result: [] }];
      },
    },
  };

  return {
    chrome, windows, groups, tabs, removed, inputDispatches, storageState,
    state: {
      get attachCalls() { return attachCalls; },
      get createdCount() { return nextTabId - 10; },
    },
  };
}

function seedZombieTaskGroup(harness: ReturnType<typeof createChrome>, tabId: number): void {
  harness.groups.push({ id: 500, title: 'xb-task-zombie', color: 'blue' });
  harness.tabs.push({ id: tabId, groupId: 500, url: 'about:blank', windowId: 1 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('input-health probe executor', () => {
  type Health = {
    ok: boolean; tabActive: boolean | null; outerWidth: number | null; discarded: boolean | null;
    windowState: string | null; windowType: string | null; reason: string;
  };
  const VISIBLE: [number, number] = [1920, 1080];
  const HIDDEN: [number, number] = [0, 0];
  const withTab = (harness: ReturnType<typeof createChrome>, tab: Partial<Tab> & { id: number }): void => {
    harness.tabs.push({ groupId: -1, url: 'about:blank', windowId: 1, ...tab });
  };

  it('reports a visible page as healthy with its window facts', async () => {
    const harness = createChrome({ outer: VISIBLE });
    withTab(harness, { id: 55, active: true, url: 'https://example.com' });
    const executors = await loadExecutors(harness.chrome);

    const health = await executors['input-health']({ tabId: 55 }) as Health;
    expect(health).toMatchObject({ ok: true, tabActive: true, outerWidth: 1920, windowType: 'normal', windowState: 'normal' });
  });

  it('reports a background tab as a place clicks and key events are dropped', async () => {
    const harness = createChrome({ outer: HIDDEN });
    withTab(harness, { id: 55, active: false });
    const executors = await loadExecutors(harness.chrome);

    const health = await executors['input-health']({ tabId: 55 }) as Health;
    expect(health.ok).toBe(false);
    expect(health.tabActive).toBe(false);
    expect(health.reason).toContain('不可见');
  });

  it('reports an active tab whose window is hidden the same way (occluded / minimized)', async () => {
    // 活动页只是必要条件：窗口被完全遮挡时页面同样不可见、输入同样丢失
    const harness = createChrome({ outer: HIDDEN });
    withTab(harness, { id: 55, active: true });
    const executors = await loadExecutors(harness.chrome);

    const health = await executors['input-health']({ tabId: 55 }) as Health;
    expect(health).toMatchObject({ ok: false, tabActive: true, outerWidth: 0 });
    expect(health.reason).toContain('不可见');
  });

  it('goes by the page, not by the window record', async () => {
    const harness = createChrome({ outer: VISIBLE });
    harness.windows[0] = { id: 1, type: 'normal', state: 'minimized', width: 0, height: 0 };
    withTab(harness, { id: 55, active: true });
    const executors = await loadExecutors(harness.chrome);

    const health = await executors['input-health']({ tabId: 55 }) as Health;
    expect(health.ok).toBe(true);
    expect(health.windowState).toBe('minimized');
  });

  it('falls back to the active flag when the page cannot be probed', async () => {
    const visible = createChrome({ outer: null });
    withTab(visible, { id: 55, active: true });
    const background = createChrome({ outer: null });
    withTab(background, { id: 56, active: false });

    const ok = await (await loadExecutors(visible.chrome))['input-health']({ tabId: 55 }) as Health;
    const notOk = await (await loadExecutors(background.chrome))['input-health']({ tabId: 56 }) as Health;
    expect(ok).toMatchObject({ ok: true, outerWidth: null });
    expect(notOk).toMatchObject({ ok: false, tabActive: false });
    expect(notOk.reason).toContain('后台');
  });

  it('reports a discarded tab without making it the verdict', async () => {
    const harness = createChrome({ outer: VISIBLE });
    withTab(harness, { id: 55, active: true, discarded: true });
    const executors = await loadExecutors(harness.chrome);

    const health = await executors['input-health']({ tabId: 55 }) as Health;
    expect(health.discarded).toBe(true);
  });

  it('reports a closed tab as unhealthy instead of throwing', async () => {
    const harness = createChrome();
    const executors = await loadExecutors(harness.chrome);

    const health = await executors['input-health']({ tabId: 99999 }) as { ok: boolean; reason: string };
    expect(health.ok).toBe(false);
    expect(health.reason).toContain('不存在');
  });
});

describe('input-health gate on trusted input', () => {
  /** 执行器跑完是 resolve 还是 reject（reject 时给出消息），用来断言「不是被门拦的」 */
  async function outcome(p: Promise<unknown>): Promise<string> {
    try { await p; return 'resolved'; } catch (e) { return String((e as Error)?.message ?? e); }
  }

  it('trustedClick fails fast on a hidden page without dispatching input', async () => {
    const harness = createChrome({ outer: [0, 0] });
    harness.tabs.push({ id: 55, groupId: -1, url: 'about:blank', windowId: 1, active: false });
    const executors = await loadExecutors(harness.chrome);

    await expect(executors.trustedClick({ x: 10, y: 20, tabId: 55 }))
      .rejects.toThrow(/\[bridge-input\][\s\S]*tab-activate[\s\S]*tab-move[\s\S]*win-open/);
    expect(harness.inputDispatches).toHaveLength(0);
    expect(harness.state.attachCalls).toBe(0); // 门挡在 attach 之前
  });

  it('trustedClick dispatches input for an active tab (existing behaviour)', async () => {
    const harness = createChrome();
    harness.tabs.push({ id: 55, groupId: -1, url: 'about:blank', windowId: 1, active: true });
    const executors = await loadExecutors(harness.chrome);

    const r = await executors.trustedClick({ x: 10, y: 20, tabId: 55 }) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(harness.inputDispatches.map((d) => d.method)).toEqual([
      'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent',
    ]);
  });

  it('gates trustedDrag, trusted-type, trusted-enter and type on a hidden page', async () => {
    const harness = createChrome({ outer: [0, 0] });
    harness.tabs.push({ id: 55, groupId: -1, url: 'about:blank', windowId: 1, active: false });
    const executors = await loadExecutors(harness.chrome);
    const calls: Array<[string, Promise<unknown>]> = [
      ['trustedDrag', executors.trustedDrag({ sx: 1, sy: 1, ex: 2, ey: 2, steps: 2, tabId: 55 })],
      ['trusted-type', executors['trusted-type']({ text: 'hi', tabId: 55 })],
      ['trusted-enter', executors['trusted-enter']({ tabId: 55 })],
      ['type', executors.type({ selector: '#q', text: 'hi', tabId: 55 })],
    ];

    for (const [name, call] of calls) {
      expect(await outcome(call), name).toMatch(/\[bridge-input\]/);
    }
    expect(harness.inputDispatches).toHaveLength(0);
  });

  it('cdp gates clicks and key events on a hidden page, nothing else', async () => {
    const harness = createChrome({ outer: [0, 0] });
    harness.tabs.push({ id: 55, groupId: -1, url: 'about:blank', windowId: 1, active: false });
    const executors = await loadExecutors(harness.chrome);

    for (const [method, params] of [
      ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 }],
      ['Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1 }],
      ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'a' }],
    ] as const) {
      await expect(executors.cdp({ method, params, tabId: 55 })).rejects.toThrow(/\[bridge-input\]/);
    }
    expect(harness.inputDispatches).toHaveLength(0);

    // 实测这几类在后台 tab 照常送达，不该被误拦
    const move = await executors.cdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 1 }, tabId: 55 }) as { ok: boolean };
    const text = await executors.cdp({ method: 'Input.insertText', params: { text: 'a' }, tabId: 55 }) as { ok: boolean };
    const ev = await executors.cdp({ method: 'Runtime.evaluate', params: { expression: '1' }, tabId: 55 }) as { ok: boolean };
    expect([move.ok, text.ok, ev.ok]).toEqual([true, true, true]);
    expect(harness.inputDispatches.map((d) => d.method)).toEqual(['Input.dispatchMouseEvent', 'Input.insertText']);
  });

  it('leaves page-script and warm-up executors alone on a hidden page', async () => {
    const harness = createChrome({ outer: [0, 0] });
    harness.tabs.push({ id: 55, groupId: -1, url: 'about:blank', windowId: 1, active: false });
    const executors = await loadExecutors(harness.chrome);

    for (const [name, call] of [
      ['click', executors.click({ selector: '#q', tabId: 55 })],
      ['fill', executors.fill({ selector: '#q', value: 'v', tabId: 55 })],
      ['warmup', executors.warmup({ tabId: 55 })],
    ] as Array<[string, Promise<unknown>]>) {
      expect(await outcome(call), name).not.toMatch(/\[bridge-input\]/);
    }
  });
});

describe('task-open zombie reuse', () => {
  it('drops a registry tab whose tabs.get rejects and creates a fresh tab', async () => {
    const harness = createChrome();
    seedZombieTaskGroup(harness, 55);
    harness.chrome.tabs.get = async (tabId: number) => {
      if (tabId === 55) throw new Error('No tab with id: 55');
      const tab = harness.tabs.find((item) => item.id === tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}`);
      return tab;
    };
    const executors = await loadExecutors(harness.chrome);
    harness.storageState['taskTabs'] = [55];

    const r = await executors['task-open']({ name: 'zombie', url: 'https://example.com/x' }) as { tabId: number; reused?: boolean };
    expect(r.reused).toBeUndefined(); // 旧代码此处 reused:true + 死 tabId 55
    expect(r.tabId).not.toBe(55);
    expect(harness.tabs.some((tab) => tab.id === r.tabId)).toBe(true);
    expect(harness.removed).toContain(55); // 死 tab 清出组
    expect(harness.storageState['taskTabs']).not.toContain(55); // 注册表清账
  });

  it('treats a discarded tab as stale and creates a fresh tab', async () => {
    const harness = createChrome();
    seedZombieTaskGroup(harness, 55);
    harness.tabs[0].discarded = true;
    const executors = await loadExecutors(harness.chrome);

    const r = await executors['task-open']({ name: 'zombie', url: 'https://example.com/x' }) as { tabId: number; reused?: boolean };
    expect(r.reused).toBeUndefined();
    expect(r.tabId).not.toBe(55);
    expect(harness.removed).toContain(55);
  });

  it('keeps reusing a healthy tab (existing behaviour unchanged)', async () => {
    const harness = createChrome();
    seedZombieTaskGroup(harness, 55);
    const executors = await loadExecutors(harness.chrome);

    const r = await executors['task-open']({ name: 'zombie', url: 'https://example.com/x' }) as { tabId: number; reused?: boolean };
    expect(r.reused).toBe(true);
    expect(r.tabId).toBe(55);
    expect(harness.state.createdCount).toBe(0);
    expect(harness.removed).toHaveLength(0);
  });
});

describe('task-open grouping degrade', () => {
  it('moves the tab to a normal window and groups there when grouping is unsupported', async () => {
    const harness = createChrome({ popupLastFocused: true }); // win-open 的 popup 成为 lastFocused
    const executors = await loadExecutors(harness.chrome);

    const r = await executors['task-open']({ name: 'degrade', url: 'https://example.com/x' }) as { tabId: number; groupId: number | null; reused?: boolean };
    expect(r.reused).toBeUndefined(); // 旧代码整体抛 "Grouping is not supported"
    const tab = harness.tabs.find((item) => item.id === r.tabId);
    expect(tab).toBeTruthy(); // 返回可用 tab
    expect(tab!.windowId).toBe(1); // 已搬进 normal 窗口
    expect(r.groupId).not.toBeNull();
    expect(harness.groups.find((g) => g.id === r.groupId)?.title).toBe('xb-task-degrade');
  });

  it('returns a usable ungrouped tab when no normal window exists', async () => {
    const harness = createChrome({ popupLastFocused: true });
    harness.windows.splice(0, 1); // 只剩 popup，无 normal 窗口
    const executors = await loadExecutors(harness.chrome);

    const r = await executors['task-open']({ name: 'solo', url: 'https://example.com/x' }) as { tabId: number; groupId: number | null };
    const tab = harness.tabs.find((item) => item.id === r.tabId);
    expect(tab).toBeTruthy();
    expect(r.groupId).toBeNull();
  });
});

// ── chrome-bridge CLI 侧：input-health 诊断命令 ──────────────

type Site = { command: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };

function getHandler(site: Site, name: string): (params: Record<string, unknown>) => Promise<unknown> {
  const call = site.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: Record<string, unknown>) => Promise<unknown> }).handler;
}

describe('chrome-bridge input-health command', () => {
  it('posts the health probe to the bridge and returns the report', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return { json: async () => ({ ok: true, data: { ok: false, tabActive: false, reason: 'tab 在后台' } }) };
    });
    const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
    chromeBridge({ createSite: vi.fn(() => site) } as never);

    const handler = getHandler(site, 'input-health');
    const r = await handler({ tabId: 42 }) as { success: boolean; data: { ok: boolean; tabActive: boolean } };
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ ok: false, tabActive: false });
    expect(bodies[0]).toMatchObject({ cmd: 'input-health', args: { tabId: 42 } });
  });

  it('fails with an actionable message when the bridge is down', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
    chromeBridge({ createSite: vi.fn(() => site) } as never);

    const r = await getHandler(site, 'input-health')({}) as { success: boolean; message: string };
    expect(r.success).toBe(false);
    expect(r.message).toContain('bridge');
  });
});
