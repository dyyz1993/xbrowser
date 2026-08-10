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

function createMockElement(box: { x: number; y: number; width: number; height: number }) {
  return {
    boundingBox: vi.fn().mockResolvedValue(box),
  };
}

/** Helper to access internal sessionManager from WSServer */
function getSM(server: WSServer) {
  return (server as unknown as Record<string, unknown>).sessionManager as import('../src/ws/session-manager.js').SessionManager;
}

/** Helper to access internal streamCoordinator from WSServer */
function getSC(server: WSServer) {
  return (server as unknown as Record<string, unknown>).streamCoordinator as import('../src/ws/stream-coordinator.js').StreamCoordinator;
}

describe('WSServer', () => {
  let server: WSServer;

  beforeEach(() => {
    server = new WSServer({ port: 0 });
  });

  afterEach(async () => {
    if (server.getRunning()) {
      await server.stop();
    }
  });

  it('should reject double start', async () => {
    await server.start();
    await expect(server.start()).rejects.toThrow('already running');
    await server.stop();
  });

  it('should register and unregister a session page', () => {
    const page = createMockPage();
    const sessionId = 'test-session';

    server.registerSession(sessionId, page);
    server.unregisterSession(sessionId);
  });

  describe('bidirectional message handling', () => {
    const sessionId = 'test-session';
    const clientId = 'test-client-id';

    beforeEach(() => {
      const page = createMockPage();
      server.registerSession(sessionId, page);

      const sm = getSM(server);
      sm.addClient({
        id: clientId,
        sessionId,
        ws: { send: vi.fn(), close: vi.fn(), on: vi.fn() } as unknown as import('../src/ws/session-manager.js').WSLike,
      });
    });

    afterEach(() => {
      server.unregisterSession(sessionId);
    });

    it('should emit human-solved on solved message', async () => {
      const solvedSpy = vi.fn();
      server.on('human-solved', solvedSpy);

      server['handleInboundMessage'](clientId, {
        type: 'solved',
      });

      expect(solvedSpy).toHaveBeenCalledWith({
        sessionId,
        clientId,
      });
    });

    it('should forward click to page', async () => {
      const page = getSM(server).getPageForSession(sessionId) as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'click',
        x: 100,
        y: 200,
        button: 'left',
      });

      expect(page.mouse.click).toHaveBeenCalledWith(100, 200, { button: 'left' });
    });

    it('should forward click with default button', async () => {
      const page = getSM(server).getPageForSession(sessionId) as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'click',
        x: 50,
        y: 75,
      });

      expect(page.mouse.click).toHaveBeenCalledWith(50, 75, { button: 'left' });
    });

    it('should forward type to page keyboard', async () => {
      const page = getSM(server).getPageForSession(sessionId) as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'type',
        text: 'hello',
      });

      expect(page.keyboard.type).toHaveBeenCalledWith('hello', { delay: 50 });
    });

    it('should forward keypress to page keyboard', async () => {
      const page = getSM(server).getPageForSession(sessionId) as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'keypress',
        key: 'Enter',
      });

      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('should forward scroll to page mouse wheel', async () => {
      const page = getSM(server).getPageForSession(sessionId) as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'scroll',
        deltaX: 0,
        deltaY: 300,
      });

      expect(page.mouse.wheel).toHaveBeenCalledWith(0, 300);
    });

    it('should not crash when page is null', async () => {
      const noPageClientId = 'no-page-client';
      const sm = getSM(server);
      sm.addClient({
        id: noPageClientId,
        ws: { send: vi.fn(), close: vi.fn(), on: vi.fn() } as unknown as import('../src/ws/session-manager.js').WSLike,
      });

      await expect(
        server['handleInboundMessage'](noPageClientId, {
          type: 'click',
          x: 10,
          y: 20,
        })
      ).resolves.toBeUndefined();
    });

    it('should handle focus_element message and set crop box', async () => {
      const page = getSM(server).getPageForSession(sessionId) as Page;
      const mockElement = createMockElement({ x: 100, y: 200, width: 300, height: 150 });
      (page as any).$ = vi.fn().mockResolvedValue(mockElement);

      const sendSpy = vi.fn();
      const sm = getSM(server);
      // Replace the client with one that has a spy
      sm.addClient({
        id: clientId,
        sessionId,
        ws: { send: sendSpy, close: vi.fn(), on: vi.fn() } as unknown as import('../src/ws/session-manager.js').WSLike,
      });
      // Set up sessionClients for broadcast
      sm.bindClientToSession(clientId, sessionId);

      await server['handleInboundMessage'](clientId, {
        type: 'focus_element',
        selector: '#my-element',
      });

      expect(page.$).toHaveBeenCalledWith('#my-element');
      expect(getSC(server).getCrop(sessionId)).toEqual({
        selector: '#my-element',
        box: { x: 100, y: 200, width: 300, height: 150 },
      });

      const statusCall = sendSpy.mock.calls.find((call: any[]) => {
        try {
          const msg = JSON.parse(call[0]);
          return msg.type === 'status' && msg.data.viewport;
        } catch { return false; }
      });
      expect(statusCall).toBeDefined();
      const statusMsg = JSON.parse(statusCall![0]);
      expect(statusMsg.data.viewport).toEqual({ width: 300, height: 150 });
    });

    it('should handle focus_element when element not found', async () => {
      const page = getSM(server).getPageForSession(sessionId) as Page;
      (page as any).$ = vi.fn().mockResolvedValue(null);

      await server['handleInboundMessage'](clientId, {
        type: 'focus_element',
        selector: '#nonexistent',
      });

      expect(getSC(server).getCrop(sessionId)).toBeUndefined();
    });

    it('should handle focus_clear message and reset crop', async () => {
      const sc = getSC(server);
      sc.setCrop(sessionId, {
        selector: '#my-element',
        box: { x: 100, y: 200, width: 300, height: 150 },
      });
      // Simulate having a last frame viewport
      (sc as unknown as Record<string, unknown>).lastFrameViewport = { width: 1920, height: 1080 };
      (sc as unknown as Record<string, unknown>).lastFrameData = null;

      const sendSpy = vi.fn();
      const sm = getSM(server);
      sm.addClient({
        id: clientId,
        sessionId,
        ws: { send: sendSpy, close: vi.fn(), on: vi.fn() } as unknown as import('../src/ws/session-manager.js').WSLike,
      });
      sm.bindClientToSession(clientId, sessionId);

      await server['handleInboundMessage'](clientId, {
        type: 'focus_clear',
      });

      expect(sc.getCrop(sessionId)).toBeUndefined();

      const statusCall = sendSpy.mock.calls.find((call: any[]) => {
        try {
          const msg = JSON.parse(call[0]);
          return msg.type === 'status' && msg.data.viewport;
        } catch { return false; }
      });
      expect(statusCall).toBeDefined();
      const statusMsg = JSON.parse(statusCall![0]);
      expect(statusMsg.data.viewport).toEqual({ width: 1920, height: 1080 });
    });

    it('should apply crop to frames when crop is set', async () => {
      const sc = getSC(server);
      sc.setCrop(sessionId, {
        selector: '#my-element',
        box: { x: 50, y: 50, width: 400, height: 300 },
      });

      const processSpy = vi.spyOn((sc as unknown as Record<string, unknown>).frameProcessor as import('../src/stream/frame-processor.js').FrameProcessor, 'process').mockResolvedValue(Buffer.from('fake'));

      await sc.processAndBroadcast(
        'base64data',
        { width: 1920, height: 1080 },
        sessionId,
        sessionId,
        'frame-id',
        Date.now(),
        '',
      );

      // process() receives the ORIGINAL viewport (1920×1080), not the crop
      // size, so crop coordinates can be scaled from viewport to pixel space.
      // The 2nd arg is the adjusted compression config object.
      expect(processSpy).toHaveBeenCalledWith(
        'base64data',
        expect.anything(),
        1920,
        1080,
        { x: 50, y: 50, width: 400, height: 300 },
      );

      processSpy.mockRestore();
    });
  });
});
