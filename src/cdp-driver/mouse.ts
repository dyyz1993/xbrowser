/**
 * XBMouse — Mouse input via CDP Input.dispatchMouseEvent
 *
 * Provides human-like mouse control: move, click, drag, scroll.
 */

import type { XBMouse } from './types.js';
import type { CDPConnection } from './connection.js';

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

  async click(
    x: number,
    y: number,
    opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number } = {},
  ): Promise<void> {
    const button = opts.button ?? 'left';
    const clickCount = opts.clickCount ?? 1;
    const delay = opts.delay ?? 0;

    await this.move(x, y);
    await this.down({ button });

    if (delay > 0) {
      await sleep(delay);
    }

    await this.up({ button });

    // Additional clicks for clickCount > 1
    for (let i = 1; i < clickCount; i++) {
      if (delay > 0) await sleep(delay);
      await this.down({ button });
      if (delay > 0) await sleep(delay);
      await this.up({ button });
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
