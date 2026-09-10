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

describe('chrome-bridge plugin', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { __spawnSpy: ReturnType<typeof vi.fn> }).__spawnSpy = spawnSpy;
  });

  it('registers all six commands', () => {
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'chrome-bridge' }));
    for (const name of ['serve', 'status', 'exec', 'cdp', 'task', 'open']) {
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
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: { pong: true } }) }));
    global.fetch = fetchMock;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'evaluate', args: { expression: '1+1' } }, {});
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('[object Object]');
    expect(calledUrl).toContain(encodeURIComponent('{"expression":"1+1"}'));
  });

  it('cdp passes object params through without double-JSON.parse drop', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'cdp');
    await handler({ method: 'Runtime.evaluate', params: { expression: '1+1' } }, {});
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body) as { args: { expression?: string } };
    expect(body.args.expression).toBe('1+1');
  });

  it('exec still accepts string args (legacy direct-HTTP style)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'navigate', args: '{"url":"https://example.com"}' }, {});
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent('{"url":"https://example.com"}'));
  });

  it('exec injects --task into args for tab-group naming', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'navigate', args: '{"url":"https://example.com"}', task: '发草稿' }, {});
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    const decoded = decodeURIComponent((calledUrl.match(/args=([^&]+)/) ?? [''])[1]);
    const parsed = JSON.parse(decoded) as { url?: string; task?: string };
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.task).toBe('发草稿');
  });

  it('exec injects --tab-id for explicit attach routing', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) }));
    global.fetch = fetchMock;
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const handler = getCmd(site, 'exec');
    await handler({ cmd: 'evaluate', args: { expression: '1+1' }, tabId: 885225922 }, {});
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    const decoded = decodeURIComponent((calledUrl.match(/args=([^&]+)/) ?? [''])[1]);
    const parsed = JSON.parse(decoded) as { expression?: string; tabId?: number };
    expect(parsed.expression).toBe('1+1');
    expect(parsed.tabId).toBe(885225922);
  });

  it('attach groups the active tab and returns takeover info', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ ok: true, data: { tabId: 42, groupId: 7, url: 'https://x.test/form', title: '表单' } }),
    }));
    global.fetch = fetchMock;
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
    const fetchMock = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ ok: true, data: { closed: 2, ungrouped: 1 } }),
    }));
    global.fetch = fetchMock;
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
});
