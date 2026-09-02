/**
 * XBMouse — Mouse input via CDP Input.dispatchMouseEvent
 *
 * Provides human-like mouse control: move, click, drag, scroll.
 */

import type { XBMouse } from './types.js';
import type { CDPConnection } from './connection.js';
import { bezierTrajectory, landingOffset, rand as sRand, DEFAULT_STEALTH_CONFIG as CFG } from './stealth.js';

export class XBMouseImpl implements XBMouse {
  private conn: CDPConnection;
  private sessionId: string | undefined;
  private _x = 0;
  private _y = 0;
  private _button: 'none' | 'left' | 'right' | 'middle' = 'none';

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
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: this._button });
        this._x = p.x; this._y = p.y;
        await sleep(p.delay);
      }
      this._x = tx; this._y = ty;
      if (_truncated) {
        // 截断后必须补发终点事件 —— 浏览器鼠标位置停在半路，
        // 后续 press/release 虽用正确坐标但 hover 态不对（d07 实测按钮不触发）
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, button: this._button });
      }
      await sleep(sRand(...CFG.aimPause));
    } else {
      await this.move(tx, ty);
    }
    await this.down({ button, clickCount: opts.clickCount ?? 1 });
    await sleep(stealth ? sRand(...CFG.pressDuration) : (opts.delay ?? 0));
    const rx = stealth ? this._x + sRand(...CFG.releaseDrift) * (Math.random() < .5 ? -1 : 1) : this._x;
    const ry = stealth ? this._y + sRand(...CFG.releaseDrift) * (Math.random() < .5 ? -1 : 1) : this._y;
    this._x = rx; this._y = ry;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button, clickCount: opts.clickCount ?? 1 });
    for (let i = 1; i < (opts.clickCount ?? 1); i++) {
      if (opts.delay) await sleep(opts.delay);
      await this.down({ button }); await this.up({ button });
    }
  }

  async dblclick(x: number, y: number, opts: { button?: 'left' | 'right' | 'middle' } = {}): Promise<void> {
    await this.click(x, y, { clickCount: 2, button: opts.button });
  }

  async down(opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {}): Promise<void> {
    const button = opts.button ?? 'left';
    this._button = button;
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: this._x,
      y: this._y,
      button,
      // r23: press 必须与 release 声明同一 clickCount——Chrome 按序列计数
      // 合成 click/dblclick，press 缺声明会把计数器重置（dblclick 永不合成）
      clickCount: opts.clickCount ?? 1,
    });
  }

  async up(opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {}): Promise<void> {
    const button = opts.button ?? 'left';
    this._button = 'none';
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: this._x,
      y: this._y,
      button,
      clickCount: opts.clickCount ?? 1,
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
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: this._x, y: this._y, button: 'left', clickCount: 1,
    });
    this._button = 'left';
    // 按住移动：HTML5 拖拽启动需要移动超过阈值（约 4-8px）且逐帧移动
    const steps = opts.steps ?? Math.max(10, Math.min(24, Math.round(Math.hypot(x - this._x, y - this._y) / 20)));
    const fx = this._x, fy = this._y;
    for (let i = 1; i <= steps; i++) {
      if (stealth) await sleep(sRand(16, 28));
      const t = i / steps;
      this._x = fx + (x - fx) * t;
      this._y = fy + (y - fy) * t;
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: this._x, y: this._y, button: this._button,
      });
    }
    this._x = x; this._y = y;
    await sleep(sRand(60, 140)); // drop 前的悬停放手节奏
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
    this._button = 'none';
  }

  async wheel(deltaX: number, deltaY: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: this._x,
      y: this._y,
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
