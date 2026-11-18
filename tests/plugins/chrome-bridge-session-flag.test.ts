/**
 * chrome-bridge 插件 `--session` 同义词：统一路由面的一部分——
 * `xbrowser chrome-bridge exec --session foo` ≡ `--task foo`（任务组路由）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import chromeBridge from '../../.xcli/plugins/chrome-bridge/index.js';

type Site = { command: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
type Xcli = { createSite: ReturnType<typeof vi.fn> };

function makeMock(): { site: Site; xcli: Xcli } {
  const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  const xcli: Xcli = { createSite: vi.fn(() => site) };
  return { site, xcli };
}

function getHandler(site: Site, name: string): (params: Record<string, unknown>) => Promise<unknown> {
  const call = site.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: Record<string, unknown>) => Promise<unknown> }).handler;
}

const bodies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return { ok: true, json: async () => ({ ok: true, data: { ok: true } }) };
  });
});

describe('chrome-bridge --session synonym', () => {
  it('exec maps --session onto the bridge task routing', async () => {
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    const exec = getHandler(site, 'exec');
    await exec({ cmd: 'evaluate', session: 'foo', args: { expression: 'document.title' } });
    expect(bodies[0]).toMatchObject({ cmd: 'evaluate' });
    expect(bodies[0].args).toMatchObject({ task: 'foo', expression: 'document.title' });
  });

  it('open maps --session onto the task group name', async () => {
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    await getHandler(site, 'open')({ url: 'https://example.com', session: 'bar' });
    expect(bodies[0]).toMatchObject({ cmd: 'navigate' });
    expect(bodies[0].args).toMatchObject({ task: 'bar', url: 'https://example.com' });
  });

  it('cdp maps --session onto the task routing', async () => {
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    await getHandler(site, 'cdp')({ method: 'Runtime.evaluate', params: { expression: '1+1' }, session: 'baz' });
    expect(bodies[0]).toMatchObject({ cmd: 'cdp' });
    expect(bodies[0].args).toMatchObject({ task: 'baz', method: 'Runtime.evaluate' });
  });

  it('explicit --task still wins over --session when both are provided', async () => {
    const { site, xcli } = makeMock();
    chromeBridge(xcli as never);
    await getHandler(site, 'exec')({ cmd: 'ping', task: 'primary', session: 'secondary' });
    expect(bodies[0].args).toMatchObject({ task: 'primary' });
  });
});
