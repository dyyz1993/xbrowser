import { describe, it, expect, vi, afterEach } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
// @ts-expect-error -- 插件 .cjs 无类型声明（运行时消费）
import StealthCommon from '../../.xcli/plugins/login-bridge/extension/stealth-common.cjs';

const SUPPRESSION_SOURCE: string = (StealthCommon as unknown as { DIALOG_SUPPRESSION_SOURCE: string }).DIALOG_SUPPRESSION_SOURCE;

describe('S213 DIALOG_SUPPRESSION_SOURCE（vm 单测）', () => {
  it('beforeunload 注册被吞、其余事件正常注册', () => {
    class FreshET extends EventTarget {}
    const sandbox: Record<string, unknown> = { window: {}, EventTarget: FreshET };
    sandbox.window = sandbox;
    runInNewContext(SUPPRESSION_SOURCE, sandbox);
    const t = new FreshET();
    const fired: string[] = [];
    t.addEventListener('beforeunload', () => fired.push('bu')); // 应被吞
    t.addEventListener('click', () => fired.push('click')); // 应正常注册
    t.dispatchEvent(new Event('beforeunload'));
    t.dispatchEvent(new Event('click'));
    expect(fired).toEqual(['click']);
    expect((sandbox.window as Record<string, unknown>).__xbDialogSuppressed).toBe(true);
  });

  it('三件套消音：alert 无操作、confirm false、prompt null', () => {
    class FreshET extends EventTarget {}
    const sandbox: Record<string, unknown> = { window: {}, EventTarget: FreshET };
    sandbox.window = sandbox;
    runInNewContext(SUPPRESSION_SOURCE, sandbox);
    const w = sandbox.window as { alert: () => void; confirm: () => boolean; prompt: () => null };
    expect(typeof w.alert).toBe('function');
    expect(w.confirm('离开此网站?')).toBe(false);
    expect(w.prompt('输入')).toBeNull();
  });

  it('幂等：重复注入不叠加', () => {
    class FreshET extends EventTarget {}
    const sandbox: Record<string, unknown> = { window: {}, EventTarget: FreshET };
    sandbox.window = sandbox;
    runInNewContext(SUPPRESSION_SOURCE, sandbox);
    runInNewContext(SUPPRESSION_SOURCE, sandbox);
    expect((sandbox.window as Record<string, unknown>).__xbDialogSuppressed).toBe(true);
  });
});

// ── chrome-mock 集成：双注入 + javascriptDialogOpening 自动应答 ──

interface SendCommandLogEntry {
  method: string;
  params?: Record<string, unknown>;
}

type DebuggerMock = {
  attach: (target: unknown, version: string, callback: (error?: unknown) => void) => void;
  sendCommand: (target: unknown, method: string, params: unknown, callback: (result?: unknown) => void) => void;
  onDetach: { addListener: ReturnType<typeof vi.fn> };
  onEvent: { addListener: ReturnType<typeof vi.fn> };
};

function createDebuggerMock() {
  const log: SendCommandLogEntry[] = [];
  const onEventListeners: Array<Function> = [];
  const debuggerMock: DebuggerMock & { log: SendCommandLogEntry[]; dispatchEvent: (source: unknown, method: string, params: Record<string, unknown>) => void; onEventListeners: Array<Function> } = {
    log,
    onEventListeners,
    attach: (_target, _version, callback) => callback(),
    sendCommand: (target, method, params, callback) => {
      log.push({ method, params: params as Record<string, unknown> });
      callback(method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script' } : undefined);
    },
    onDetach: { addListener: vi.fn() },
    onEvent: {
      addListener: vi.fn((fn: Function) => {
        onEventListeners.push(fn);
      }),
      removeListener: vi.fn((fn: Function) => {
        const i = onEventListeners.indexOf(fn);
        if (i >= 0) onEventListeners.splice(i, 1);
      }),
    },
    dispatchEvent(source, method, params) {
      for (const fn of onEventListeners) fn(source, method, params);
    },
  };
  return debuggerMock;
}

async function loadBackgroundWithTaskOpen() {
  const dbg = createDebuggerMock();
  const source = await readFile(
    new URL('../../.xcli/plugins/login-bridge/extension/background.js', import.meta.url),
    'utf8',
  );
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-ext', lastError: undefined, getManifest: () => ({ version: 'test' }), onMessage: { addListener: vi.fn() } },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    debugger: dbg,
    tabs: {
      query: vi.fn(async () => []),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onReplaced: { addListener: vi.fn() },
      create: vi.fn(async () => ({ id: 777 })),
      group: vi.fn(async () => 555),
      remove: vi.fn(async () => {}),
      ungroup: vi.fn(async () => {}),
    },
    tabGroups: {
      query: vi.fn(async () => []),
      update: vi.fn(async () => {}),
    },
    windows: {
      create: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => ({})),
    },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
    cookies: { getAll: vi.fn(async () => []) },
    scripting: { executeScript: vi.fn(async () => [{ result: null }]) },
  });
  vi.stubGlobal('WebSocket', class FakeWebSocket {
    readyState = 1;
    close(): void {}
    onopen: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    onmessage: unknown = null;
    send(): void {}
  });
  const load = new Function('globalThis', source + '\n; return async () => executors;');
  const executors = (await load(globalThis)()) as Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  return { dbg, executors };
}

describe('S213 集成：enableTaskStealth 双注入 + 弹窗自动应答', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('task-open 注入可见性伪装与打断源压制两个 document_start 脚本', async () => {
    const { dbg, executors } = await loadBackgroundWithTaskOpen();
    await executors['task-open']({ name: 'sup', url: 'https://example.com' });
    const initScripts = dbg.log.filter((e) => e.method === 'Page.addScriptToEvaluateOnNewDocument');
    expect(initScripts.length).toBe(2);
    const sources = initScripts.map((e) => String(e.params?.source ?? ''));
    expect(sources[0]).toContain('__xbVisStealth');
    expect(sources[1]).toContain('__xbDialogSuppressed');
    expect(sources[1]).toContain('beforeunload');
  });

  it('任务 tab 上 javascriptDialogOpening 自动 accept（兜底应答）', async () => {
    const { dbg, executors } = await loadBackgroundWithTaskOpen();
    await executors['task-open']({ name: 'sup', url: 'https://example.com' });
    const before = dbg.log.filter((e) => e.method === 'Page.handleJavaScriptDialog').length;
    // 触发 onEvent 监听器（模拟对话框打开事件）
    dbg.dispatchEvent({ tabId: 777 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '离开此网站?' });
    await new Promise((r) => setTimeout(r, 50));
    const handles = dbg.log.filter((e) => e.method === 'Page.handleJavaScriptDialog');
    expect(handles.length).toBeGreaterThan(before);
    expect(handles[handles.length - 1].params).toMatchObject({ accept: true });
  });

  it('非任务 tab（未注册 stealth）不自动应答对话框', async () => {
    const { dbg, executors } = await loadBackgroundWithTaskOpen();
    await executors['task-open']({ name: 'sup', url: 'https://example.com' });
    const before = dbg.log.filter((e) => e.method === 'Page.handleJavaScriptDialog').length;
    dbg.dispatchEvent({ tabId: 424242 }, 'Page.javascriptDialogOpening', { type: 'alert', message: 'x' });
    await new Promise((r) => setTimeout(r, 50));
    const handles = dbg.log.filter((e) => e.method === 'Page.handleJavaScriptDialog');
    expect(handles.length).toBe(before);
  });
});
