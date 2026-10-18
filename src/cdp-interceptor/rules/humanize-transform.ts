/**
 * Rule: Humanize Transform
 *
 * Repairs suspicious-but-not-malicious CDP input into the browser's trusted,
 * human-shaped event stream before it reaches Chromium.
 *
 * 1. Instant mouse jumps: a single `mouseMoved` that teleports from the last
 *    cursor position is expanded into a bezier trajectory with per-point
 *    delays, matching StealthDriver's natural path generator.
 * 2. Instant text paste: `Input.insertText` is converted into a complete
 *    keyboard command stream (rawKeyDown → char → keyUp) with the same
 *    three-tier typing rhythm used by page.type().
 *
 * Deliberate clicks (press/release) and navigation are passed through.
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';

const CURSOR_KEY = 'humanize-cursor';
const KEYS_KEY = 'humanize-keys';

interface CursorState {
  x: number;
  y: number;
}

interface KeyTiming {
  /** Last inter-key delay, used to seed the next rhythm bucket. */
  lastDelay: number;
}

/** Frame-rate friendly mouse step delays (60fps alignment). */
const MOUSE_STEP_DELAYS = [16, 19, 23, 28];
/** Three-tier human typing rhythm: fast burst / normal / think pause. */
const TYPE_DELAYS = [42, 58, 74, 96, 118, 155, 210];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Cubic bezier path with easing, lateral noise, and overshoot correction. */
export function humanMousePath(
  fromX: number, fromY: number, toX: number, toY: number,
): Array<{ x: number; y: number; delay: number }> {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const n = Math.max(8, Math.min(28, Math.round(dist / 15)));
  const shortMove = dist < 120;
  const curvature = shortMove ? rand(2, 6) : Math.max(dist * rand(0.12, 0.22), rand(18, 35));
  const dir = Math.random() < 0.5 ? 1 : -1;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const d = dist || 1;
  const c1x = fromX + dx * 0.3 - (dy / d) * curvature * 0.5 * dir;
  const c1y = fromY + dy * 0.3 + (dx / d) * curvature * 0.5 * dir;
  const c2x = fromX + dx * 0.7 - (dy / d) * curvature * 0.8 * dir;
  const c2y = fromY + dy * 0.7 + (dx / d) * curvature * 0.8 * dir;
  const amp = shortMove ? Math.min(2, 3.2) : 3.2;
  const points: Array<{ x: number; y: number; delay: number }> = [];

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const mt = 1 - eased;
    const px = mt ** 3 * fromX + 3 * mt ** 2 * eased * c1x + 3 * mt * eased ** 2 * c2x + eased ** 3 * toX;
    const py = mt ** 3 * fromY + 3 * mt ** 2 * eased * c1y + 3 * mt * eased ** 2 * c2y + eased ** 3 * toY;
    points.push({
      x: roundCoordinate(px + rand(-amp, amp)),
      y: roundCoordinate(py + rand(-amp, amp)),
      delay: MOUSE_STEP_DELAYS[Math.floor(Math.random() * MOUSE_STEP_DELAYS.length)],
    });
  }

  if (!shortMove) {
    const over = rand(6, 14);
    points.push({
      x: roundCoordinate(toX + (dx / d) * over + rand(-2, 2)),
      y: roundCoordinate(toY + (dy / d) * over + rand(-2, 2)),
      delay: Math.round(rand(14, 30)),
    });
    points.push({
      x: roundCoordinate(toX + (dx / d) * over * 0.4),
      y: roundCoordinate(toY + (dy / d) * over * 0.4),
      delay: Math.round(rand(14, 30)),
    });
  }

  points.push({
    x: roundCoordinate(toX + rand(-1, 1)),
    y: roundCoordinate(toY + rand(-1, 1)),
    delay: Math.round(rand(14, 30)),
  });
  return points;
}

/** Map a printable character to a CDP keyboard event triple. */
export function characterKeyEvents(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const char of text) {
    if (char === '\n') {
      events.push(
        { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
        { type: 'char', text: '\r' },
        { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      );
      continue;
    }
    events.push(
      { type: 'rawKeyDown', key: char, text: char, unmodifiedText: char },
      { type: 'char', text: char },
      { type: 'keyUp', key: char },
    );
  }
  return events;
}

function isMouseEvent(method: string): boolean {
  return method === 'Input.dispatchMouseEvent';
}

export const humanizeTransformRule: CDPInterceptorRule = {
  id: 'humanize-transform',
  name: 'Humanize Trusted Input Transform',
  priority: 45,

  canHandle(ctx: RuleContext): boolean {
    return isMouseEvent(ctx.method) || ctx.method === 'Input.insertText';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    if (ctx.method === 'Input.insertText') return this.transformInsertText(ctx);
    return this.transformMouseEvent(ctx);
  },

  transformMouseEvent(ctx: RuleContext): DecisionResult | null {
    const params = ctx.params as {
      type?: string; x?: number; y?: number; button?: string; clickCount?: number;
    };
    if (params.type !== 'mouseMoved' || typeof params.x !== 'number' || typeof params.y !== 'number') {
      // Keep deliberate press/release and wheel events untouched.
      const x = params.x;
      const y = params.y;
      if (typeof x === 'number' && typeof y === 'number') {
        ctx.sessionState.set(CURSOR_KEY, { x, y } satisfies CursorState);
      }
      return null;
    }

    const cursor = (ctx.sessionState.get(CURSOR_KEY) as CursorState | undefined) ?? { x: 0, y: 0 };
    const jump = Math.hypot(params.x - cursor.x, params.y - cursor.y);
    ctx.sessionState.set(CURSOR_KEY, { x: params.x, y: params.y } satisfies CursorState);
    if (jump < 32) return null;

    const path = humanMousePath(cursor.x, cursor.y, params.x, params.y);
    return {
      ruleId: this.id,
      action: 'transform',
      severity: 'info',
      reason: `Expanded instant mouse jump of ${jump.toFixed(0)}px into ${path.length} trusted bezier moves.`,
      suggestion: 'Use page.mouse.move with steps for explicit control; this transform preserves isTrusted=true.',
      transformedParams: { __sequence: path.map((point) => ({
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseMoved', x: point.x, y: point.y, button: params.button ?? 'none' },
        delayMs: point.delay,
      })) },
    };
  },

  transformInsertText(ctx: RuleContext): DecisionResult | null {
    const params = ctx.params as { text?: string };
    const text = params.text ?? '';
    if (!text) return null;
    const timing = (ctx.sessionState.get(KEYS_KEY) as KeyTiming | undefined) ?? { lastDelay: TYPE_DELAYS[1] };

    // Choose one rhythm bucket per paste and vary within it, keeping CV high.
    const bucket = TYPE_DELAYS[Math.floor(Math.random() * TYPE_DELAYS.length)];
    const events = characterKeyEvents(text).map((event, index) => ({
      method: 'Input.dispatchKeyEvent',
      params: event,
      delayMs: index === 0 ? 0 : Math.max(24, Math.round(bucket + rand(-bucket * 0.45, bucket * 0.55))),
    }));
    timing.lastDelay = bucket;
    ctx.sessionState.set(KEYS_KEY, timing);

    return {
      ruleId: this.id,
      action: 'transform',
      severity: 'info',
      reason: `Expanded Input.insertText (${text.length} chars) into ${events.length} trusted key events with variable rhythm.`,
      suggestion: 'Use page.type for explicit control; this transform preserves the native keyboard command stream.',
      transformedParams: { __sequence: events },
    };
  },
} as CDPInterceptorRule & {
  transformMouseEvent(ctx: RuleContext): DecisionResult | null;
  transformInsertText(ctx: RuleContext): DecisionResult | null;
};
