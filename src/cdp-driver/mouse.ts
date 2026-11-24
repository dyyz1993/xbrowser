/**
 * XBMouse — Mouse input via CDP Input.dispatchMouseEvent
 *
 * Provides human-like mouse control: move, click, drag, scroll.
 */

import type { XBMouse } from './types.js';
import type { CDPConnection } from './connection.js';
import { bezierTrajectory, landingOffset, rand as sRand, DEFAULT_STEALTH_CONFIG as CFG } from './stealth.js';

/** Web 标准按钮位掩码（e.buttons）：left=1, right=2, middle=4 */
function buttonBit(button: 'left' | 'right' | 'middle'): number {
  return button === 'left' ? 1 : button === 'right' ? 2 : 4;
}

export class XBMouseImpl implements XBMouse {
  private conn: CDPConnection;
  private sessionId: string | undefined;
  private _x = 0;
  private _y = 0;
  private _button: 'none' | 'left' | 'right' | 'middle' = 'none';
  private _buttons = 0;

  constructor(conn: CDPConnection, sessionId?: string) {
    this.conn = conn;
    this.sessionId = sessionId;
  }

  /** Current cursor X position */
  get x(): number {
    return this._x;
  }

  /** Current cursor Y position */
  get y(): number {
    return this._y;
  }

  async click(x: number, y: number, opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number; stealth?: boolean; elementWidth?: number; elementHeight?: number } = {}): Promise<void> {
    const button = opts.button ?? 'left';
    const stealth = opts.stealth ?? process.env.XBROWSER_STEALTH !== 'off';
    let tx = x, ty = y;
    if (stealth && opts.elementWidth !== undefined && opts.elementHeight !== undefined) {
      const off = landingOffset(opts.elementWidth, opts.elementHeight);
      tx += off.dx; ty += off.dy;
    }
    if (stealth) {
      const traj = bezierTrajectory(this._x, this._y, tx, ty);
      // 总预算守卫：session 慢（新 tab Input agent 每事件 6-7s，d07 第六层）
      // 时轨迹 10+ 事件累计 70s。超 5s 预算截断，跳到终点保点击可用。
      const _tb = Date.now();
      let _truncated = false;
      for (const p of traj) {
        if (Date.now() - _tb > 5000) { _truncated = true; break; }
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: this._button, buttons: this._buttons });
        this._x = p.x; this._y = p.y;
        await sleep(p.delay);
      }
      this._x = tx; this._y = ty;
      if (_truncated) {
        // 截断后必须补发终点事件 —— 浏览器鼠标位置停在半路，
        // 后续 press/release 虽用正确坐标但 hover 态不对（d07 实测按钮不触发）
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, button: this._button, buttons: this._buttons });
      }
      await sleep(sRand(...CFG.aimPause));
    } else {
      await this.move(tx, ty);
    }
    // 浏览器按「按下/抬起」的 clickCount 序列合成事件：两段 1 → 2 才得到
    // click、click、dblclick。所以多击就是若干段按压，段号依次递增——以前
    // clickCount:2 只发一对（没有 dblclick），外面再叠一次点击凑数。
    const clickCount = Math.max(1, opts.clickCount ?? 1);
    for (let n = 1; n <= clickCount; n++) {
      await this.down({ button, clickCount: n });
      await sleep(stealth ? sRand(...CFG.pressDuration) : (opts.delay ?? 0));
      if (stealth) {
        this._x += sRand(...CFG.releaseDrift) * (Math.random() < .5 ? -1 : 1);
        this._y += sRand(...CFG.releaseDrift) * (Math.random() < .5 ? -1 : 1);
      }
      await this.release(button, n);
      if (n < clickCount) await sleep(opts.delay ?? sRand(...CFG.doubleClickGap));
    }
  }

  async dblclick(x: number, y: number, opts: { button?: 'left' | 'right' | 'middle' } = {}): Promise<void> {
    await this.click(x, y, { clickCount: 2, button: opts.button });
  }

  async down(opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {}): Promise<void> {
    const button = opts.button ?? 'left';
    this._button = button;
    // buttons 位掩码必须在派发前置位：按住期间的 mouseMoved 读的是它
    // （OOPIF 滑块实测：move 不带 buttons:1 会被判未按住）
    this._buttons |= buttonBit(button);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: this._x,
      y: this._y,
      button,
      buttons: this._buttons,
      // r23: press 必须与 release 声明同一 clickCount——Chrome 按序列计数
      // 合成 click/dblclick，press 缺声明会把计数器重置（dblclick 永不合成）
      clickCount: opts.clickCount ?? 1,
    });
  }

  async up(opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {}): Promise<void> {
    await this.release(opts.button ?? 'left', opts.clickCount ?? 1);
  }

  /**
   * Release `button` and forget it. The bit is cleared BEFORE the event goes out:
   * Chrome derives pointerup from the button-state change, so a release that still
   * claims the button is down delivers mouseup and click but no pointerup. Measured
   * 2026-11-24: pointer-driven sliders never finished a `mouse drag`, the recorder
   * logged the drag as a click, and a button left in the mask made every later
   * press of another button lose its pointerdown.
   */
  private async release(button: 'left' | 'right' | 'middle', clickCount: number): Promise<void> {
    this._buttons &= ~buttonBit(button);
    this._button = 'none';
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: this._x,
      y: this._y,
      button,
      buttons: this._buttons,
      clickCount,
    });
  }

  async move(x: number, y: number, opts: { steps?: number; stealth?: boolean } = {}): Promise<void> {
    // stealth 模式下每个 move 点带帧级延迟（d47）：浏览器按帧（60fps≈16.7ms）
    // 向页面派发 pointermove——间隔低于帧长的连发会被帧对齐丢弃（实测 180
    // 步派发仅 ~26 个存活），且"超帧率 move 流"本身是指纹。帧级间隔 16-28ms。
    const stealth = opts.stealth ?? process.env.XBROWSER_STEALTH !== 'off';
    const steps = Math.max(1, opts.steps ?? 1);
    const fromX = this._x;
    const fromY = this._y;
    const dx = x - fromX;
    const dy = y - fromY;

    for (let i = 1; i <= steps; i++) {
      if (stealth) await sleep(sRand(16, 28));
      const t = i / steps;
      this._x = fromX + dx * t;
      this._y = fromY + dy * t;
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: this._x,
        y: this._y,
        button: this._button,
        buttons: this._buttons,
      });
    }

    this._x = x;
    this._y = y;
  }

  /**
   * Drag from the CURRENT cursor position to (x, y): press, traverse a
   * bezier trajectory with the button held, release. Drives the REAL
   * HTML5 DnD pipeline — field-verified (d59): this sequence fires
   * dragstart → dragover… → drop → dragend, all isTrusted=true. No
   * Input.dispatchDragEvent needed.
   */
  async drag(x: number, y: number, opts: { steps?: number } = {}): Promise<void> {
    const stealth = process.env.XBROWSER_STEALTH !== 'off';
    await this.down({ button: 'left' });
    // 按住移动：HTML5 拖拽启动需要移动超过阈值（约 4-8px）且逐帧移动
    const steps = opts.steps ?? Math.max(10, Math.min(24, Math.round(Math.hypot(x - this._x, y - this._y) / 20)));
    const fx = this._x, fy = this._y;
    for (let i = 1; i <= steps; i++) {
      if (stealth) await sleep(sRand(16, 28));
      const t = i / steps;
      this._x = fx + (x - fx) * t;
      this._y = fy + (y - fy) * t;
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: this._x, y: this._y, button: this._button, buttons: this._buttons,
      });
    }
    this._x = x; this._y = y;
    await sleep(sRand(60, 140)); // drop 前的悬停放手节奏
    await this.release('left', 1);
  }

  async wheelAt(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.move(x, y);
    await this.wheel(deltaX, deltaY);
  }

  async wheel(deltaX: number, deltaY: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: this._x,
      y: this._y,
      buttons: this._buttons,
      deltaX,
      deltaY,
    });
  }

  private async send(method: string, params: Record<string, unknown>): Promise<void> {
    await this.conn.send(method, params, this.sessionId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
