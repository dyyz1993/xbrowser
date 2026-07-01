/**
 * Tests for extended recording capabilities:
 * dblclick, contextmenu, hover, drag, resize, clipboard, touch, focus, visibility,
 * and extended keydown (Backspace, Delete, modifier combos).
 *
 * Also tests SessionReplayer playback for all new action types.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionReplayer } from '../../src/recorder/session-replayer.js';
import type { UserAction } from '../../src/recorder/session-recorder.js';

// ── Mock helpers ──────────────────────────────────────────────

function createMockPage() {
  const clickFn = vi.fn(async () => {});
  const dblclickFn = vi.fn(async () => {});
  const hoverFn = vi.fn(async () => {});
  const fillFn = vi.fn(async () => {});
  const selectOptionFn = vi.fn(async () => []);
  const waitForSelectorFn = vi.fn(async () => {});
  const setInputFilesFn = vi.fn(async () => {});
  const evaluateFn = vi.fn(async () => {});
  const gotoFn = vi.fn(async () => {});

  const keyboard = {
    press: vi.fn(async () => {}),
    down: vi.fn(async () => {}),
    up: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    insertText: vi.fn(async () => {}),
  };

  const mouse = {
    click: vi.fn(async () => {}),
    dblclick: vi.fn(async () => {}),
    down: vi.fn(async () => {}),
    up: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    wheel: vi.fn(async () => {}),
  };

  const locatorFn = vi.fn(() => ({
    focus: vi.fn(async () => {}),
    waitFor: vi.fn(async () => {}),
  }));

  return {
    url: vi.fn(() => 'https://example.com'),
    goto: gotoFn,
    evaluate: evaluateFn,
    click: clickFn,
    dblclick: dblclickFn,
    hover: hoverFn,
    fill: fillFn,
    selectOption: selectOptionFn,
    waitForSelector: waitForSelectorFn,
    setInputFiles: setInputFilesFn,
    locator: locatorFn,
    keyboard,
    mouse,
    _mocks: {
      clickFn, dblclickFn, hoverFn, fillFn, selectOptionFn,
      waitForSelectorFn, setInputFilesFn, evaluateFn, gotoFn,
      locatorFn,
      keyboard, mouse,
    },
  };
}

type MockPage = ReturnType<typeof createMockPage>;

function makeAction(overrides: Partial<UserAction> & Pick<UserAction, 'type'>): UserAction {
  return {
    id: 1,
    timestamp: Date.now(),
    url: 'https://example.com',
    pageTitle: 'Test',
    ...overrides,
  };
}

// ── Replayer tests ────────────────────────────────────────────

describe('SessionReplayer — new action types', () => {
  let mockPage: MockPage;
  let replayer: SessionReplayer;

  beforeEach(() => {
    mockPage = createMockPage();
    replayer = new SessionReplayer({ page: mockPage as any, stepDelay: 0, stepTimeout: 1000 });
  });

  async function replayActions(actions: UserAction[]) {
    await replayer.load({ actions, network: [], contextChanges: [] });
    return replayer.run();
  }

  // ── dblclick ──

  it('should replay dblclick via selector', async () => {
    const result = await replayActions([
      makeAction({
        type: 'dblclick',
        element: { tag: 'div', selector: '#item', text: 'Item' },
        x: 100,
        y: 200,
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.dblclickFn).toHaveBeenCalledWith('#item', { timeout: 1000 });
  });

  it('should replay dblclick via tag fallback when no selector', async () => {
    const result = await replayActions([
      makeAction({
        type: 'dblclick',
        element: { tag: 'div', text: 'Item' },
        x: 150,
        y: 250,
      }),
    ]);
    expect(result.success).toBe(1);
    // resolveSelector falls back to tag name
    expect(mockPage._mocks.dblclickFn).toHaveBeenCalledWith('div', { timeout: 1000 });
  });

  // ── contextmenu ──

  it('should replay contextmenu via selector', async () => {
    const result = await replayActions([
      makeAction({
        type: 'contextmenu',
        element: { tag: 'div', selector: '#menu-area', text: 'Menu' },
        x: 50,
        y: 80,
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.clickFn).toHaveBeenCalledWith('#menu-area', { button: 'right', timeout: 1000 });
  });

  it('should replay contextmenu via tag fallback when no selector', async () => {
    const result = await replayActions([
      makeAction({
        type: 'contextmenu',
        element: { tag: 'div', text: 'Area' },
        x: 300,
        y: 400,
      }),
    ]);
    expect(result.success).toBe(1);
    // resolveSelector falls back to tag name 'div'
    expect(mockPage._mocks.clickFn).toHaveBeenCalledWith('div', { button: 'right', timeout: 1000 });
  });

  // ── hover ──

  it('should replay hover via selector', async () => {
    const result = await replayActions([
      makeAction({
        type: 'hover',
        element: { tag: 'a', selector: 'nav a.home', text: 'Home' },
        x: 10,
        y: 20,
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.hoverFn).toHaveBeenCalledWith('nav a.home');
  });

  it('should hover via tag fallback when no selector', async () => {
    const result = await replayActions([
      makeAction({
        type: 'hover',
        element: { tag: 'span', text: 'Label' },
        x: 10,
        y: 20,
      }),
    ]);
    expect(result.success).toBe(1);
    // resolveSelector falls back to tag 'span'
    expect(mockPage._mocks.hoverFn).toHaveBeenCalledWith('span');
  });

  // ── drag ──

  it('should replay drag with mouse movements', async () => {
    const result = await replayActions([
      makeAction({
        type: 'drag',
        x: 200,
        y: 300,
        drag: {
          fromX: 100,
          fromY: 100,
          toX: 200,
          toY: 300,
          source: { tag: 'div', selector: '#draggable', text: 'Drag Me' },
          target: { tag: 'div', selector: '#dropzone', text: 'Drop Here' },
        },
      }),
    ]);
    expect(result.success).toBe(1);
    // Should move to start, down, move in steps, up
    expect(mockPage._mocks.mouse.move).toHaveBeenCalledTimes(6); // 1 initial + 5 steps
    expect(mockPage._mocks.mouse.down).toHaveBeenCalled();
    expect(mockPage._mocks.mouse.up).toHaveBeenCalled();
  });

  it('should skip drag when no drag data', async () => {
    const result = await replayActions([
      makeAction({ type: 'drag', x: 100, y: 100 }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.mouse.down).not.toHaveBeenCalled();
  });

  // ── resize ──

  it('should handle resize (informational, no replay)', async () => {
    const result = await replayActions([
      makeAction({
        type: 'resize',
        resize: { width: 1280, height: 720 },
      }),
    ]);
    expect(result.success).toBe(1);
    // No page methods should be called for resize
    expect(mockPage._mocks.clickFn).not.toHaveBeenCalled();
  });

  // ── clipboard ──

  it('should handle clipboard copy (informational)', async () => {
    const result = await replayActions([
      makeAction({
        type: 'clipboard',
        clipboard: { operation: 'copy' },
      }),
    ]);
    expect(result.success).toBe(1);
  });

  it('should handle clipboard paste with preview', async () => {
    const result = await replayActions([
      makeAction({
        type: 'clipboard',
        clipboard: { operation: 'paste', textPreview: 'hello world' },
      }),
    ]);
    expect(result.success).toBe(1);
  });

  it('should handle clipboard cut (informational)', async () => {
    const result = await replayActions([
      makeAction({
        type: 'clipboard',
        clipboard: { operation: 'cut' },
      }),
    ]);
    expect(result.success).toBe(1);
  });

  // ── touch ──

  it('should replay touch start', async () => {
    const result = await replayActions([
      makeAction({
        type: 'touch',
        element: { tag: 'button', selector: '#btn', text: 'Tap' },
        touch: { touchType: 'start', touches: [{ x: 100, y: 200 }] },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.mouse.move).toHaveBeenCalledWith(100, 200);
    expect(mockPage._mocks.mouse.down).toHaveBeenCalled();
  });

  it('should replay touch end', async () => {
    const result = await replayActions([
      makeAction({
        type: 'touch',
        element: { tag: 'button', selector: '#btn', text: 'Tap' },
        touch: { touchType: 'end', touches: [{ x: 100, y: 200 }] },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.mouse.up).toHaveBeenCalled();
  });

  // ── focus ──

  it('should replay focus via locator.focus() on selector', async () => {
    const result = await replayActions([
      makeAction({
        type: 'focus',
        element: { tag: 'input', selector: '#search', text: '' },
        focus: { focusType: 'focus' },
      }),
    ]);
    expect(result.success).toBe(1);
    // X4: focus uses locator().focus() instead of page.click() to avoid unintended clicks
    expect(mockPage._mocks.locatorFn).toHaveBeenCalledWith('#search');
    expect(mockPage._mocks.clickFn).not.toHaveBeenCalled();
  });

  it('should skip blur events', async () => {
    const result = await replayActions([
      makeAction({
        type: 'focus',
        element: { tag: 'input', selector: '#search', text: '' },
        focus: { focusType: 'blur' },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.clickFn).not.toHaveBeenCalled();
    expect(mockPage._mocks.locatorFn).not.toHaveBeenCalled();
  });

  // ── visibility ──

  it('should handle visibility hidden (informational)', async () => {
    const result = await replayActions([
      makeAction({
        type: 'visibility',
        visibility: { state: 'hidden' },
      }),
    ]);
    expect(result.success).toBe(1);
  });

  it('should handle visibility visible (informational)', async () => {
    const result = await replayActions([
      makeAction({
        type: 'visibility',
        visibility: { state: 'visible' },
      }),
    ]);
    expect(result.success).toBe(1);
  });

  // ── extended keydown ──

  it('should replay Backspace key', async () => {
    const result = await replayActions([
      makeAction({
        type: 'keydown',
        key: 'Backspace',
        element: { tag: 'input', selector: '#text', text: '' },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.keyboard.press).toHaveBeenCalledWith('Backspace');
  });

  it('should replay Delete key', async () => {
    const result = await replayActions([
      makeAction({
        type: 'keydown',
        key: 'Delete',
        element: { tag: 'input', selector: '#text', text: '' },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.keyboard.press).toHaveBeenCalledWith('Delete');
  });

  it('should replay modifier combo Ctrl+C', async () => {
    const result = await replayActions([
      makeAction({
        type: 'keydown',
        key: 'Ctrl+c',
        element: { tag: 'input', selector: '#text', text: '' },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.keyboard.press).toHaveBeenCalledWith('Control+c');
  });

  it('should replay modifier combo Meta+Shift+Z', async () => {
    const result = await replayActions([
      makeAction({
        type: 'keydown',
        key: 'Meta+Shift+z',
        element: { tag: 'input', selector: '#text', text: '' },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.keyboard.press).toHaveBeenCalledWith('Meta+Shift+z');
  });

  it('should replay Arrow keys', async () => {
    const result = await replayActions([
      makeAction({
        type: 'keydown',
        key: 'ArrowDown',
        element: { tag: 'input', selector: '#text', text: '' },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.keyboard.press).toHaveBeenCalledWith('ArrowDown');
  });

  // ── existing action types still work ──

  it('should still replay click actions', async () => {
    const result = await replayActions([
      makeAction({
        type: 'click',
        element: { tag: 'button', selector: '#btn', text: 'Click Me' },
        x: 50,
        y: 60,
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.clickFn).toHaveBeenCalledWith('#btn', { timeout: 1000 });
  });

  it('should still replay input actions', async () => {
    const result = await replayActions([
      makeAction({
        type: 'input',
        element: { tag: 'input', selector: '#name', text: '' },
        value: 'hello',
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.fillFn).toHaveBeenCalledWith('#name', 'hello', { timeout: 1000 });
  });

  // ── multi-action sequence ──

  it('should replay a mixed sequence of old and new action types', async () => {
    const result = await replayActions([
      makeAction({ type: 'goto', url: 'https://example.com' }),
      makeAction({ type: 'hover', element: { tag: 'a', selector: 'nav a', text: 'Menu' }, x: 10, y: 10 }),
      makeAction({ type: 'click', element: { tag: 'a', selector: 'nav a.item', text: 'Item' }, x: 10, y: 20 }),
      makeAction({ type: 'dblclick', element: { tag: 'td', selector: 'td.value', text: '42' }, x: 100, y: 100 }),
      makeAction({ type: 'keydown', key: 'Ctrl+c', element: { tag: 'td', text: '42' } }),
      makeAction({ type: 'contextmenu', element: { tag: 'div', selector: '#area', text: 'Area' }, x: 200, y: 300 }),
      makeAction({ type: 'clipboard', clipboard: { operation: 'copy' } }),
      makeAction({ type: 'visibility', visibility: { state: 'hidden' } }),
    ]);
    expect(result.success).toBe(8);
    expect(result.failed).toBe(0);
  });

  // ── trajectory replay ──

  it('should replay mouse trajectory before click', async () => {
    const result = await replayActions([
      makeAction({
        type: 'click',
        element: { tag: 'button', selector: '#btn', text: 'Go' },
        x: 200,
        y: 300,
        trajectory: {
          points: [
            { x: 50, y: 50, dt: 0 },
            { x: 120, y: 170, dt: 100 },
            { x: 200, y: 300, dt: 150 },
          ],
          distance: 310,
          duration: 250,
        },
      }),
    ]);
    expect(result.success).toBe(1);
    // Trajectory moves should happen before the click
    expect(mockPage._mocks.mouse.move).toHaveBeenCalledTimes(3);
    expect(mockPage._mocks.mouse.move).toHaveBeenCalledWith(50, 50);
    expect(mockPage._mocks.mouse.move).toHaveBeenCalledWith(120, 170);
    expect(mockPage._mocks.mouse.move).toHaveBeenCalledWith(200, 300);
    // Click still happens
    expect(mockPage._mocks.clickFn).toHaveBeenCalledWith('#btn', { timeout: 1000 });
  });

  it('should skip trajectory with less than 2 points', async () => {
    const result = await replayActions([
      makeAction({
        type: 'click',
        element: { tag: 'button', selector: '#btn', text: 'Go' },
        x: 100,
        y: 200,
        trajectory: {
          points: [{ x: 100, y: 200, dt: 0 }],
          distance: 0,
          duration: 0,
        },
      }),
    ]);
    expect(result.success).toBe(1);
    expect(mockPage._mocks.mouse.move).not.toHaveBeenCalled();
  });

  it('should replay trajectory between two clicks', async () => {
    const result = await replayActions([
      makeAction({
        type: 'click',
        element: { tag: 'button', selector: '#btn1', text: 'First' },
        x: 100,
        y: 100,
      }),
      makeAction({
        type: 'click',
        element: { tag: 'button', selector: '#btn2', text: 'Second' },
        x: 500,
        y: 400,
        trajectory: {
          points: [
            { x: 100, y: 100, dt: 0 },
            { x: 300, y: 250, dt: 200 },
            { x: 500, y: 400, dt: 180 },
          ],
          distance: 566,
          duration: 380,
        },
      }),
    ]);
    expect(result.success).toBe(2);
    // First click has no trajectory
    // Second click has 3 trajectory moves
    expect(mockPage._mocks.mouse.move).toHaveBeenCalledTimes(3);
  });
});

// ── UserAction type coverage ──────────────────────────────────

describe('UserAction type — new fields', () => {
  it('should accept drag action with full drag data', () => {
    const action: UserAction = makeAction({
      type: 'drag',
      x: 200,
      y: 300,
      drag: {
        fromX: 100,
        fromY: 100,
        toX: 200,
        toY: 300,
        source: { tag: 'div', selector: '#src', text: 'Source' },
        target: { tag: 'div', selector: '#dst', text: 'Target' },
      },
    });
    expect(action.drag?.fromX).toBe(100);
    expect(action.drag?.toX).toBe(200);
    expect(action.drag?.source?.selector).toBe('#src');
    expect(action.drag?.target?.selector).toBe('#dst');
  });

  it('should accept resize action', () => {
    const action: UserAction = makeAction({
      type: 'resize',
      resize: { width: 1920, height: 1080 },
    });
    expect(action.resize?.width).toBe(1920);
    expect(action.resize?.height).toBe(1080);
  });

  it('should accept clipboard action with text preview', () => {
    const action: UserAction = makeAction({
      type: 'clipboard',
      clipboard: { operation: 'paste', textPreview: 'pasted text content' },
    });
    expect(action.clipboard?.operation).toBe('paste');
    expect(action.clipboard?.textPreview).toBe('pasted text content');
  });

  it('should accept touch action with multi-touch', () => {
    const action: UserAction = makeAction({
      type: 'touch',
      element: { tag: 'div', selector: '#canvas', text: '' },
      touch: {
        touchType: 'start',
        touches: [{ x: 100, y: 200 }, { x: 300, y: 400 }],
      },
    });
    expect(action.touch?.touches).toHaveLength(2);
    expect(action.touch?.touchType).toBe('start');
  });

  it('should accept focus action', () => {
    const action: UserAction = makeAction({
      type: 'focus',
      element: { tag: 'input', selector: '#email', text: '' },
      focus: { focusType: 'focus' },
    });
    expect(action.focus?.focusType).toBe('focus');
  });

  it('should accept visibility action', () => {
    const action: UserAction = makeAction({
      type: 'visibility',
      visibility: { state: 'hidden' },
    });
    expect(action.visibility?.state).toBe('hidden');
  });

  it('should accept all type variants', () => {
    const types: UserAction['type'][] = [
      'click', 'input', 'change', 'keydown', 'submit', 'scroll',
      'navigation', 'goto', 'cdp-fill', 'cdp-click', 'cdp-eval', 'filechooser',
      'dblclick', 'contextmenu', 'hover', 'drag', 'resize', 'clipboard',
      'touch', 'focus', 'visibility',
    ];
    expect(types).toHaveLength(21);
    for (const t of types) {
      const action: UserAction = makeAction({ type: t });
      expect(action.type).toBe(t);
    }
  });

  it('should accept trajectory data', () => {
    const action: UserAction = makeAction({
      type: 'click',
      element: { tag: 'button', selector: '#btn', text: 'Go' },
      x: 100,
      y: 200,
      trajectory: {
        points: [
          { x: 50, y: 50, dt: 0 },
          { x: 75, y: 120, dt: 150 },
          { x: 100, y: 200, dt: 200 },
        ],
        distance: 170,
        duration: 350,
      },
    });
    expect(action.trajectory?.points).toHaveLength(3);
    expect(action.trajectory?.distance).toBe(170);
    expect(action.trajectory?.duration).toBe(350);
    expect(action.trajectory?.points[1].dt).toBe(150);
  });
});
