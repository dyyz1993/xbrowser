import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '../../src/browser-shim.js';
import { WSServer } from '../../src/websocket-server.js';
import { SessionManager } from '../../src/ws/session-manager.js';
import { StreamCoordinator } from '../../src/ws/stream-coordinator.js';

/**
 * Tests for the `tab switch` → viewer-follows-active-tab fix:
 * registerSession on an already-registered session must rebind the page
 * (previously it early-returned and the screencast stayed on the old tab).
 */

function createCDPMock() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(async () => ({})),
    detach: vi.fn(async () => ({})),
  };
}

function createMockPage(url = 'about:blank', cdp = createCDPMock()): Page {
  return {
    url: vi.fn(() => url),
    context: vi.fn(() => ({
      newCDPSession: vi.fn(async () => cdp),
    })),
    evaluate: vi.fn(async () => ({ width: 800, height: 600 })),
    screenshot: vi.fn(async () => Buffer.from('frame')),
    viewportSize: vi.fn(() => null),
    on: vi.fn(),
    mouse: {},
    keyboard: {},
  } as unknown as Page;
}

function getSwitchTask(sm: SessionManager, sessionId: string): Promise<void> | undefined {
  return (sm as unknown as { pageSwitchTasks: Map<string, Promise<void>> }).pageSwitchTasks.get(sessionId);
}

describe('SessionManager page rebind (tab switch → viewer follows active tab)', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
    sm.setStreamCoordinator(new StreamCoordinator({
      broadcastBinaryToSession: vi.fn(),
    }));
  });

  afterEach(() => {
    for (const id of sm.getSessionIds()) sm.unregisterSession(id);
  });

  it('re-registration with the same page is a no-op (no page-switched)', () => {
    const page = createMockPage();
    sm.registerSession('s1', page);

    const switched = vi.fn();
    sm.on('page-switched', switched);

    sm.registerSession('s1', page);

    expect(switched).not.toHaveBeenCalled();
    expect(sm.getPageForSession('s1')).toBe(page);
  });

  it('re-registration with a different page rebinds page and emits page-switched', async () => {
    const cdpB = createCDPMock();
    const pageA = createMockPage('https://a.example');
    const pageB = createMockPage('https://b.example', cdpB);

    sm.registerSession('s1', pageA);
    const switched = vi.fn();
    sm.on('page-switched', switched);

    sm.registerSession('s1', pageB);
    await getSwitchTask(sm, 's1');

    expect(sm.getPageForSession('s1')).toBe(pageB);
    expect(switched).toHaveBeenCalledWith('s1', pageB);
    // ElementMonitor moved to the new page (focus listeners re-injected there)
    expect(pageB.on).toHaveBeenCalledWith('load', expect.any(Function));
  });

  it('restarts an active capturer on the new page so frames follow the tab switch', async () => {
    const cdpA = createCDPMock();
    const cdpB = createCDPMock();
    const pageA = createMockPage('https://a.example', cdpA);
    const pageB = createMockPage('https://b.example', cdpB);

    sm.registerSession('s1', pageA);
    sm.incrementClientCount('s1'); // viewer connected
    await sm.startCapturer('s1');
    expect(cdpA.send).toHaveBeenCalledWith('Page.startScreencast', expect.any(Object));

    sm.registerSession('s1', pageB);
    await getSwitchTask(sm, 's1');

    expect(cdpA.send).toHaveBeenCalledWith('Page.stopScreencast');
    expect(cdpB.send).toHaveBeenCalledWith('Page.startScreencast', expect.any(Object));
    expect(sm.isCapturerActive('s1')).toBe(true);
  });

  it('rapid successive switches converge on the last page (serialized)', async () => {
    const cdpB = createCDPMock();
    const cdpC = createCDPMock();
    const pageA = createMockPage('https://a.example');
    const pageB = createMockPage('https://b.example', cdpB);
    const pageC = createMockPage('https://c.example', cdpC);

    sm.registerSession('s1', pageA);
    sm.incrementClientCount('s1');

    sm.registerSession('s1', pageB);
    sm.registerSession('s1', pageC);
    await getSwitchTask(sm, 's1');

    expect(sm.getPageForSession('s1')).toBe(pageC);
    // B's capture must not survive the switch to C
    expect(sm.isCapturerActive('s1')).toBe(true);
    expect(cdpB.send).not.toHaveBeenCalledWith('Page.startScreencast', expect.any(Object));
  });

  it('updateSessionPage on an unknown session is a safe no-op', () => {
    const page = createMockPage();
    expect(() => sm.updateSessionPage('ghost', page)).not.toThrow();
  });
});

describe('WSServer page-switch viewer notification', () => {
  it('broadcasts the new URL and clears the previous tab frame cache', () => {
    const server = new WSServer({ port: 0 });
    const coordinator = (server as unknown as {
      streamCoordinator: StreamCoordinator;
    }).streamCoordinator;
    const sessionManager = (server as unknown as {
      sessionManager: SessionManager;
    }).sessionManager;
    const clearLastFrame = vi.spyOn(coordinator, 'clearLastFrame');
    const broadcast = vi.spyOn(server, 'broadcastToSession');
    const nextPage = createMockPage('https://next.example');

    sessionManager.emit('page-switched', 's1', nextPage);

    expect(clearLastFrame).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith('s1', {
      type: 'navigation',
      url: 'https://next.example',
      title: '',
    });
  });
});
