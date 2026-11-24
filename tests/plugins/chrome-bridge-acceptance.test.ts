/**
 * chrome-bridge acceptance 的探针阶段与通道地址（2026-11-24）：
 *  - 探针失败时带出真实原因与健康报告（以前一律吞成一句笼统的话）
 *  - 页面不可见（浏览器窗口被遮挡 / 在别的桌面）时不派发点击——派发也必被 Chrome 丢弃
 *  - 插件命令跟随 XBROWSER_BRIDGE_HTTP：此前端口写死，隔离环境里跑验收直接打到了现网
 *
 * 全程 mock fetch 与证据文件写入，不碰任何 bridge。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 插件在模块加载时读环境变量：必须在 import 之前设好
vi.hoisted(() => {
  process.env.XBROWSER_BRIDGE_HTTP = 'http://127.0.0.1:19447';
});

const evidence = vi.hoisted(() => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, ...evidence };
});

import chromeBridge from '../../.xcli/plugins/chrome-bridge/index.js';

type Handler = (params: Record<string, unknown>) => Promise<{ success: boolean; data?: Record<string, unknown> }>;
type Call = { url: string; cmd?: string; args?: Record<string, unknown> };

const ISOLATED = 'http://127.0.0.1:19447';
const PRODUCTION = 'http://127.0.0.1:9347';
const VISIBLE = { ok: true, tabId: 42, tabActive: true, discarded: false, outerWidth: 1280, outerHeight: 800, windowState: 'normal', reason: '' };
const HIDDEN = {
  ok: false, tabId: 42, tabActive: true, discarded: false, outerWidth: 0, outerHeight: 0, windowState: 'normal',
  reason: '页面不可见（outerWidth=0：tab 在后台，或窗口最小化 / 被完全遮挡）',
};

function loadSite(): { site: { command: ReturnType<typeof vi.fn> }; handler: (name: string) => Handler } {
  const site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  chromeBridge({ createSite: vi.fn(() => site) } as never);
  return {
    site,
    handler: (name) => {
      const call = site.command.mock.calls.find((c: unknown[]) => c[0] === name);
      if (!call) throw new Error(`${name} not registered`);
      return (call[1] as { handler: Handler }).handler;
    },
  };
}

interface ProbeOptions {
  /** 每次 input-health 探测依次返回的结果（用完后重复最后一项） */
  health: Array<Record<string, unknown>>;
  /** trustedClick 执行器的返回体 */
  click?: { ok: boolean; error?: string };
  /** 点击后探针页面上的标记 */
  probeResult?: string;
}

/** 按命令路由的假 bridge：记录每次调用，返回与真实通道同形状的响应 */
function stubBridge(options: ProbeOptions): Call[] {
  const calls: Call[] = [];
  let healthPolls = 0;
  global.fetch = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) as { cmd?: string; args?: Record<string, unknown> } : undefined;
    calls.push({ url, cmd: body?.cmd, args: body?.args });
    const reply = (data: unknown): unknown => ({ ok: true, data });
    if (url.endsWith('/status')) {
      return { json: async () => ({ running: true, port: 19446, clients: [{}], ext: { extId: 'ext-1', v: '1.5.5' } }) } as unknown as Response;
    }
    switch (body?.cmd) {
      case 'ext-reload': return { json: async () => reply({ ok: true, reloading: true }) } as unknown as Response;
      case 'win-diag': return { json: async () => reply({ windows: [] }) } as unknown as Response;
      case 'tab-diag': return { json: async () => reply({ tabs: [] }) } as unknown as Response;
      case 'task-open': return { json: async () => reply({ tabId: 42, groupId: 7 }) } as unknown as Response;
      case 'task-close': return { json: async () => reply({ closed: 1, ungrouped: 0 }) } as unknown as Response;
      case 'cdp': return { json: async () => reply({ ok: true, data: {} }) } as unknown as Response;
      case 'evaluate': {
        const expression = String(body.args?.expression ?? '');
        const value = expression.includes('getBoundingClientRect')
          ? JSON.stringify({ x: 40, y: 40, w: 120, h: 48 })
          : (options.probeResult ?? 'trusted-click-passed');
        return { json: async () => reply({ ok: true, value }) } as unknown as Response;
      }
      case 'input-health': {
        const list = options.health;
        const report = list[Math.min(healthPolls, list.length - 1)];
        healthPolls += 1;
        return { json: async () => reply(report) } as unknown as Response;
      }
      case 'trustedClick':
        return { json: async () => (options.click?.ok === false
          ? { ok: true, data: options.click }
          : reply({ ok: true, clicked: '100,64' })) } as unknown as Response;
      default:
        return { json: async () => ({ ok: false, error: `unexpected cmd in test: ${String(body?.cmd)}` }) } as unknown as Response;
    }
  }) as unknown as typeof fetch;
  return calls;
}

const cmds = (calls: Call[]): string[] => calls.map((c) => c.cmd ?? 'status');

describe('chrome-bridge acceptance probe', () => {
  const run = (options: ProbeOptions): Promise<{ result: Record<string, unknown>; calls: Call[] }> => {
    const calls = stubBridge(options);
    return loadSite().handler('acceptance')({ expectedVersion: '1.5.5' }).then((r) => ({ result: r.data ?? {}, calls }));
  };

  beforeEach(() => {
    evidence.mkdirSync.mockReset();
    evidence.writeFileSync.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.XBROWSER_BRIDGE_HTTP = ISOLATED;
  });

  it('passes once the page is visible and the click lands', async () => {
    const { result, calls } = await run({ health: [VISIBLE] });

    expect(result).toMatchObject({ ok: true, phase: 'done', reloaded: true, connected: true, version: '1.5.5' });
    expect(result.trustedClick).toMatchObject({ skipped: false, passed: true, tabId: 42 });
    const order = cmds(calls);
    expect(order.indexOf('input-health')).toBeLessThan(order.indexOf('trustedClick'));
    expect(order[order.length - 1]).toBe('task-close');
  });

  it('waits for the page to become visible before clicking', async () => {
    const { result, calls } = await run({ health: [HIDDEN, VISIBLE] });

    expect(result).toMatchObject({ ok: true, phase: 'done' });
    expect(calls.filter((c) => c.cmd === 'input-health')).toHaveLength(2);
    expect(calls.filter((c) => c.cmd === 'trustedClick')).toHaveLength(1);
  });

  it('does not dispatch a click while the page stays invisible, and says why', async () => {
    const { result, calls } = await run({ health: [HIDDEN] });

    expect(result).toMatchObject({ ok: false, phase: 'trusted-click', reloaded: true, connected: true });
    expect(calls.some((c) => c.cmd === 'trustedClick')).toBe(false);
    expect(String(result.error)).toContain('探针页面不可见');
    expect(String(result.error)).toContain(String(HIDDEN.reason));
    const probe = result.trustedClick as { passed: boolean; error?: string; health: Record<string, unknown> };
    expect(probe.passed).toBe(false);
    expect(probe.error).toBe(String(result.error));
    expect(probe.health).toMatchObject({ ok: false, tabActive: true, outerWidth: 0 });
    expect(cmds(calls)[cmds(calls).length - 1]).toBe('task-close');
  });

  it('keeps the reason the executor gave for a rejected click', async () => {
    const { result } = await run({
      health: [VISIBLE, VISIBLE],
      click: { ok: false, error: '[bridge-input] 页面不可见：Chrome drops mouse clicks' },
    });

    expect(result).toMatchObject({ ok: false, phase: 'trusted-click' });
    expect(String(result.error)).toContain('[bridge-input]');
  });

  it('says when the click was dispatched but the probe page saw nothing', async () => {
    const { result } = await run({ health: [VISIBLE], probeResult: 'pending' });

    expect(result).toMatchObject({ ok: false, phase: 'trusted-click' });
    expect(String(result.error)).toContain('点击已派发但探针未记录到');
    expect(String(result.error)).toContain('pending');
  });

  it('saves the evidence file instead of writing into the working tree', async () => {
    await run({ health: [VISIBLE] });
    expect(evidence.writeFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('chrome-bridge plugin follows XBROWSER_BRIDGE_HTTP', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ json: async () => ({ running: true, port: 19446, clients: [], ext: null }) }) as unknown as Response);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.XBROWSER_BRIDGE_HTTP = ISOLATED;
  });

  it('sends every status probe and exec to the isolated bridge', async () => {
    const { handler } = loadSite();
    await handler('status')({});

    const urls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(`${ISOLATED}/`)).toBe(true);
  });

  it('falls back to the production bridge when the variable is unset', async () => {
    vi.stubEnv('XBROWSER_BRIDGE_HTTP', '');
    vi.resetModules();
    const fresh = (await import('../../.xcli/plugins/chrome-bridge/index.js')).default as (xcli: unknown) => void;
    const site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
    fresh({ createSite: vi.fn(() => site) } as never);
    const call = site.command.mock.calls.find((c: unknown[]) => c[0] === 'status');
    await (call![1] as { handler: Handler }).handler({});

    const urls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe(`${PRODUCTION}/status`);
  });
});
