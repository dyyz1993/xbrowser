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
    create: (options: { url: string; active: boolean }) => Promise<Tab>;
    update: (tabId: number, changeInfo: { url?: string }) => Promise<unknown>;
    group: (options: { tabIds: number | number[] }) => Promise<number>;
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

const EXPECTED_COLORS = ['blue', 'purple', 'cyan', 'green', 'yellow', 'red', 'pink', 'orange'];

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

function createChrome() {
  const groups: Group[] = [];
  const tabs: Tab[] = [];
  let nextGroupId = 1000;
  let nextTabId = 10;
  const updates: Array<{ id: number; title?: string; color?: string }> = [];
  const removed: number[] = [];
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
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
      },
    },
    cookies: {
      getAll: async () => [],
    },
    scripting: {
      executeScript: async () => [{ result: [] }],
    },
  };

  return { chrome, groups, tabs, updates, removed, state: { get createdCount() { return createdCount; } } };
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
