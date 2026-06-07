import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '../src/browser-shim.js';
import { WSServer } from '../src/websocket-server.js';

function createMockPage(): Page {
  return {
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      insertText: vi.fn().mockResolvedValue(undefined),
    },
    fill: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    $: vi.fn().mockResolvedValue(null),
  } as unknown as Page;
}

function bindClient(
  server: WSServer,
  clientId: string,
  sessionId: string,
  sendSpy?: ReturnType<typeof vi.fn>,
): void {
  (server as unknown as Record<string, unknown>).clients.set(clientId, {
    id: clientId,
    sessionId,
    ws: { send: sendSpy ?? vi.fn(), close: vi.fn(), on: vi.fn() },
  });
  const sessionClientsMap = (server as unknown as Record<string, Map<string, Set<string>>>).sessionClients;
  let set = sessionClientsMap.get(sessionId);
  if (!set) {
    set = new Set();
    sessionClientsMap.set(sessionId, set);
  }
  set.add(clientId);
}

interface MockDomElement {
  tag: string;
  id?: string;
  className?: string;
  rect: { x: number; y: number; width: number; height: number };
  display?: string;
  visibility?: string;
  opacity?: string;
}

function withMockDom<T>(
  opts: { viewportWidth: number; viewportHeight: number; elements: MockDomElement[] },
  fn: () => T,
): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const savedWindow = g.window;
  const savedDocument = g.document;
  const savedGetComputedStyle = g.getComputedStyle;

  const elements = opts.elements.map((e) => ({
    tagName: e.tag,
    id: e.id || '',
    className: e.className || '',
    getBoundingClientRect: () => e.rect,
    _computedStyle: {
      display: e.display ?? 'block',
      visibility: e.visibility ?? 'visible',
      opacity: e.opacity ?? '1',
    },
  }));

  g.window = { innerWidth: opts.viewportWidth, innerHeight: opts.viewportHeight, getComputedStyle: (el: { _computedStyle: Record<string, string> }) => el._computedStyle };
  g.document = { querySelectorAll: () => elements };
  g.getComputedStyle = (el: { _computedStyle: Record<string, string> }) => el._computedStyle;

  try {
    return fn();
  } finally {
    if (savedWindow === undefined) delete g.window;
    else g.window = savedWindow;
    if (savedDocument === undefined) delete g.document;
    else g.document = savedDocument;
    if (savedGetComputedStyle === undefined) delete g.getComputedStyle;
    else g.getComputedStyle = savedGetComputedStyle;
  }
}

describe('WSServer view tabs', () => {
  let server: WSServer;
  const sessionId = 'test-session';
  const clientId = 'client-1';

  beforeEach(() => {
    server = new WSServer({ port: 0 });
    const page = createMockPage();
    server.registerSession(sessionId, page);
  });

  afterEach(() => {
    server.unregisterSession(sessionId);
  });

  describe('A. select_view message handling', () => {
    beforeEach(() => {
      bindClient(server, clientId, sessionId);
      // Avoid triggering processAndBroadcast in the handler
      (server as unknown as Record<string, unknown>).lastFrameData = null;
      (server as unknown as Record<string, unknown>).lastFrameViewport = null;
    });

    it('should clear sessionCrops when select_view with rect:null is received', async () => {
      const crops = (server as unknown as Record<string, Map<string, unknown>>).sessionCrops;
      crops.set(sessionId, {
        selector: 'old',
        box: { x: 1, y: 2, width: 3, height: 4 },
      });

      await server['handleInboundMessage'](clientId, { type: 'select_view', rect: null });

      expect(crops.has(sessionId)).toBe(false);
    });

    it('should set sessionCrops when select_view with a rect is received', async () => {
      const crops = (server as unknown as Record<string, Map<string, unknown>>).sessionCrops;
      const rect = { x: 10, y: 20, width: 800, height: 600 };

      await server['handleInboundMessage'](clientId, { type: 'select_view', rect });

      expect(crops.get(sessionId)).toEqual({
        selector: 'view',
        box: rect,
      });
    });

    it('should broadcast cropped viewport dimensions after setting crop', async () => {
      const sendSpy = vi.fn();
      bindClient(server, clientId, sessionId, sendSpy);
      const rect = { x: 50, y: 60, width: 700, height: 500 };

      await server['handleInboundMessage'](clientId, { type: 'select_view', rect });

      const statusCall = sendSpy.mock.calls.find((call: unknown[]) => {
        try {
          const m = JSON.parse(call[0] as string) as { type: string; data: { viewport?: unknown } };
          return m.type === 'status' && m.data.viewport !== undefined;
        } catch { return false; }
      });
      expect(statusCall).toBeDefined();
      const msg = JSON.parse(statusCall![0] as string) as { data: { viewport: { width: number; height: number } } };
      expect(msg.data.viewport).toEqual({ width: 700, height: 500 });
    });

    it('should broadcast lastFrameViewport dimensions when clearing crop', async () => {
      const sendSpy = vi.fn();
      bindClient(server, clientId, sessionId, sendSpy);
      const crops = (server as unknown as Record<string, Map<string, unknown>>).sessionCrops;
      crops.set(sessionId, {
        selector: 'view',
        box: { x: 1, y: 2, width: 3, height: 4 },
      });
      (server as unknown as Record<string, unknown>).lastFrameViewport = { width: 1920, height: 1080 };

      await server['handleInboundMessage'](clientId, { type: 'select_view', rect: null });

      const statusCall = sendSpy.mock.calls.find((call: unknown[]) => {
        try {
          const m = JSON.parse(call[0] as string) as { type: string; data: { viewport?: unknown } };
          return m.type === 'status' && m.data.viewport !== undefined;
        } catch { return false; }
      });
      expect(statusCall).toBeDefined();
      const msg = JSON.parse(statusCall![0] as string) as { data: { viewport: { width: number; height: number } } };
      expect(msg.data.viewport).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe('B. coordinate offset in input handlers', () => {
    beforeEach(() => {
      bindClient(server, clientId, sessionId);
    });

    it('should add crop offset to click coordinates', async () => {
      const page = (server as unknown as Record<string, Map<string, { page: Page }>>).screencasts.get(sessionId)!.page;
      const crops = (server as unknown as Record<string, Map<string, unknown>>).sessionCrops;
      crops.set(sessionId, {
        selector: 'view',
        box: { x: 100, y: 200, width: 400, height: 300 },
      });

      await server['handleInboundMessage'](clientId, { type: 'click', x: 50, y: 50 });

      expect(page.mouse.click).toHaveBeenCalledWith(150, 250, { button: 'left' });
    });

    it('should pass click coordinates through unchanged when no crop is active', async () => {
      const page = (server as unknown as Record<string, Map<string, { page: Page }>>).screencasts.get(sessionId)!.page;

      await server['handleInboundMessage'](clientId, { type: 'click', x: 50, y: 50 });

      expect(page.mouse.click).toHaveBeenCalledWith(50, 50, { button: 'left' });
    });

    it('should add crop offset to input_mouse move coordinates', async () => {
      const page = (server as unknown as Record<string, Map<string, { page: Page }>>).screencasts.get(sessionId)!.page;
      const crops = (server as unknown as Record<string, Map<string, unknown>>).sessionCrops;
      crops.set(sessionId, {
        selector: 'view',
        box: { x: 100, y: 200, width: 400, height: 300 },
      });

      await server['handleInboundMessage'](clientId, {
        type: 'input_mouse',
        action: 'move',
        x: 10,
        y: 20,
      });

      expect(page.mouse.move).toHaveBeenCalledWith(110, 220);
    });

    it('should add crop offset to input_mouse click coordinates', async () => {
      const pageMock = (server as unknown as Record<string, Map<string, { page: Page }>>).screencasts.get(sessionId)!.page;
      const crops = (server as unknown as Record<string, Map<string, unknown>>).sessionCrops;
      crops.set(sessionId, {
        selector: 'view',
        box: { x: 100, y: 200, width: 400, height: 300 },
      });
      // input_mouse click also calls page.evaluate for focus; mock it to resolve cleanly
      (pageMock as unknown as Record<string, ReturnType<typeof vi.fn>>).evaluate = vi.fn().mockResolvedValue({ isFile: false, selector: '' });

      await server['handleInboundMessage'](clientId, {
        type: 'input_mouse',
        action: 'click',
        x: 25,
        y: 35,
        button: 'left',
      });

      expect(pageMock.mouse.click).toHaveBeenCalledWith(125, 235, { button: 'left' });
    });

    it('should pass input_mouse coordinates through unchanged when no crop', async () => {
      const page = (server as unknown as Record<string, Map<string, { page: Page }>>).screencasts.get(sessionId)!.page;

      await server['handleInboundMessage'](clientId, {
        type: 'input_mouse',
        action: 'move',
        x: 80,
        y: 90,
      });

      expect(page.mouse.move).toHaveBeenCalledWith(80, 90);
    });
  });

  describe('C. element scanner', () => {
    let evaluateCalls: Array<() => unknown> = [];

    beforeEach(() => {
      // Drop the default session created by the outer beforeEach so its real-timer
      // intervals don't interfere with the fake timers used here.
      server.unregisterSession(sessionId);

      vi.useFakeTimers();
      evaluateCalls = [];

      const page: Page = {
        mouse: {
          click: vi.fn().mockResolvedValue(undefined),
          wheel: vi.fn().mockResolvedValue(undefined),
          move: vi.fn().mockResolvedValue(undefined),
          down: vi.fn().mockResolvedValue(undefined),
          up: vi.fn().mockResolvedValue(undefined),
        },
        keyboard: {
          type: vi.fn().mockResolvedValue(undefined),
          press: vi.fn().mockResolvedValue(undefined),
          down: vi.fn().mockResolvedValue(undefined),
          up: vi.fn().mockResolvedValue(undefined),
          insertText: vi.fn().mockResolvedValue(undefined),
        },
        fill: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation((fn: () => unknown) => {
          evaluateCalls.push(fn);
          const src = fn.toString();
          // Element scanner fn uses querySelectorAll and returns an array;
          // everything else (focus listener injection, focus poll) is treated as
          // returning an object.
          if (src.includes('querySelectorAll')) {
            return Promise.resolve([]);
          }
          return Promise.resolve({ focused: false });
        }),
        on: vi.fn(),
        $: vi.fn().mockResolvedValue(null),
      } as unknown as Page;

      server.registerSession(sessionId, page);

      // Scanner skips when no clients are connected — bind one.
      bindClient(server, clientId, sessionId);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function getElementScanFn(): (() => unknown) | undefined {
      return evaluateCalls.find((fn) => fn.toString().includes('querySelectorAll'));
    }

    it('should use selectors: dialog, modal, popup, overlay, drawer, form', async () => {
      await vi.advanceTimersByTimeAsync(3000);

      const scanFn = getElementScanFn();
      expect(scanFn).toBeDefined();

      const src = scanFn!.toString();
      expect(src).toContain('[role="dialog"]');
      expect(src).toContain('dialog');
      expect(src).toContain('[class*="modal"]');
      expect(src).toContain('[class*="popup"]');
      expect(src).toContain('[class*="overlay"]');
      expect(src).toContain('[class*="drawer"]');
      expect(src).toContain('form');
    });

    it('should filter out elements smaller than 50x30', async () => {
      await vi.advanceTimersByTimeAsync(3000);

      const scanFn = getElementScanFn();
      expect(scanFn).toBeDefined();

      const result = withMockDom(
        {
          viewportWidth: 1920,
          viewportHeight: 1080,
          elements: [
            // width 30 < 50 — filtered
            { tag: 'DIV', className: 'modal', rect: { x: 0, y: 0, width: 30, height: 100 } },
            // height 25 < 30 — filtered
            { tag: 'DIV', className: 'modal', rect: { x: 0, y: 0, width: 100, height: 25 } },
            // 200x100 — kept
            { tag: 'DIV', className: 'popup', rect: { x: 10, y: 20, width: 200, height: 100 } },
          ],
        },
        () => (scanFn!() as unknown[]),
      );

      expect(result).toHaveLength(1);
      const kept = result[0] as { cls: string; tag: string };
      expect(kept.tag).toBe('DIV');
      expect(kept.cls).toContain('popup');
    });

    it('should filter out elements covering >90% of viewport', async () => {
      await vi.advanceTimersByTimeAsync(3000);

      const scanFn = getElementScanFn();
      expect(scanFn).toBeDefined();

      // viewport = 1000 * 1000 = 1,000,000; threshold = 900,000
      const result = withMockDom(
        {
          viewportWidth: 1000,
          viewportHeight: 1000,
          elements: [
            // 950 * 1000 = 950,000 > 900,000 → filtered
            { tag: 'FORM', rect: { x: 0, y: 0, width: 950, height: 1000 } },
            // 850 * 1000 = 850,000 < 900,000 → kept
            { tag: 'DIV', className: 'modal', rect: { x: 0, y: 0, width: 850, height: 1000 } },
          ],
        },
        () => (scanFn!() as unknown[]),
      );

      expect(result).toHaveLength(1);
      const kept = result[0] as { tag: string; cls: string };
      expect(kept.tag).toBe('DIV');
      expect(kept.cls).toContain('modal');
    });

    it('should skip hidden elements (display:none, visibility:hidden, opacity:0)', async () => {
      await vi.advanceTimersByTimeAsync(3000);

      const scanFn = getElementScanFn();
      expect(scanFn).toBeDefined();

      const result = withMockDom(
        {
          viewportWidth: 1920,
          viewportHeight: 1080,
          elements: [
            { tag: 'DIV', className: 'modal', rect: { x: 0, y: 0, width: 200, height: 100 }, display: 'none' },
            { tag: 'DIV', className: 'popup', rect: { x: 0, y: 0, width: 200, height: 100 }, visibility: 'hidden' },
            { tag: 'DIV', className: 'overlay', rect: { x: 0, y: 0, width: 200, height: 100 }, opacity: '0' },
            { tag: 'DIV', className: 'drawer', rect: { x: 0, y: 0, width: 200, height: 100 } },
          ],
        },
        () => (scanFn!() as unknown[]),
      );

      expect(result).toHaveLength(1);
      const kept = result[0] as { cls: string };
      expect(kept.cls).toContain('drawer');
    });
  });
});
