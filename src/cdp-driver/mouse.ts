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
      for (const p of traj) {
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: this._button });
        this._x = p.x; this._y = p.y;
        await sleep(p.delay);
      }
      await sleep(sRand(...CFG.aimPause));
    } else {
      await this.move(tx, ty);
    }
    await this.down({ button });
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

  async down(opts: { button?: 'left' | 'right' | 'middle' } = {}): Promise<void> {
    const button = opts.button ?? 'left';
    this._button = button;
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: this._x,
      y: this._y,
      button,
      clickCount: 1,
    });
  }

  async up(opts: { button?: 'left' | 'right' | 'middle' } = {}): Promise<void> {
    const button = opts.button ?? 'left';
    this._button = 'none';
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: this._x,
      y: this._y,
      button,
      clickCount: 1,
    });
  }

  async move(x: number, y: number, opts: { steps?: number } = {}): Promise<void> {
    const steps = Math.max(1, opts.steps ?? 1);
    const fromX = this._x;
    const fromY = this._y;
    const dx = x - fromX;
    const dy = y - fromY;

    for (let i = 1; i <= steps; i++) {
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
