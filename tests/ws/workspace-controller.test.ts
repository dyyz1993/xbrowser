import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page, BrowserContext } from '../../src/browser-shim.js';
import type { WSMessage } from '../../src/websocket-server.js';
import { WSServer } from '../../src/websocket-server.js';
import { SessionManager } from '../../src/ws/session-manager.js';
import {
  WorkspaceController,
  assertSafeNavigationUrl,
  checkWorkspaceTrust,
  type WorkspaceContext,
  type WorkspaceInboundMessage,
  type WorkspaceSessionHandle,
} from '../../src/ws/workspace-controller.js';

/**
 * Backend tests for the Viewer browser workspace controls
 * (`workspace_request` / `workspace_navigate` / `workspace_history` /
 * `workspace_tab` → `workspace_state` / `workspace_error`), including the
 * trust-targeted send policy and stable tab IDs.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockPageInit {
  url?: string;
  title?: string;
}

function createMockPage(init: MockPageInit = {}): Page & {
  goto: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  goForward: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  bringToFront: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
} {
  const page = {
    url: vi.fn(() => init.url ?? 'about:blank'),
    title: vi.fn(async () => init.title ?? 'Mock Title'),
    goto: vi.fn(async () => null),
    goBack: vi.fn(async () => undefined),
    goForward: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    bringToFront: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => undefined),
    on: vi.fn(),
    context: vi.fn(),
    mouse: { move: vi.fn(async () => undefined), click: vi.fn(async () => undefined), wheel: vi.fn(async () => undefined) },
    keyboard: {},
    viewportSize: vi.fn(() => null),
    screenshot: vi.fn(async () => Buffer.from('frame')),
  };
  return page as unknown as ReturnType<typeof createMockPage>;
}

/** Creates a mock context whose pages() reflects the mutable array. */
function createMockContext(pages: Page[]): BrowserContext & {
  pages: ReturnType<typeof vi.fn>;
  newPage: ReturnType<typeof vi.fn>;
} {
  const ctx = {
    pages: vi.fn(() => pages),
    newPage: vi.fn(),
    browser: vi.fn(),
    close: vi.fn(async () => undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
  return ctx as unknown as ReturnType<typeof createMockContext>;
}

/** Makes page.close() remove the page from the owning pages array. */
function makeCloseRemovePage(page: Page, pages: Page[]): void {
  (page as unknown as { close: ReturnType<typeof vi.fn> }).close = vi.fn(async () => {
    const i = pages.indexOf(page);
    if (i >= 0) pages.splice(i, 1);
  });
}

interface Spies {
  send: ReturnType<typeof vi.fn>;
  sendTrusted: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
}

function makeSpies(): Spies {
  return { send: vi.fn(), sendTrusted: vi.fn(), broadcast: vi.fn() };
}

function makeCtx(
  sessionId: string | undefined,
  message: WorkspaceInboundMessage,
  spies: Spies,
  clientId = 'client-1',
): WorkspaceContext {
  return {
    clientId,
    sessionId,
    message,
    sendToClient: spies.send,
    sendToTrustedSessionClients: spies.sendTrusted,
    broadcastToSession: spies.broadcast,
  };
}

/** workspace_state messages seen on any outbound channel. */
function sentWorkspaces(spies: Spies): WSMessage[] {
  const all = [
    ...spies.send.mock.calls.map((c: unknown[]) => c[1] as WSMessage),
    ...spies.sendTrusted.mock.calls.map((c: unknown[]) => c[1] as WSMessage),
    ...spies.broadcast.mock.calls.map((c: unknown[]) => c[1] as WSMessage),
  ];
  return all.filter(m => m.type === 'workspace_state');
}

function sentErrors(spies: Spies): Array<{ message: string }> {
  return spies.send.mock.calls
    .map((c: unknown[]) => c[1] as WSMessage)
    .filter(m => m.type === 'workspace_error') as Array<{ type: 'workspace_error'; message: string }>;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe('assertSafeNavigationUrl', () => {
  it('allows http and https URLs (normalized)', () => {
    expect(assertSafeNavigationUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(assertSafeNavigationUrl('  http://example.com  ')).toBe('http://example.com/');
  });

  it('allows exactly about:blank as the safe initial blank', () => {
    expect(assertSafeNavigationUrl('about:blank')).toBe('about:blank');
  });

  it('rejects dangerous schemes before any page call', () => {
    for (const bad of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>1</script>',
      'chrome://extensions',
      'chrome-extension://abc/popup.html',
      'about:config',
      'ftp://example.com',
      'ws://example.com',
    ]) {
      expect(() => assertSafeNavigationUrl(bad)).toThrow(/Unsupported URL scheme|Invalid URL/);
    }
  });

  it('rejects empty and malformed URLs', () => {
    expect(() => assertSafeNavigationUrl('')).toThrow('empty');
    expect(() => assertSafeNavigationUrl('   ')).toThrow('empty');
    expect(() => assertSafeNavigationUrl('not a url')).toThrow('Invalid URL');
  });
});

// ---------------------------------------------------------------------------
// Trust boundary policy (loopback peer + loopback Viewer origin/port)
// ---------------------------------------------------------------------------

describe('checkWorkspaceTrust (policy assertions)', () => {
  const VIEWER_PORT = 9224;

  it('allows programmatic clients without transport metadata', () => {
    expect(checkWorkspaceTrust(undefined, VIEWER_PORT)).toEqual({ ok: true });
    expect(checkWorkspaceTrust({}, VIEWER_PORT)).toEqual({ ok: true });
  });

  it('allows loopback peers with no Origin (programmatic loopback clients)', () => {
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(checkWorkspaceTrust({ remoteAddress: addr }, VIEWER_PORT)).toEqual({ ok: true });
    }
  });

  it('allows the loopback Viewer origin on the Viewer port', () => {
    for (const origin of ['http://localhost:9224', 'http://127.0.0.1:9224', 'http://[::1]:9224']) {
      expect(checkWorkspaceTrust({ remoteAddress: '127.0.0.1', origin }, VIEWER_PORT)).toEqual({ ok: true });
    }
  });

  it('rejects non-loopback peers before any session work', () => {
    const verdict = checkWorkspaceTrust({ remoteAddress: '192.168.1.50' }, VIEWER_PORT);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/not loopback/);
  });

  it('rejects loopback peers presenting a non-loopback Origin', () => {
    const verdict = checkWorkspaceTrust({ remoteAddress: '127.0.0.1', origin: 'https://evil.example' }, VIEWER_PORT);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/local Viewer origin/);
  });

  it('rejects loopback Origins on a port other than the Viewer port', () => {
    const verdict = checkWorkspaceTrust({ remoteAddress: '127.0.0.1', origin: 'http://localhost:9999' }, VIEWER_PORT);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/origin port 9999 != viewer port 9224/);
  });

  it('rejects port-less Origins when the Viewer is not on the default port', () => {
    const verdict = checkWorkspaceTrust({ remoteAddress: '127.0.0.1', origin: 'http://localhost' }, VIEWER_PORT);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/origin port/);
  });

  it('rejects malformed and non-http(s) Origins', () => {
    expect(checkWorkspaceTrust({ origin: '::not a url::' }, VIEWER_PORT).ok).toBe(false);
    expect(checkWorkspaceTrust({ origin: 'file://localhost:9224' }, VIEWER_PORT).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorkspaceController
// ---------------------------------------------------------------------------

describe('WorkspaceController', () => {
  let sm: SessionManager;
  let controller: WorkspaceController;
  let spies: Spies;

  beforeEach(() => {
    sm = new SessionManager();
    controller = new WorkspaceController(sm);
    spies = makeSpies();
  });

  afterEach(() => {
    for (const id of sm.getSessionIds()) sm.unregisterSession(id);
  });

  function setManagedResolver(sessionId: string, page: Page, context: BrowserContext | null) {
    const handle: WorkspaceSessionHandle = {
      page,
      context,
      managed: !!context,
      setActivePage: vi.fn((p: Page) => { handle.page = p; }),
    };
    controller.setResolver((sid) => (sid === sessionId ? handle : undefined));
    return handle;
  }

  // ── workspace_request ─────────────────────────────────────────────

  it('enumerates all tabs (with stable ids) and activeIndex for managed sessions', async () => {
    const pageA = createMockPage({ url: 'https://a.example/', title: 'A' });
    const pageB = createMockPage({ url: 'https://b.example/', title: 'B' });
    const ctx = createMockContext([pageA, pageB]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));

    const states = sentWorkspaces(spies);
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({
      type: 'workspace_state',
      sessionId: 'sess',
      tabs: [
        { id: expect.any(String), index: 0, url: 'https://a.example/', title: 'A' },
        { id: expect.any(String), index: 1, url: 'https://b.example/', title: 'B' },
      ],
      activeIndex: 0,
    });
  });

  it('keeps tab ids stable across repeated state builds', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const ctx = createMockContext([pageA, pageB]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));
    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));

    const [first, second] = sentWorkspaces(spies) as Array<{ tabs: Array<{ id: string }> }>;
    expect(first.tabs.map(t => t.id)).toEqual(second.tabs.map(t => t.id));
  });

  it('replies to the requesting client only — no broadcast of tab metadata', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const ctx = createMockContext([pageA]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies, 'viewer-1'));

    // State went to the requester's sendToClient channel alone.
    expect(spies.send).toHaveBeenCalledWith('viewer-1', expect.objectContaining({ type: 'workspace_state' }));
    expect(spies.sendTrusted).not.toHaveBeenCalled();
    expect(
      spies.broadcast.mock.calls.map((c: unknown[]) => c[1] as { type: string }).some(m => m.type === 'workspace_state'),
    ).toBe(false);
  });

  it('reports a read-only single page for externally-owned (CDP) sessions', async () => {
    const page = createMockPage({ url: 'https://user-tab.example/', title: 'User Tab' });
    setManagedResolver('cdp-sess', page, null);

    await controller.dispatch(makeCtx('cdp-sess', { type: 'workspace_request' }, spies));

    const states = sentWorkspaces(spies) as Array<{
      type: 'workspace_state'; readOnly?: boolean; tabs: Array<{ id: string; url: string }>; activeIndex: number;
    }>;
    expect(states).toHaveLength(1);
    expect(states[0].readOnly).toBe(true);
    expect(states[0].tabs).toEqual([{ id: expect.any(String), index: 0, url: 'https://user-tab.example/', title: 'User Tab' }]);
    expect(states[0].activeIndex).toBe(0);
  });

  it('falls back to a read-only WS-registered page when no resolver is set', async () => {
    const page = createMockPage({ url: 'https://standalone.example/' });
    sm.registerSession('solo', page);

    await controller.dispatch(makeCtx('solo', { type: 'workspace_request' }, spies));

    const states = sentWorkspaces(spies) as Array<{ readOnly?: boolean; tabs: unknown[] }>;
    expect(states[0].readOnly).toBe(true);
    expect(states[0].tabs).toHaveLength(1);
  });

  it('errors when the client is not bound to a session', async () => {
    await controller.dispatch(makeCtx(undefined, { type: 'workspace_request' }, spies));
    const errors = sentErrors(spies);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Not bound to a session/);
  });

  it('errors for an unknown session', async () => {
    await controller.dispatch(makeCtx('ghost', { type: 'workspace_request' }, spies));
    expect(sentErrors(spies)[0].message).toMatch(/not found/);
  });

  it('exposes handoffWaiting when the handoff probe reports an active wait', async () => {
    const page = createMockPage({ url: 'https://a.example/' });
    const ctx = createMockContext([page]);
    setManagedResolver('sess', page, ctx);
    controller.setHandoffProbe((sid) => sid === 'sess');

    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));
    const states = sentWorkspaces(spies) as Array<{ handoffWaiting?: boolean }>;
    expect(states[0].handoffWaiting).toBe(true);
  });

  // ── workspace_navigate ────────────────────────────────────────────

  it('navigates the bound page to a validated http URL and notifies trusted clients only', async () => {
    const page = createMockPage({ url: 'https://old.example/' });
    const ctx = createMockContext([page]);
    setManagedResolver('sess', page, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_navigate', url: 'https://new.example/page' }, spies));

    expect(page.goto).toHaveBeenCalledWith('https://new.example/page', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    // Mutation state flows through the trusted-targeted channel only.
    expect(spies.sendTrusted).toHaveBeenCalledWith('sess', expect.objectContaining({ type: 'workspace_state' }));
    expect(
      spies.broadcast.mock.calls.map((c: unknown[]) => c[1] as { type: string }).some(m => m.type === 'workspace_state'),
    ).toBe(false);
    expect(sentErrors(spies)).toHaveLength(0);
  });

  it('rejects navigation to javascript: URLs without touching the page', async () => {
    const page = createMockPage();
    const ctx = createMockContext([page]);
    setManagedResolver('sess', page, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_navigate', url: 'javascript:alert(1)' }, spies));

    expect(page.goto).not.toHaveBeenCalled();
    expect(sentErrors(spies)[0].message).toMatch(/Unsupported URL scheme/);
  });

  it('rejects navigation on read-only (external) sessions', async () => {
    const page = createMockPage();
    setManagedResolver('cdp-sess', page, null);

    await controller.dispatch(makeCtx('cdp-sess', { type: 'workspace_navigate', url: 'https://x.example/' }, spies));

    expect(page.goto).not.toHaveBeenCalled();
    expect(sentErrors(spies)[0].message).toMatch(/external browser/);
  });

  it('reports goto failures as workspace_error', async () => {
    const page = createMockPage();
    page.goto = vi.fn(async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); });
    const ctx = createMockContext([page]);
    setManagedResolver('sess', page, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_navigate', url: 'https://down.example/' }, spies));

    expect(sentErrors(spies)[0].message).toMatch(/ERR_CONNECTION_REFUSED/);
  });

  // ── workspace_history ─────────────────────────────────────────────

  it.each(['back', 'forward', 'reload'] as const)('performs history action %s', async (action) => {
    const page = createMockPage();
    const ctx = createMockContext([page]);
    setManagedResolver('sess', page, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_history', action }, spies));

    if (action === 'back') expect(page.goBack).toHaveBeenCalledWith({ timeout: 15000 });
    if (action === 'forward') expect(page.goForward).toHaveBeenCalledWith({ timeout: 15000 });
    if (action === 'reload') expect(page.reload).toHaveBeenCalledWith({ timeout: 15000 });
    expect(spies.sendTrusted).toHaveBeenCalledWith('sess', expect.objectContaining({ type: 'workspace_state' }));
  });

  it('rejects an invalid history action', async () => {
    const page = createMockPage();
    const ctx = createMockContext([page]);
    setManagedResolver('sess', page, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_history', action: 'sideways' as 'back' }, spies));

    expect(page.goBack).not.toHaveBeenCalled();
    expect(sentErrors(spies)[0].message).toMatch(/Invalid history action/);
  });

  it('rejects history on read-only sessions', async () => {
    const page = createMockPage();
    setManagedResolver('cdp-sess', page, null);

    await controller.dispatch(makeCtx('cdp-sess', { type: 'workspace_history', action: 'reload' }, spies));

    expect(page.reload).not.toHaveBeenCalled();
    expect(sentErrors(spies)[0].message).toMatch(/external browser/);
  });

  // ── workspace_tab new ─────────────────────────────────────────────

  it('opens a new tab, rebinds the active page, and re-registers the session', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'about:blank', title: '' });
    const pages: Page[] = [pageA];
    const ctx = createMockContext(pages);
    ctx.newPage = vi.fn(async () => {
      pages.push(pageB);
      return pageB;
    });
    const handle = setManagedResolver('sess', pageA, ctx);
    const registerSpy = vi.spyOn(sm, 'registerSession');

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'new' }, spies));

    expect(ctx.newPage).toHaveBeenCalledTimes(1);
    expect(handle.setActivePage).toHaveBeenCalledWith(pageB);
    expect(registerSpy).toHaveBeenCalledWith('sess', pageB, undefined);
    expect(handle.page).toBe(pageB);

    const states = sentWorkspaces(spies) as Array<{
      tabs: Array<{ url: string }>; activeIndex: number; readOnly?: boolean;
    }>;
    expect(states[0].tabs).toEqual([
      { id: expect.any(String), index: 0, url: 'https://a.example/', title: 'Mock Title' },
      { id: expect.any(String), index: 1, url: 'about:blank' },
    ]);
    expect(states[0].activeIndex).toBe(1);
    expect(states[0].readOnly).toBeUndefined();
  });

  // ── workspace_tab select (tabId preferred, index legacy) ──────────

  it('selects a tab by stable tabId even after out-of-band index shifts', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pageC = createMockPage({ url: 'https://c.example/' });
    const pages: Page[] = [pageA, pageB, pageC];
    const ctx = createMockContext(pages);
    setManagedResolver('sess', pageA, ctx);

    // Snapshot state to learn tab ids.
    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));
    const [state] = sentWorkspaces(spies) as Array<{ tabs: Array<{ id: string; url: string }> }>;
    const idC = state.tabs.find(t => t.url === 'https://c.example/')!.id;

    // Out-of-band close of tab 0 shifts positions (C moves 2 → 1).
    pages.splice(0, 1);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'select', tabId: idC }, spies));

    // tabId still names C — a stale positional index would have missed.
    expect(pageC.bringToFront).toHaveBeenCalledTimes(1);
    expect(pageB.bringToFront).not.toHaveBeenCalled();
    expect(sm.getPageForSession('sess')).toBe(pageC);
  });

  it('selects a tab via the legacy index path (compat)', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const ctx = createMockContext([pageA, pageB]);
    const handle = setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'select', index: 1 }, spies));

    expect(pageB.bringToFront).toHaveBeenCalledTimes(1);
    expect(pageB.evaluate).toHaveBeenCalledWith('1');
    expect(handle.setActivePage).toHaveBeenCalledWith(pageB);
    expect(handle.page).toBe(pageB);
    expect(sm.getPageForSession('sess')).toBe(pageB);

    const states = sentWorkspaces(spies) as Array<{ activeIndex: number }>;
    expect(states[0].activeIndex).toBe(1);
  });

  it('prefers tabId when both tabId and index are supplied', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const ctx = createMockContext([pageA, pageB]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));
    const [state] = sentWorkspaces(spies) as Array<{ tabs: Array<{ id: string; url: string }> }>;
    const idA = state.tabs.find(t => t.url === 'https://a.example/')!.id;

    // index 1 names B, but tabId names A — tabId must win.
    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'select', tabId: idA, index: 1 }, spies));

    expect(pageA.bringToFront).toHaveBeenCalledTimes(1);
    expect(pageB.bringToFront).not.toHaveBeenCalled();
  });

  it('rejects select without tabId or index', async () => {
    const pageA = createMockPage();
    const ctx = createMockContext([pageA]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'select' }, spies));
    expect(sentErrors(spies)[0].message).toMatch(/requires a tabId/);
  });

  it('rejects select with an out-of-range legacy index', async () => {
    const pageA = createMockPage();
    const ctx = createMockContext([pageA]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'select', index: 5 }, spies));
    expect(sentErrors(spies)[0].message).toMatch(/Invalid tab index: 5/);
  });

  // ── workspace_tab close ───────────────────────────────────────────

  it('closes by tabId after an earlier queued close shifted indices', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pageC = createMockPage({ url: 'https://c.example/' });
    const pages: Page[] = [pageA, pageB, pageC];
    const ctx = createMockContext(pages);
    for (const p of [pageA, pageB, pageC]) makeCloseRemovePage(p, pages);
    const handle = setManagedResolver('sess', pageA, ctx);

    // Learn ids.
    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));
    const [state] = sentWorkspaces(spies) as Array<{ tabs: Array<{ id: string; url: string }> }>;
    const idA = state.tabs.find(t => t.url === 'https://a.example/')!.id;
    const idC = state.tabs.find(t => t.url === 'https://c.example/')!.id;

    // Viewer closes A (queued first), then closes C. C's index shifted 2 → 1
    // after A's close, but the tabId still names C exactly.
    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close', tabId: idA }, spies));
    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close', tabId: idC }, spies));

    expect(pageA.close).toHaveBeenCalledTimes(1);
    expect(pageC.close).toHaveBeenCalledTimes(1);
    expect(pageB.close).not.toHaveBeenCalled();
    expect(pages).toEqual([pageB]);
    expect(handle.page).toBe(pageB);
  });

  it('rejects a stale tabId instead of closing whatever shifted into place', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pages: Page[] = [pageA, pageB];
    const ctx = createMockContext(pages);
    makeCloseRemovePage(pageA, pages);
    makeCloseRemovePage(pageB, pages);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_request' }, spies));
    const [state] = sentWorkspaces(spies) as Array<{ tabs: Array<{ id: string; url: string }> }>;
    const idB = state.tabs.find(t => t.url === 'https://b.example/')!.id;

    // B is closed out-of-band; the viewer's stale close(tabId B) must NOT
    // fall through to B's new positional occupant (A).
    pages.splice(pages.indexOf(pageB), 1);
    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close', tabId: idB }, spies));

    expect(pageA.close).not.toHaveBeenCalled();
    expect(sentErrors(spies)[0].message).toMatch(/no longer exists/);
  });

  it('closes the active tab and rebinds to the neighbor (index-less shorthand)', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pages: Page[] = [pageA, pageB];
    const ctx = createMockContext(pages);
    makeCloseRemovePage(pageA, pages);
    makeCloseRemovePage(pageB, pages);
    const handle = setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close' }, spies));

    expect(pageA.close).toHaveBeenCalledTimes(1);
    expect(pageB.close).not.toHaveBeenCalled();
    expect(handle.page).toBe(pageB);
    expect(sm.getPageForSession('sess')).toBe(pageB);

    const states = sentWorkspaces(spies) as Array<{ tabs: Array<{ url: string }>; activeIndex: number }>;
    expect(states[0].tabs).toEqual([{ id: expect.any(String), index: 0, url: 'https://b.example/', title: 'Mock Title' }]);
    expect(states[0].activeIndex).toBe(0);
  });

  it('closes a background tab by legacy index without changing the active page', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pages: Page[] = [pageA, pageB];
    const ctx = createMockContext(pages);
    makeCloseRemovePage(pageA, pages);
    makeCloseRemovePage(pageB, pages);
    const handle = setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close', index: 1 }, spies));

    expect(pageB.close).toHaveBeenCalledTimes(1);
    expect(pageA.close).not.toHaveBeenCalled();
    expect(handle.page).toBe(pageA);
  });

  it('refuses to close the last remaining tab', async () => {
    const pageA = createMockPage();
    const ctx = createMockContext([pageA]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close', index: 0 }, spies));

    expect(pageA.close).not.toHaveBeenCalled();
    expect(sentErrors(spies)[0].message).toMatch(/last remaining tab/);
  });

  it('rejects tab mutations on read-only sessions', async () => {
    const page = createMockPage();
    setManagedResolver('cdp-sess', page, null);

    await controller.dispatch(makeCtx('cdp-sess', { type: 'workspace_tab', action: 'new' }, spies));
    expect(sentErrors(spies)[0].message).toMatch(/external browser/);
  });

  it('rejects an invalid tab action', async () => {
    const pageA = createMockPage();
    const ctx = createMockContext([pageA]);
    setManagedResolver('sess', pageA, ctx);

    await controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'pin' as 'new' }, spies));
    expect(sentErrors(spies)[0].message).toMatch(/Invalid tab action/);
  });

  // ── pushState ─────────────────────────────────────────────────────

  it('pushState sends state via the supplied (trusted-targeting) channel', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const ctx = createMockContext([pageA, pageB]);
    const handle = setManagedResolver('sess', pageB, ctx);

    const send = vi.fn();
    await controller.pushState('sess', send);

    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][1] as { type: string; activeIndex?: number };
    expect(msg.type).toBe('workspace_state');
    expect(msg.activeIndex).toBe(1);
    expect(handle).toBeDefined();
  });

  // ── mutation serialization (overlapping viewers) ──────────────────

  it('serializes concurrent closes so the last-tab invariant holds', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pages: Page[] = [pageA, pageB];
    const ctx = createMockContext(pages);
    makeCloseRemovePage(pageA, pages);
    makeCloseRemovePage(pageB, pages);
    const handle = setManagedResolver('sess', pageA, ctx);

    // Two viewers race close-active-tab on a two-tab session.
    await Promise.allSettled([
      controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close' }, spies, 'viewer-1')),
      controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close' }, spies, 'viewer-2')),
    ]);

    // Exactly one tab closed; the session still owns a live active page.
    expect(pageA.close).toHaveBeenCalledTimes(1);
    expect(pageB.close).not.toHaveBeenCalled();
    expect(pages).toHaveLength(1);
    expect(handle.page).toBe(pageB);

    // The losing viewer got a clear workspace_error, not a pageless session.
    const errors = sentErrors(spies);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/last remaining tab/);
  });

  it('keeps the active page live when select races close on the same target', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pages: Page[] = [pageA, pageB];
    const ctx = createMockContext(pages);
    makeCloseRemovePage(pageA, pages);
    makeCloseRemovePage(pageB, pages);
    const handle = setManagedResolver('sess', pageA, ctx);

    await Promise.allSettled([
      controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'select', index: 1 }, spies, 'viewer-1')),
      controller.dispatch(makeCtx('sess', { type: 'workspace_tab', action: 'close', index: 1 }, spies, 'viewer-2')),
    ]);

    // Whatever the interleaving, the session's active page must be one of
    // the remaining live tabs (never a closed page, never none).
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages).toContain(handle.page);
    expect(handle.page.close).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WSServer integration (message routing, trust gating, targeted sends)
// ---------------------------------------------------------------------------

describe('WSServer workspace message wiring', () => {
  let server: WSServer;
  let sm: SessionManager;
  const sessionId = 'wiring-sess';
  const clientId = 'wiring-client';

  function makeClient(id: string): { send: ReturnType<typeof vi.fn> } {
    const send = vi.fn();
    sm.addClient({
      id,
      sessionId,
      ws: { send, close: vi.fn(), on: vi.fn() } as unknown as import('../../src/ws/session-manager.js').WSLike,
    });
    // quickBind avoids triggering screencast start (no CDP mock needed)
    sm.quickBind(id, sessionId);
    return { send };
  }

  function registerSessionAndClient(page: Page, id = clientId): { send: ReturnType<typeof vi.fn> } {
    server.registerSession(sessionId, page);
    return makeClient(id);
  }

  function socketMessages(send: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
    return send.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string)) as Array<Record<string, unknown>>;
  }

  beforeEach(() => {
    server = new WSServer({ port: 0 });
    sm = (server as unknown as { sessionManager: SessionManager }).sessionManager;
  });

  afterEach(() => {
    server.unregisterSession(sessionId);
  });

  it('routes workspace_request through handleInboundMessage and replies on the client socket', async () => {
    const page = createMockPage({ url: 'https://live.example/', title: 'Live' });
    const { send } = registerSessionAndClient(page);

    await server['handleInboundMessage'](clientId, { type: 'workspace_request' });

    const state = socketMessages(send).find(m => m.type === 'workspace_state') as {
      sessionId: string; tabs: Array<{ id: string; url: string; title: string }>; activeIndex: number; readOnly?: boolean;
    } | undefined;
    expect(state).toBeDefined();
    expect(state!.sessionId).toBe(sessionId);
    expect(state!.tabs).toEqual([{ id: expect.any(String), index: 0, url: 'https://live.example/', title: 'Live' }]);
    expect(state!.activeIndex).toBe(0);
    // Standalone (no resolver) → read-only single page fallback
    expect(state!.readOnly).toBe(true);
  });

  it('rejects workspace_navigate over the socket for read-only sessions', async () => {
    const page = createMockPage({ url: 'https://live.example/' });
    const { send } = registerSessionAndClient(page);

    await server['handleInboundMessage'](clientId, { type: 'workspace_navigate', url: 'https://evil.example/' });

    const error = socketMessages(send).find(m => m.type === 'workspace_error') as { message?: string } | undefined;
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/external browser|read-only/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('honors setWorkspaceSessionResolver for managed sessions over the socket', async () => {
    const page = createMockPage({ url: 'https://managed.example/' });
    const ctx = createMockContext([page]);
    server.setWorkspaceSessionResolver((sid) =>
      sid === sessionId ? { page, context: ctx, managed: true } : undefined,
    );
    const { send } = registerSessionAndClient(page);

    await server['handleInboundMessage'](clientId, { type: 'workspace_navigate', url: 'https://next.example/' });

    expect(page.goto).toHaveBeenCalledWith('https://next.example/', expect.anything());
    const state = socketMessages(send).find(m => m.type === 'workspace_state') as { readOnly?: boolean } | undefined;
    expect(state).toBeDefined();
    expect(state!.readOnly).toBeUndefined();
  });

  it('pushes workspace_state to trusted clients when the session page switches out-of-band', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const { send } = registerSessionAndClient(pageA);

    sm.emit('page-switched', sessionId, pageB);
    // pushState is fire-and-forget — let the microtask queue drain
    await new Promise(r => setImmediate(r));

    const states = socketMessages(send).filter(m => m.type === 'workspace_state');
    expect(states).toHaveLength(1);
  });

  // ── trust boundary gating (workspace messages only) ───────────────

  it('rejects workspace messages from non-loopback peers without touching the session', async () => {
    const page = createMockPage({ url: 'https://live.example/' });
    const { send } = registerSessionAndClient(page);
    sm.getClient(clientId)!.peer = { remoteAddress: '10.0.0.5' };

    await server['handleInboundMessage'](clientId, { type: 'workspace_request' });

    const messages = socketMessages(send);
    expect(messages.find(m => m.type === 'workspace_state')).toBeUndefined();
    const error = messages.find(m => m.type === 'workspace_error') as { message?: string };
    expect(error?.message).toMatch(/not loopback/);
    expect(page.title).not.toHaveBeenCalled();
  });

  it('rejects workspace mutations from loopback peers with a foreign Origin', async () => {
    const page = createMockPage({ url: 'https://live.example/' });
    const { send } = registerSessionAndClient(page);
    sm.getClient(clientId)!.peer = { remoteAddress: '127.0.0.1', origin: 'https://evil.example' };

    await server['handleInboundMessage'](clientId, { type: 'workspace_navigate', url: 'https://next.example/' });

    expect(page.goto).not.toHaveBeenCalled();
    const error = socketMessages(send).find(m => m.type === 'workspace_error') as { message?: string };
    expect(error?.message).toMatch(/local Viewer origin/);
  });

  it('still routes legacy preview input from non-loopback peers (protocol unchanged)', async () => {
    const page = createMockPage({ url: 'https://live.example/' });
    registerSessionAndClient(page);
    sm.getClient(clientId)!.peer = { remoteAddress: '10.0.0.5' };

    await expect(
      server['handleInboundMessage'](clientId, { type: 'click', x: 10, y: 20 }),
    ).resolves.toBeUndefined();
    expect(page.mouse.click).toHaveBeenCalledWith(10, 20, { button: 'left' });
  });

  // ── workspace_state never reaches untrusted session clients ───────

  it('does not leak workspace_request state to an untrusted client bound to the same session', async () => {
    const page = createMockPage({ url: 'https://managed.example/' });
    const ctx = createMockContext([page]);
    server.setWorkspaceSessionResolver((sid) =>
      sid === sessionId ? { page, context: ctx, managed: true } : undefined,
    );
    const trusted = registerSessionAndClient(page, 'trusted-client');
    const lan = makeClient('lan-client');
    sm.getClient('lan-client')!.peer = { remoteAddress: '192.168.1.77' };

    await server['handleInboundMessage']('trusted-client', { type: 'workspace_request' });

    // Requester (trusted) got the tab list; the LAN-bound legacy client got nothing.
    expect(socketMessages(trusted.send).some(m => m.type === 'workspace_state')).toBe(true);
    expect(socketMessages(lan.send).length).toBe(0);
  });

  it('does not leak mutation state or page-switch pushes to an untrusted session client', async () => {
    const pageA = createMockPage({ url: 'https://a.example/' });
    const pageB = createMockPage({ url: 'https://b.example/' });
    const pages: Page[] = [pageA, pageB];
    const ctx = createMockContext(pages);
    server.setWorkspaceSessionResolver((sid) =>
      sid === sessionId ? { page: pageA, context: ctx, managed: true } : undefined,
    );
    const trusted = registerSessionAndClient(pageA, 'trusted-client');
    const lan = makeClient('lan-client');
    sm.getClient('lan-client')!.peer = { remoteAddress: '192.168.1.77' };

    // Mutation from the trusted viewer.
    await server['handleInboundMessage']('trusted-client', { type: 'workspace_navigate', url: 'https://next.example/' });
    // Out-of-band page switch push.
    sm.emit('page-switched', sessionId, pageB);
    await new Promise(r => setImmediate(r));

    expect(socketMessages(trusted.send).filter(m => m.type === 'workspace_state').length).toBeGreaterThanOrEqual(2);
    // The LAN client may see the legacy `navigation` broadcast (frames/URL of
    // the active tab were already visible to it) but NEVER workspace_state.
    expect(socketMessages(lan.send).some(m => m.type === 'workspace_state')).toBe(false);
  });
});
