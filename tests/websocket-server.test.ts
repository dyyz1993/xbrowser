import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from 'playwright';
import { WSServer } from '../src/websocket-server.js';

function createMockPage(): Page {
  return {
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Page;
}

function createMockWS(incoming: { on: (event: string, handler: (...args: unknown[]) => void) => void }) {
  const sent: string[] = [];
  let closed = false;

  return {
    sent,
    get closed() {
      return closed;
    },
    ws: {
      send: (data: string) => { sent.push(data); },
      close: () => { closed = true; },
      on: incoming.on,
    },
  };
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

  it('should set and clear page reference', () => {
    const page = createMockPage();
    expect(server.getPage()).toBeNull();
    server.setPage(page);
    expect(server.getPage()).toBe(page);
  });

  describe('bidirectional message handling', () => {
    it('should emit human-solved on solved message', async () => {
      const solvedSpy = vi.fn();
      server.on('human-solved', solvedSpy);

      const page = createMockPage();
      server.setPage(page);

      let messageHandler: ((...args: unknown[]) => void) | undefined;
      const { ws } = createMockWS({
        on: (_event: string, handler: (...args: unknown[]) => void) => {
          messageHandler = handler;
        },
      });

      await server.start();

      const clientId = server.getClientCount() > 0 ? 'test' : 'test';
      server['handleInboundMessage'](clientId, {
        type: 'solved',
      });

      expect(solvedSpy).toHaveBeenCalledWith({
        sessionId: null,
        clientId,
      });
    });

    it('should forward click to page', async () => {
      const page = createMockPage();
      server.setPage(page);

      await server['handleInboundMessage']('test-client', {
        type: 'click',
        x: 100,
        y: 200,
        button: 'left',
      });

      expect(page.mouse.click).toHaveBeenCalledWith(100, 200, { button: 'left' });
    });

    it('should forward click with default button', async () => {
      const page = createMockPage();
      server.setPage(page);

      await server['handleInboundMessage']('test-client', {
        type: 'click',
        x: 50,
        y: 75,
      });

      expect(page.mouse.click).toHaveBeenCalledWith(50, 75, { button: 'left' });
    });

    it('should forward type to page keyboard', async () => {
      const page = createMockPage();
      server.setPage(page);

      await server['handleInboundMessage']('test-client', {
        type: 'type',
        text: 'hello',
      });

      expect(page.keyboard.type).toHaveBeenCalledWith('hello', { delay: 50 });
    });

    it('should forward keypress to page keyboard', async () => {
      const page = createMockPage();
      server.setPage(page);

      await server['handleInboundMessage']('test-client', {
        type: 'keypress',
        key: 'Enter',
      });

      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('should forward scroll to page mouse wheel', async () => {
      const page = createMockPage();
      server.setPage(page);

      await server['handleInboundMessage']('test-client', {
        type: 'scroll',
        deltaX: 0,
        deltaY: 300,
      });

      expect(page.mouse.wheel).toHaveBeenCalledWith(0, 300);
    });

    it('should not crash when page is null', async () => {
      server.setPage(null as unknown as Page);

      await expect(
        server['handleInboundMessage']('test-client', {
          type: 'click',
          x: 10,
          y: 20,
        })
      ).resolves.toBeUndefined();
    });
  });
});
