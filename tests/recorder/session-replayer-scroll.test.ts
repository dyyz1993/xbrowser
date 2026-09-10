/**
 * Scroll replay semantics (P0-4).
 *
 * Two historical scroll formats reach the replayer:
 *  - CDP command path: value = "direction:distance" — DELTA semantics
 *    (encoded by rpc-handlers on record).
 *  - Page-signal path: scrollX/scrollY = window.scrollX/scrollY at record
 *    time — ABSOLUTE offsets; replay must scrollTo, never scrollBy.
 *
 * The old code had two `case 'scroll'` labels in one switch — the unreachable
 * one treated absolute offsets as deltas and captured Node closure variables
 * inside a serialized browser function. These tests pin the merged behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionReplayer } from '../../src/recorder/session-replayer.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';

function createMockPage() {
  const evaluateFn = vi.fn(async (_expr: unknown) => {});
  const waitForSelectorFn = vi.fn(async () => {});
  const gotoFn = vi.fn(async () => {});

  const page = {
    url: vi.fn(() => 'https://example.com'),
    goto: gotoFn,
    evaluate: evaluateFn,
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    waitForSelector: waitForSelectorFn,
    mouse: { click: vi.fn(async () => {}), move: vi.fn(async () => {}) },
    keyboard: { press: vi.fn(async () => {}) },
    locator: vi.fn(() => ({ focus: vi.fn(async () => {}) })),
  };
  return { page, evaluateFn, waitForSelectorFn, gotoFn };
}

function makeAction(overrides: Partial<UserAction> & Pick<UserAction, 'type'>): UserAction {
  return {
    id: 1,
    timestamp: Date.now(),
    url: 'https://example.com',
    pageTitle: 'Test',
    ...overrides,
  };
}

type Ctx = ReturnType<typeof createMockPage>;

async function replayActions(ctx: Ctx, actions: UserAction[]) {
  const replayer = new SessionReplayer({
    page: ctx.page as never,
    stepDelay: 0,
    stepTimeout: 1000,
  });
  await replayer.load({ actions, network: [], contextChanges: [] });
  return replayer.run();
}

function evaluatedExpressions(ctx: Ctx): string[] {
  return ctx.evaluateFn.mock.calls.map((call) => String(call[0]));
}

describe('SessionReplayer scroll replay', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = createMockPage();
  });

  // ── signal format: absolute window offsets ──

  it('replays scrollX/scrollY with scrollTo (absolute), not scrollBy', async () => {
    const result = await replayActions(ctx, [
      makeAction({ type: 'scroll', scrollX: 800, scrollY: 1200 }),
    ]);
    expect(result.success).toBe(1);
    const exprs = evaluatedExpressions(ctx).join('\n');
    expect(exprs).toContain('scrollTo(800, 1200)');
    expect(exprs).not.toContain('scrollBy');
  });

  it('replays signal scroll with only scrollY set', async () => {
    const result = await replayActions(ctx, [
      makeAction({ type: 'scroll', scrollY: 500 }),
    ]);
    expect(result.success).toBe(1);
    expect(evaluatedExpressions(ctx).join('\n')).toContain('scrollTo(0, 500)');
  });

  it('does not fall back to down:300 for signal scrolls', async () => {
    await replayActions(ctx, [makeAction({ type: 'scroll', scrollX: 0, scrollY: 0 })]);
    expect(evaluatedExpressions(ctx).join('\n')).not.toContain('300');
  });

  // ── value format: direction:distance deltas ──

  it('replays value "down:300" as vertical scrollBy', async () => {
    await replayActions(ctx, [makeAction({ type: 'scroll', value: 'down:300' })]);
    expect(evaluatedExpressions(ctx).join('\n')).toContain('scrollBy(0, 300)');
  });

  it('replays value "up:200" as negative vertical scrollBy', async () => {
    await replayActions(ctx, [makeAction({ type: 'scroll', value: 'up:200' })]);
    expect(evaluatedExpressions(ctx).join('\n')).toContain('scrollBy(0, -200)');
  });

  it('replays value "left:150" as horizontal scrollBy (old code: sign 0 = no-op)', async () => {
    await replayActions(ctx, [makeAction({ type: 'scroll', value: 'left:150' })]);
    expect(evaluatedExpressions(ctx).join('\n')).toContain('scrollBy(-150, 0)');
  });

  it('replays value "right:150" as horizontal scrollBy (old code: +300 vertical!)', async () => {
    await replayActions(ctx, [makeAction({ type: 'scroll', value: 'right:150' })]);
    expect(evaluatedExpressions(ctx).join('\n')).toContain('scrollBy(150, 0)');
  });

  it('scrolls an element when the action carries a selector', async () => {
    await replayActions(ctx, [
      makeAction({
        type: 'scroll',
        value: 'down:120',
        element: { tag: 'div', selector: '#feed', text: '' },
      }),
    ]);
    const exprs = evaluatedExpressions(ctx).join('\n');
    expect(exprs).toContain('scrollTop');
    expect(exprs).not.toContain('window.scrollBy');
  });

  it('scrolls an element horizontally with left direction', async () => {
    await replayActions(ctx, [
      makeAction({
        type: 'scroll',
        value: 'left:90',
        element: { tag: 'div', selector: '#feed', text: '' },
      }),
    ]);
    const exprs = evaluatedExpressions(ctx).join('\n');
    expect(exprs).toContain('scrollLeft');
    expect(exprs).toContain('-90');
  });

  // ── precedence and fallback ──

  it('prefers value format when both value and scrollX/scrollY exist', async () => {
    await replayActions(ctx, [
      makeAction({ type: 'scroll', value: 'down:60', scrollX: 999, scrollY: 999 }),
    ]);
    const exprs = evaluatedExpressions(ctx).join('\n');
    expect(exprs).toContain('scrollBy(0, 60)');
    expect(exprs).not.toContain('scrollTo');
  });

  it('falls back to down 300 when neither format is present', async () => {
    await replayActions(ctx, [makeAction({ type: 'scroll' })]);
    expect(evaluatedExpressions(ctx).join('\n')).toContain('scrollBy(0, 300)');
  });

  // ── browser-context safety ──

  it('passes string expressions to evaluate — no Node closure capture', async () => {
    await replayActions(ctx, [
      makeAction({ type: 'scroll', scrollX: 10, scrollY: 20 }),
      makeAction({ type: 'scroll', value: 'down:50' }),
    ]);
    for (const call of ctx.evaluateFn.mock.calls) {
      expect(typeof call[0]).toBe('string');
    }
  });

  it('keeps replaying subsequent actions when scroll evaluate fails', async () => {
    ctx.evaluateFn.mockRejectedValueOnce(new Error('detached'));
    // Timestamps >2.5s apart: dedupAdjacentActions treats same-type adjacent
    // actions inside the window as cdp echo twins (scroll has no x/y).
    const result = await replayActions(ctx, [
      makeAction({ type: 'scroll', scrollX: 5, scrollY: 6, timestamp: 1000 }),
      makeAction({ type: 'scroll', value: 'down:10', timestamp: 1000 + 3000 }),
    ]);
    // First scroll failed softly; second still ran (scroll failures must not
    // abort the whole replay — matching the old `.catch(() => {})` behavior).
    expect(result.success).toBeGreaterThanOrEqual(1);
    expect(evaluatedExpressions(ctx).join('\n')).toContain('scrollBy(0, 10)');
  });
});
