import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XBMouseImpl } from '../../src/cdp-driver/mouse.js';
import type { CDPConnection } from '../../src/cdp-driver/connection.js';

/**
 * XBMouseImpl 派发的 Input.dispatchMouseEvent 序列（2026-11-24 真实浏览器事件日志对照）。
 *
 * Chrome 由「按键状态的变化」生成 pointer 事件：松开事件若仍声明按键按着，页面会收到
 * mouseup / click 却收不到 pointerup；按键位不清，后续别的按键按下时 pointerdown 丢失。
 * 以前 click() 从不清位、三处松开都带着按键位、双击实际按了四下。
 *
 * 关掉 stealth 让序列确定且无延时；只断言按下/抬起事件（move 的数量由轨迹决定）。
 */

type MouseEvent = { type: string; button?: string; buttons?: number; clickCount?: number };

function harness(): { mouse: XBMouseImpl; events: MouseEvent[]; sends: Array<[string, Record<string, unknown>]> } {
  const sends: Array<[string, Record<string, unknown>]> = [];
  const conn = {
    send: vi.fn(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
      sends.push([method, params]);
      return {};
    }),
  } as unknown as CDPConnection;
  return { mouse: new XBMouseImpl(conn), events: [], sends };
}

/** 只留下按下 / 抬起事件，带上按键位与 clickCount */
function presses(sends: Array<[string, Record<string, unknown>]>): string[] {
  return sends
    .filter(([method]) => method === 'Input.dispatchMouseEvent')
    .map(([, p]) => p as MouseEvent)
    .filter((p) => p.type === 'mousePressed' || p.type === 'mouseReleased')
    .map((p) => `${p.type}:${p.button}:buttons=${p.buttons}:clickCount=${p.clickCount}`);
}

const moves = (sends: Array<[string, Record<string, unknown>]>): number[] =>
  sends.filter(([m, p]) => m === 'Input.dispatchMouseEvent' && p.type === 'mouseMoved').map(([, p]) => (p as MouseEvent).buttons ?? -1);

describe('XBMouseImpl button state', () => {
  beforeEach(() => { vi.stubEnv('XBROWSER_STEALTH', 'off'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('a click is one press and one release, and the release no longer claims the button', async () => {
    const { mouse, sends } = harness();
    await mouse.click(100, 100);
    expect(presses(sends)).toEqual([
      'mousePressed:left:buttons=1:clickCount=1',
      'mouseReleased:left:buttons=0:clickCount=1',
    ]);
  });

  it('forgets the button after a click, so later moves report none held', async () => {
    const { mouse, sends } = harness();
    await mouse.click(100, 100);
    await mouse.move(200, 200);
    expect(moves(sends).at(-1)).toBe(0);
  });

  it('keeps the masks of two different buttons apart', async () => {
    const { mouse, sends } = harness();
    await mouse.click(100, 100, { button: 'right' });
    await mouse.click(100, 100, { button: 'left' });
    expect(presses(sends)).toEqual([
      'mousePressed:right:buttons=2:clickCount=1',
      'mouseReleased:right:buttons=0:clickCount=1',
      'mousePressed:left:buttons=1:clickCount=1',
      'mouseReleased:left:buttons=0:clickCount=1',
    ]);
  });

  it('a double click is exactly two presses, counted 1 then 2', async () => {
    const { mouse, sends } = harness();
    await mouse.dblclick(100, 100);
    expect(presses(sends)).toEqual([
      'mousePressed:left:buttons=1:clickCount=1',
      'mouseReleased:left:buttons=0:clickCount=1',
      'mousePressed:left:buttons=1:clickCount=2',
      'mouseReleased:left:buttons=0:clickCount=2',
    ]);
  });

  it('a drag holds the button through its moves and lets go at the end', async () => {
    const { mouse, sends } = harness();
    await mouse.move(10, 10);
    await mouse.drag(110, 10, { steps: 3 });
    expect(presses(sends)).toEqual([
      'mousePressed:left:buttons=1:clickCount=1',
      'mouseReleased:left:buttons=0:clickCount=1',
    ]);
    const held = moves(sends).slice(-3);
    expect(held).toEqual([1, 1, 1]);
    await mouse.move(200, 200);
    expect(moves(sends).at(-1)).toBe(0);
  });

  it('up() releases without the button and clears the state', async () => {
    const { mouse, sends } = harness();
    await mouse.down({ button: 'left' });
    await mouse.move(50, 50);
    await mouse.up({ button: 'left' });
    expect(presses(sends)).toEqual([
      'mousePressed:left:buttons=1:clickCount=1',
      'mouseReleased:left:buttons=0:clickCount=1',
    ]);
    expect(moves(sends)).toEqual([1]);
  });
});
