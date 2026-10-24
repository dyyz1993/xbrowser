import { describe, it, expect, vi } from 'vitest';
import { checkWindowReady, openTaskTab } from '../../.xcli/plugins/shared/publishing/bridge.js';
import type { BridgeTransport } from '../../.xcli/plugins/shared/publishing/bridge.js';

/**
 * chrome-bridge 窗口/生命周期守卫（ERR-20261025-001）。
 *
 * 两个都是「点击静默失效」的上游原因：
 * - 无可见窗口时 CDP 坐标派发不生效（outerWidth=0）
 * - registry 里的僵尸 tab 被 reused，JS 能跑但 Input 丢失
 */

function createBridge(handlers: Record<string, (args: unknown) => unknown>): BridgeTransport {
  return {
    call: vi.fn(async (cmd: string, args: unknown) => {
      const h = handlers[cmd];
      if (!h) throw new Error(`unexpected cmd: ${cmd}`);
      return h(args);
    }),
  } as unknown as BridgeTransport;
}

describe('checkWindowReady', () => {
  it('passes when the tab has a real window', async () => {
    const bridge = createBridge({
      evaluate: () => ({ value: JSON.stringify({ ow: 900, oh: 640 }) }),
    });
    expect(await checkWindowReady(bridge, 1)).toEqual({ ok: true });
  });

  it('fails when outerWidth is 0 (headless / window closed)', async () => {
    const bridge = createBridge({
      evaluate: () => ({ value: JSON.stringify({ ow: 0, oh: 0 }) }),
    });
    const r = await checkWindowReady(bridge, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('没有可见窗口');
  });

  it('fails when the size cannot be read', async () => {
    const bridge = createBridge({ evaluate: () => ({}) });
    const r = await checkWindowReady(bridge, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('无法读取');
  });

  it('fails when evaluate throws', async () => {
    const bridge = createBridge({
      evaluate: () => { throw new Error('tab gone'); },
    });
    const r = await checkWindowReady(bridge, 1);
    expect(r.ok).toBe(false);
  });

  it('fails on unparseable payload', async () => {
    const bridge = createBridge({ evaluate: () => ({ value: 'not-json' }) });
    const r = await checkWindowReady(bridge, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('解析失败');
  });
});

describe('openTaskTab', () => {
  it('navigates when reusing a live tab', async () => {
    const calls: string[] = [];
    const bridge = createBridge({
      'task-open': () => ({ tabId: 42, reused: true }),
      evaluate: () => ({ value: '1' }),
      navigate: (args) => { calls.push(JSON.stringify(args)); return {}; },
    });
    expect(await openTaskTab(bridge, 'g', 'https://x')).toBe(42);
    expect(calls.some((c) => c.includes('https://x'))).toBe(true);
  });

  it('rebuilds the group when the reused tab is dead (zombie registry entry)', async () => {
    let openCount = 0;
    const closed: string[] = [];
    let evalCount = 0;
    const bridge = createBridge({
      'task-open': () => {
        openCount++;
        // 第一次给僵尸 id，重建给新 id
        return openCount === 1 ? { tabId: 7, reused: true } : { tabId: 99 };
      },
      evaluate: () => {
        evalCount++;
        // 僵尸 tab 上 evaluate 抛错 = tab 已销毁
        if (evalCount === 1) throw new Error('No tab with given id');
        return {};
      },
      'task-close': (args) => { closed.push(JSON.stringify(args)); return {}; },
    });

    expect(await openTaskTab(bridge, 'g', 'https://x')).toBe(99);
    expect(closed.length).toBe(1);
    expect(openCount).toBe(2);
  });

  it('throws when task-open returns no tabId', async () => {
    const bridge = createBridge({ 'task-open': () => ({}) });
    await expect(openTaskTab(bridge, 'g', 'https://x')).rejects.toThrow(/task-open 失败/);
  });

  it('does not navigate on a fresh tab', async () => {
    const navigate = vi.fn();
    const bridge = createBridge({
      'task-open': () => ({ tabId: 5 }),
      navigate,
    });
    expect(await openTaskTab(bridge, 'g', 'https://x')).toBe(5);
    expect(navigate).not.toHaveBeenCalled();
  });
});
