/**
 * bridge-backed session（--session 统一路由）单元测试。
 *
 * 目标：`--session foo --bridge`（或 meta kind=bridge 的粘性识别）把会话路由到
 * chrome-bridge 通道——task-open 建任务组拿 tabId，BridgePage 把 XBPage 调用
 * 翻译成 /exec HTTP 命令，close 即 task-close。全程不启动浏览器、不落盘
 * （meta store 测试注入）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setBridgeMetaStoreForTests,
  findOrCreateBridgeSession,
} from '../../src/browser/bridge-session.js';
import { sessions } from '../../src/browser/state.js';
import type { ManagedSession } from '../../src/browser/state.js';

type ExecCall = { cmd: string; args: Record<string, unknown> };

let calls: ExecCall[];
let metaFiles: Record<string, Record<string, unknown>>;
let pageUrl: string;

function installBridgeFetch(): void {
  calls = [];
  pageUrl = 'about:blank';
  vi.stubGlobal('fetch', async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url) } as unknown as ExecCall);
    const record = calls[calls.length - 1];
    let body: { cmd?: string; args?: Record<string, unknown> } = {};
    try { body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}')); } catch { /* ignore */ }
    record.cmd = body.cmd ?? '';
    record.args = body.args ?? {};
    switch (body.cmd) {
      case 'task-open':
        return { ok: true, json: async () => ({ ok: true, data: { tabId: 4242, groupId: 7, reused: false, stealth: true } }) };
      case 'task-close':
        return { ok: true, json: async () => ({ ok: true, data: { closed: 1, ungrouped: 0 } }) };
      case 'navigate':
        pageUrl = String(body.args?.url ?? 'about:blank');
        return { ok: true, json: async () => ({ ok: true, data: { ok: true, tabId: 4242 } }) };
      case 'evaluate': {
        const expression = String(body.args?.expression ?? '');
        let value: unknown = null;
        if (expression.includes('readyState')) value = 'complete';
        else if (expression.includes('document.title')) value = 'Bridge Title';
        else if (expression.includes('location.href')) value = pageUrl;
        else if (expression.includes('visible')) value = { found: true, visible: true, text: 'ok', html: '', disabled: false };
        else if (expression.includes('getBoundingClientRect')) {
          const m = /\(\)\s*=>\s*true/.test(expression);
          if (m) value = true;
          else value = JSON.stringify({ x: 10, y: 20, width: 100, height: 40 });
        } else if (/\(\)\s*=>\s*true/.test(expression) || /^\(\(\)\s*=>\s*true\)\(\)$/.test(expression)) value = true;
        else if (expression.includes('querySelector')) value = true;
        return { ok: true, json: async () => ({ ok: true, data: { ok: true, value } }) };
      }
      case 'trustedClick':
      case 'type':
      case 'fill':
        return { ok: true, json: async () => ({ ok: true, data: { ok: true } }) };
      case 'screenshot':
        return { ok: true, json: async () => ({ ok: true, data: { ok: true, base64: Buffer.from('png').toString('base64') } }) };
      default:
        return { ok: true, json: async () => ({ ok: true, data: { ok: true } }) };
    }
  });
}

function metaStore() {
  return {
    read: (name: string) => (metaFiles[name] ? { ...metaFiles[name] } : null),
    save: (name: string, data: Record<string, unknown>) => { metaFiles[name] = { ...(metaFiles[name] ?? {}), ...data }; },
    delete: (name: string) => { delete metaFiles[name]; },
  };
}

beforeEach(() => {
  installBridgeFetch();
  metaFiles = {};
  __setBridgeMetaStoreForTests(metaStore());
});

afterEach(() => {
  for (const name of ['alpha', 'beta', 'plain']) sessions.remove(name);
  __setBridgeMetaStoreForTests(null);
  vi.unstubAllGlobals();
});

describe('findOrCreateBridgeSession routing', () => {
  it('returns null when no bridge meta and no --bridge flag (browser path untouched)', async () => {
    const result = await findOrCreateBridgeSession('plain');
    expect(result).toBeNull();
    expect(calls.map((c) => c.cmd)).toEqual([]);
  });

  it('creates a bridge session via task-open when --bridge flag is set and persists meta', async () => {
    const session = await findOrCreateBridgeSession('alpha', { preferBridge: true, url: 'https://a.example/' });
    expect(session).not.toBeNull();
    expect(calls.filter((c) => c.cmd === 'task-open').map((c) => c.args.name)).toEqual(['alpha']);
    expect(metaFiles['alpha']).toMatchObject({ kind: 'bridge', taskName: 'alpha' });
    expect(session?.bridge?.tabId).toBe(4242);
    expect(typeof session?.page?.goto).toBe('function');
  });

  it('sticks to the bridge channel via meta kind without the flag', async () => {
    metaFiles['beta'] = { kind: 'bridge', taskName: 'beta', id: 'id-beta' };
    const session = await findOrCreateBridgeSession('beta');
    expect(session).not.toBeNull();
    expect(calls.filter((c) => c.cmd === 'task-open').map((c) => c.args.name)).toEqual(['beta']);
    // 已有 id 时沿用，不换会话身份
    expect(session?.id).toBe('id-beta');
  });

  it('reuses the in-memory session without a second task-open', async () => {
    const first = await findOrCreateBridgeSession('alpha', { preferBridge: true });
    const second = await findOrCreateBridgeSession('alpha');
    expect(second).toBe(first);
    expect(calls.filter((c) => c.cmd === 'task-open')).toHaveLength(1);
  });
});

describe('BridgePage over /exec', () => {
  async function open(name = 'alpha'): Promise<ManagedSession> {
    const s = await findOrCreateBridgeSession(name, { preferBridge: true });
    if (!s) throw new Error('bridge session expected');
    return s;
  }

  it('goto navigates with the task tabId and waits for readiness', async () => {
    const s = await open();
    await s.page.goto('https://a.example/page1', { timeout: 5000 });
    const nav = calls.find((c) => c.cmd === 'navigate');
    expect(nav?.args).toMatchObject({ url: 'https://a.example/page1', tabId: 4242 });
    expect(calls.some((c) => c.cmd === 'evaluate' && String(c.args.expression).includes('readyState'))).toBe(true);
    expect(s.page.url()).toBe('https://a.example/page1');
  });

  it('title/evaluate round-trip through the bridge executor', async () => {
    const s = await open();
    await expect(s.page.title()).resolves.toBe('Bridge Title');
    await expect(s.page.evaluate('document.title')).resolves.toBe('Bridge Title');
    // Function 形参（executor 探活路径 () => true）必须能翻成表达式
    await expect(s.page.evaluate(() => true)).resolves.toBe(true);
  });

  it('click resolves the element center then dispatches a trusted click', async () => {
    const s = await open();
    await s.page.click('#btn');
    const evalCall = calls.find((c) => c.cmd === 'evaluate' && String(c.args.expression).includes('getBoundingClientRect'));
    expect(evalCall).toBeTruthy();
    const click = calls.find((c) => c.cmd === 'trustedClick');
    expect(click?.args).toMatchObject({ tabId: 4242 });
    const { x, y } = click!.args as { x: number; y: number };
    expect(x).toBe(60); // 10 + 100/2
    expect(y).toBe(40); // 20 + 40/2
  });

  it('screenshot returns a Buffer from the bridge base64 payload', async () => {
    const s = await open();
    const buf = await s.page.screenshot();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('png');
  });

  it('close issues task-close for its task and marks the page closed', async () => {
    const s = await open();
    await s.page.close();
    expect(calls.filter((c) => c.cmd === 'task-close').map((c) => c.args.name)).toEqual(['alpha']);
    expect(s.page.isClosed()).toBe(true);
  });

  it('surfaces bridge outage as a closed-style error so the executor rebuilds the session', async () => {
    const s = await open();
    vi.stubGlobal('fetch', async () => { throw new Error('fetch failed: ECONNREFUSED'); });
    await expect(s.page.evaluate('1')).rejects.toThrow(/closed/i);
  });
});
