import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HumanWaitRequiredError,
  buildNeedsHumanResult,
  finishHumanWait,
  markTaskNeedsHuman,
  requestHumanWait,
} from '../../src/plugin/human-wait.js';

/**
 * 插件执行路径上的 ctx.waitForHuman 不等待（自 2026-05 起如此），但必须：
 * 不谎报超时、把 chrome-bridge 任务组标成「需要协助」、命令结束后收尾。
 */
const target = { bridge: { taskName: 'pub-csdn', tabId: 42 } };

function captureBridge(): Array<{ url: string; cmd: string; args: Record<string, unknown> }> {
  const calls: Array<{ url: string; cmd: string; args: Record<string, unknown> }> = [];
  vi.stubEnv('XBROWSER_BRIDGE_HTTP', 'http://127.0.0.1:19601');
  vi.stubGlobal('fetch', async (url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { cmd: string; args: Record<string, unknown> };
    calls.push({ url: String(url), cmd: body.cmd, args: body.args });
    return { ok: true, json: async () => ({ ok: true, data: { ok: true } }) };
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('plugin human-wait (ctx.waitForHuman on plugin paths)', () => {
  it('fails closed and marks the bridge task group needs-human', async () => {
    const calls = captureBridge();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const error = await requestHumanWait({ reason: '完成 CSDN 登录' }, target).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HumanWaitRequiredError);
    expect((error as HumanWaitRequiredError).reason).toBe('完成 CSDN 登录');
    expect(calls).toEqual([{
      url: 'http://127.0.0.1:19601/exec',
      cmd: 'task-status',
      args: { name: 'pub-csdn', status: '需要协助：完成 CSDN 登录', state: 'needs-human' },
    }]);
    expect(warn.mock.calls[0]?.join(' ')).toContain('不会等待');
    expect(warn.mock.calls[0]?.join(' ')).toContain('完成 CSDN 登录');
  });

  it('does not touch the bridge for managed (headless) sessions', async () => {
    const calls = captureBridge();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(requestHumanWait({ reason: 'x' }, undefined)).rejects.toBeInstanceOf(HumanWaitRequiredError);
    await expect(finishHumanWait(undefined, true)).resolves.toBeUndefined();
    expect(await markTaskNeedsHuman(undefined, '需要登录')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('finishes with done / failed so the sticky needs-human marker is released', async () => {
    const calls = captureBridge();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(requestHumanWait({ reason: '登录' }, target)).rejects.toBeInstanceOf(HumanWaitRequiredError);
    await finishHumanWait(target, true);
    await finishHumanWait(target, false, 'Selector #x not found');

    expect(calls.map((call) => [call.args.status, call.args.state])).toEqual([
      ['需要协助：登录', 'needs-human'],
      ['已完成（未经人工确认）', 'done'],
      ['失败：Selector #x not found', 'failed'],
    ]);
  });

  it('marks the group when the login guard stops the command', async () => {
    const calls = captureBridge();

    expect(await markTaskNeedsHuman(target, '需要登录后才能执行 csdn.draft')).toBe(true);
    expect(calls[0]?.args).toMatchObject({ status: '需要协助：需要登录后才能执行 csdn.draft', state: 'needs-human' });
  });

  it('a bridge outage never breaks the command', async () => {
    vi.stubEnv('XBROWSER_BRIDGE_HTTP', 'http://127.0.0.1:1');
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(requestHumanWait({ reason: 'x' }, target)).rejects.toBeInstanceOf(HumanWaitRequiredError);
    await expect(finishHumanWait(target, false, 'boom')).resolves.toBeUndefined();
  });

  it('builds a structured NEEDS_HUMAN result', () => {
    const result = buildNeedsHumanResult('完成登录', { taskName: 'pub-csdn' });

    expect(result.success).toBe(false);
    expect(result.data).toEqual({ code: 'NEEDS_HUMAN', reason: '完成登录', taskName: 'pub-csdn' });
    expect(result.message).toContain('完成登录');
    expect(result.tips.map((t) => t.message).join(' ')).toContain('完成登录');
  });

  it('includes the viewer URL for managed sessions', () => {
    const result = buildNeedsHumanResult('完成登录', {
      viewerUrl: 'http://localhost:9224/preview/default',
    });

    expect(result.data.viewerUrl).toBe('http://localhost:9224/preview/default');
    expect(result.tips.map((t) => t.message).join(' ')).toContain('viewer');
  });
});
