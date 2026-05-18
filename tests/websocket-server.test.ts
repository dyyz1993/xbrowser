import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from 'playwright';
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
  } as unknown as Page;
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

      (server as any).clients.set(clientId, {
        id: clientId,
        sessionId,
        ws: { send: vi.fn(), close: vi.fn(), on: vi.fn() },
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
      const page = (server as any).screencasts.get(sessionId).page as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'click',
        x: 100,
        y: 200,
        button: 'left',
      });

      expect(page.mouse.click).toHaveBeenCalledWith(100, 200, { button: 'left' });
    });

    it('should forward click with default button', async () => {
      const page = (server as any).screencasts.get(sessionId).page as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'click',
        x: 50,
        y: 75,
      });

      expect(page.mouse.click).toHaveBeenCalledWith(50, 75, { button: 'left' });
    });

    it('should forward type to page keyboard', async () => {
      const page = (server as any).screencasts.get(sessionId).page as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'type',
        text: 'hello',
      });

      expect(page.keyboard.type).toHaveBeenCalledWith('hello', { delay: 50 });
    });

    it('should forward keypress to page keyboard', async () => {
      const page = (server as any).screencasts.get(sessionId).page as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'keypress',
        key: 'Enter',
      });

      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('should forward scroll to page mouse wheel', async () => {
      const page = (server as any).screencasts.get(sessionId).page as Page;

      await server['handleInboundMessage'](clientId, {
        type: 'scroll',
        deltaX: 0,
        deltaY: 300,
      });

      expect(page.mouse.wheel).toHaveBeenCalledWith(0, 300);
    });

    it('should not crash when page is null', async () => {
      const noPageClientId = 'no-page-client';
      (server as any).clients.set(noPageClientId, {
        id: noPageClientId,
        ws: { send: vi.fn(), close: vi.fn(), on: vi.fn() },
      });

      await expect(
        server['handleInboundMessage'](noPageClientId, {
          type: 'click',
          x: 10,
          y: 20,
        })
      ).resolves.toBeUndefined();
    });
  });
});
