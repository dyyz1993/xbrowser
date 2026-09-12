/**
 * chrome-bridge plugin tests: serve/status command behavior with mocked
 * fetch/child_process. exec/cdp/task/open are protocol passthrough commands
 * whose result payloads come from the extension over the bridge — covered
 * by their fail-path (bridge down) here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import chromeBridge from '../../.xcli/plugins/chrome-bridge/index.js';

type Site = { command: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
type Xcli = { createSite: ReturnType<typeof vi.fn> };

function makeMock(): { site: Site; xcli: Xcli } {
  const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  const xcli: Xcli = { createSite: vi.fn(() => site) };
  return { site, xcli };
}

function getCmd(site: Site, name: string): (params: unknown, ctx?: unknown) => Promise<unknown> {
  const call = site.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: unknown, c?: unknown) => Promise<unknown> }).handler;
}

function mockFetchSequence(responses: Array<{ ok?: boolean; json?: () => Promise<unknown> }>): void {
  global.fetch = vi.fn()
    .mockImplementation(() => Promise.resolve(responses.shift() ?? { ok: false }));
}

const spawnSpy = vi.fn(() => ({ unref: vi.fn() }));

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => (globalThis as unknown as { __spawnSpy: ReturnType<typeof vi.fn> }).__spawnSpy(...(args as [])),
}));

// S212 revive：execFile 必须拦下（不能真开浏览器），fs 决定扩展 ID 记录是否存在。
// 注意：vitest 把 'child_process' 与 'node:child_process' 别名到同一模块——
// 两个 specifier 的 mock 必须同形（都导出 spawn+execFile），否则互相遮蔽
const execFileSpy = vi.fn((_cmd: string, _args: unknown[], _opts: unknown, cb: (e: null, o: string, e2: string) => void) => {
  cb(null, '', '');
});
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => (globalThis as unknown as { __spawnSpy: ReturnType<typeof vi.fn> }).__spawnSpy(...(args as [])),
  execFile: (cmd: string, a2: unknown[], o: unknown, cb: (e: null, ou: string, er: string) => void): void => {
    (globalThis as unknown as { __execFileSpy: typeof execFileSpy }).__execFileSpy(cmd, a2, o, cb);
  },
}));
vi.mock('node:fs', () => ({
  readFileSync: () => {
    const mode = (globalThis as unknown as { __fsRead: string }).__fsRead;
    if (mode === 'THROW') throw new Error('ENOENT');
    return mode;
  },
}));

describe('chrome-bridge plugin', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { __spawnSpy: ReturnType<typeof vi.fn> }).__spawnSpy = spawnSpy;
    (globalThis as unknown as { __execFileSpy: typeof execFileSpy }).__execFileSpy = execFileSpy;
    (globalThis as unknown as { __fsRead: string }).__fsRead = 'THROW';
  });

  it('registers all seven commands', () => {
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'chrome-bridge' }));
    for (const name of ['serve', 'status', 'revive', 'exec', 'cdp', 'task', 'open']) {
      expect(site.command).toHaveBeenCalledWith(name, expect.anything());
    }
  });

  it('serve reports already-running when HTTP status probe succeeds', async () => {
    mockFetchSequence([{ ok: true }]);
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'serve');
    const r = JSON.stringify(await handler({ port: 9346 }, {}));
    expect(r).toContain('running');
    expect(r).toContain('9346');
  });

  it('serve spawns a detached server process when not running', async () => {
    mockFetchSequence([{ ok: false }, { ok: true }]);
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'serve');
    const r = JSON.stringify(await handler({ port: 9346 }, {}));
    expect(spawnSpy).toHaveBeenCalled();
    expect(r).toContain('http');
    expect(r).toContain('9347');
  });

  it('status returns bridge state', async () => {
    mockFetchSequence([{ json: () => Promise.resolve({ running: true, port: 9346, clients: [] }) }]);
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'status');
    const r = JSON.stringify(await handler({}, {}));
    expect(r).toContain('running');
    expect(r).toContain('clients');
  });

  it('exec fails gracefully when bridge is down', async () => {
    mockFetchSequence([{ ok: false }]);
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    const r = JSON.stringify(await handler({ cmd: 'ping' }, {}));
    expect(r).toContain('bridge');
  });

  it('open fails gracefully when bridge is down', async () => {
    mockFetchSequence([{ ok: false }]);
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'open');
    const r = JSON.stringify(await handler({ url: 'https://example.com' }, {}));
    expect(r).toContain('bridge');
  });

  it('task fails gracefully when bridge is down', async () => {
    mockFetchSequence([{ ok: false }]);
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'task');
    const r = JSON.stringify(await handler({ action: 'list' }, {}));
    expect(r).toContain('bridge');
  });

  it('exec normalizes object args (CLI parsePluginParams output) instead of [object Object]', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown): Promise<{ json(): Promise<unknown> }> => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { pong: true } }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'evaluate', args: { expression: '1+1' } }, {});
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string };
    expect(init.method).toBe('POST');
    expect(init.body).not.toContain('[object Object]');
    const body = JSON.parse(init.body) as { cmd: string; args: { expression?: string } };
    expect(body.cmd).toBe('evaluate');
    expect(body.args.expression).toBe('1+1');
  });

  it('cdp passes object params through without double-JSON.parse drop', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown): Promise<{ json(): Promise<unknown> }> => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'cdp');
    await handler({ method: 'Runtime.evaluate', params: { expression: '1+1' } }, {});
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body) as { args: { expression?: string } };
    expect(body.args.expression).toBe('1+1');
  });

  it('exec still accepts string args (legacy direct-HTTP style)', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown): Promise<{ json(): Promise<unknown> }> => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'navigate', args: '{"url":"https://example.com"}' }, {});
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body) as { cmd: string; args: { url?: string } };
    expect(body.cmd).toBe('navigate');
    expect(body.args.url).toBe('https://example.com');
  });

  it('exec injects --task into args for tab-group naming', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown): Promise<{ json(): Promise<unknown> }> => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'navigate', args: '{"url":"https://example.com"}', task: '发草稿' }, {});
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body) as { cmd: string; args: { url?: string; task?: string } };
    expect(body.args.url).toBe('https://example.com');
    expect(body.args.task).toBe('发草稿');
  });

  it('exec injects --tab-id for explicit attach routing', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown): Promise<{ json(): Promise<unknown> }> => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'evaluate', args: { expression: '1+1' }, tabId: 885225922 }, {});
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body) as { args: { expression?: string; tabId?: number } };
    expect(body.args.expression).toBe('1+1');
    expect(body.args.tabId).toBe(885225922);
  });

  it('attach groups the active tab and returns takeover info', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown): Promise<{ json(): Promise<unknown> }> => Promise.resolve({
      json: () => Promise.resolve({ ok: true, data: { tabId: 42, groupId: 7, url: 'https://x.test/form', title: '表单' } }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'attach');
    const r = JSON.stringify(await handler({ task: '帮填表单' }, {}));
    expect(r).toContain('"tabId":42');
    expect(r).toContain('"groupId":7');
    expect(r).toContain('--tab-id 42');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { cmd: string; args: { task?: string } };
    expect(body.cmd).toBe('attach');
    expect(body.args.task).toBe('帮填表单');
  });

  it('finish closes self-built tabs and reports ungrouped user tabs', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown): Promise<{ json(): Promise<unknown> }> => Promise.resolve({
      json: () => Promise.resolve({ ok: true, data: { closed: 2, ungrouped: 1 } }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'finish');
    const r = JSON.stringify(await handler({}, {}));
    expect(r).toContain('"closed":2');
    expect(r).toContain('"ungrouped":1');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { cmd: string };
    expect(body.cmd).toBe('task-close');
  });

  it('registers attach and finish among commands', () => {
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const names = site.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toContain('attach');
    expect(names).toContain('finish');
  });

  describe('revive (S212)', () => {
    it('fails fast when bridge is down', async () => {
      mockFetchSequence([{ ok: false }]);
      const { site, xcli } = makeMock();
      chromeBridge(xcli as never);
      const handler = getCmd(site, 'revive');
      const r = JSON.stringify(await handler({}, {}));
      expect(r).toContain('bridge');
      expect(execFileSpy).not.toHaveBeenCalled();
    });

    it('no-ops as already-connected when clients present', async () => {
      mockFetchSequence([{ json: () => Promise.resolve({ running: true, port: 9346, clients: [{ connectedAt: 1 }] }) }]);
      const { site, xcli } = makeMock();
      chromeBridge(xcli as never);
      const handler = getCmd(site, 'revive');
      const r = JSON.stringify(await handler({}, {}));
      expect(r).toContain('alreadyConnected');
      expect(execFileSpy).not.toHaveBeenCalled();
    });

    it('fails with guidance when extId unknown (no record, no arg)', async () => {
      mockFetchSequence([{ json: () => Promise.resolve({ running: true, port: 9346, clients: [] }) }]);
      (globalThis as unknown as { __fsRead: string }).__fsRead = 'THROW';
      const { site, xcli } = makeMock();
      chromeBridge(xcli as never);
      const handler = getCmd(site, 'revive');
      const r = JSON.stringify(await handler({}, {}));
      expect(r).toContain('扩展 ID');
      expect(execFileSpy).not.toHaveBeenCalled();
    });

    it('opens extension popup page and polls until the SW reconnects', async () => {
      (globalThis as unknown as { __fsRead: string }).__fsRead = JSON.stringify({ extId: 'abc123', v: '1.4.2', at: 1 });
      // 首查无客户端 → 触发开 popup → 轮询第二次发现有连接
      const responses = [
        { json: () => Promise.resolve({ running: true, port: 9346, clients: [] }) },
        { json: () => Promise.resolve({ running: true, port: 9346, clients: [{ connectedAt: 2 }] }) },
      ];
      global.fetch = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
      const { site, xcli } = makeMock();
      chromeBridge(xcli as never);
      const handler = getCmd(site, 'revive');
      const r = JSON.stringify(await handler({ timeout: 10 }, {}));
      expect(r).toContain('"revived":true');
      expect(r).toContain('abc123');
      expect(execFileSpy).toHaveBeenCalled();
      const launcher = execFileSpy.mock.calls[0][0] as string;
      const args = JSON.stringify(execFileSpy.mock.calls[0][1]);
      expect(['osascript', 'cmd', 'xdg-open']).toContain(launcher);
      expect(args).toContain('chrome-extension://abc123/popup.html');
    }, 15_000);
  });
});
