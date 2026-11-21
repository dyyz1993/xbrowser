import type { Page, BrowserContext } from '../browser-shim.js';
import { randomUUID } from 'node:crypto';
import type { WSMessage } from '../websocket-server.js';
import type { SessionManager } from './session-manager.js';

// ---------------------------------------------------------------------------
// Viewer browser-workspace message contract (Codex-style browser panel)
//
// Inbound (client → server):
//   workspace_request                          — pull current tab state
//   workspace_navigate   { url }               — navigate the active tab
//   workspace_history    { action: back|forward|reload }
//   workspace_tab        { action: new|select|close, tabId?, index? }
//                         select/close target: tabId (stable opaque ID from
//                         workspace_state.tabs[].id, preferred — immune to
//                         index shifts) or index (legacy fallback)
//
// Outbound (server → client):
//   workspace_state { sessionId, tabs:[{id,index,url,title?}], activeIndex,
//                     readOnly?, handoffWaiting? }
//   workspace_error { message }
//   workspace_state is only ever sent to the requesting client or to the
//   session's TRUSTED clients (loopback/Viewer origin) — never broadcast to
//   legacy LAN clients bound to the same session.
//
// Security posture:
// - All operations act on the client's BOUND session only (no page stealing).
// - Mutations (navigate/history/tab) require a self-launched (managed)
//   session: one whose browser xbrowser itself launched. Sessions attached to
//   an external browser (CDP attach / chrome-bridge) get a read-only
//   single-page `workspace_state`; mutations fail clearly via `workspace_error`.
// - Navigation URLs must be http(s) (or exactly `about:blank`); javascript:,
//   file:, data:, chrome: schemes are rejected before touching the page.
// - Every page call goes through the session's existing XBPage — the CDP
//   Guard rule engine on the driver connection filters the outbound protocol
//   commands. No new CDP connections are opened here.
// ---------------------------------------------------------------------------

/** One tab entry in a `workspace_state` payload. */
export interface WorkspaceTabInfo {
  /** Stable opaque tab ID — echo it back in `workspace_tab` tabId. */
  id: string;
  index: number;
  url: string;
  title?: string;
}

/** Outbound workspace state message (also part of WSMessage union). */
export interface WorkspaceStateMessage {
  type: 'workspace_state';
  sessionId: string;
  tabs: WorkspaceTabInfo[];
  activeIndex: number;
  /**
   * `true` when this session is externally owned (CDP attach / chrome-bridge
   * or standalone fallback) — controls are read-only and the panel should
   * disable navigate/history/tab UI.
   */
  readOnly?: boolean;
  /**
   * `true` while a `waitForHuman` handoff (captcha / manual intervention)
   * is waiting on this session — lets late-connecting or reconnecting
   * viewers pick up the waiting state. Absent when no wait is in flight.
   */
  handoffWaiting?: boolean;
}

/** Outbound workspace error message (also part of WSMessage union). */
export interface WorkspaceErrorMessage {
  type: 'workspace_error';
  message: string;
}

/**
 * Session handle the host (daemon) supplies so the controller can tell
 * self-launched sessions from externally-owned ones and rebind the active
 * page after tab operations.
 */
export interface WorkspaceSessionHandle {
  /** The session's currently active page (source of truth = ManagedSession). */
  page: Page;
  /**
   * Browser context when xbrowser owns the browser (self-launched session).
   * `null` for externally-owned sessions (CDP attach / chrome-bridge) —
   * those are read-only for workspace controls.
   */
  context: BrowserContext | null;
  /** Whether navigation / history / tab mutations are allowed. */
  managed: boolean;
  /**
   * Rebind the session's active page after a tab switch/close/new so the
   * executor, recorder, and viewer stay coherent (lifecycle helper from
   * browser.ts `setActivePage`).
   */
  setActivePage?(page: Page): void;
}

/** Host-supplied lookup: WS sessionId → session handle. */
export type WorkspaceSessionResolver = (sessionId: string) => WorkspaceSessionHandle | undefined;

/** Host-supplied probe: is a waitForHuman handoff waiting on this session? */
export type WorkspaceHandoffProbe = (sessionId: string) => boolean;

// ---------------------------------------------------------------------------
// Trust boundary (workspace messages only — legacy preview protocol untouched)
// ---------------------------------------------------------------------------

/**
 * Transport metadata for a connected WS client, captured from the HTTP
 * upgrade request. `undefined` fields mean the info was not supplied
 * (programmatic clients, tests) and are NOT treated as trust failures.
 */
export interface WorkspacePeer {
  remoteAddress?: string;
  origin?: string;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Defensive trust check for workspace control messages.
 *
 * Policy: workspace navigation/tab mutations are local-Viewer-only.
 * - The transport peer must be loopback when its address is known. Proxy
 *   headers (x-forwarded-for etc.) are deliberately ignored — no proxy trust.
 * - When an Origin is supplied, it must be the loopback Viewer origin on the
 *   same port the Viewer/WS is served from. A missing Origin from a
 *   loopback/programmatic client is allowed.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }` mapping to a
 * `workspace_error` reply. This check gates ONLY the workspace_* messages;
 * legacy preview input (click/fill/…) keeps its existing behavior.
 */
export function checkWorkspaceTrust(
  peer: WorkspacePeer | undefined,
  viewerPort: number,
): { ok: true } | { ok: false; reason: string } {
  if (!peer) return { ok: true }; // programmatic client without transport metadata
  const { remoteAddress, origin } = peer;

  if (remoteAddress !== undefined && remoteAddress !== '' && !LOOPBACK_ADDRESSES.has(remoteAddress)) {
    return { ok: false, reason: `Workspace controls are restricted to local viewers (peer ${remoteAddress} is not loopback).` };
  }

  if (origin !== undefined && origin !== '') {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return { ok: false, reason: `Invalid Origin for workspace controls: ${origin}` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: `Unsupported Origin protocol for workspace controls: ${parsed.protocol}` };
    }
    if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
      return { ok: false, reason: `Workspace controls are restricted to the local Viewer origin (got ${origin}).` };
    }
    const originPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (viewerPort > 0 && originPort !== String(viewerPort)) {
      return { ok: false, reason: `Workspace controls accept the local Viewer origin only (origin port ${originPort} != viewer port ${viewerPort}).` };
    }
  }

  return { ok: true };
}

/** Inbound workspace messages (also part of the WSInboundMessage union). */
export type WorkspaceInboundMessage =
  | { type: 'workspace_request' }
  | { type: 'workspace_navigate'; url: string }
  | { type: 'workspace_history'; action: 'back' | 'forward' | 'reload' }
  | {
      type: 'workspace_tab';
      action: 'new' | 'select' | 'close';
      /** Preferred target: stable opaque tab ID from workspace_state.tabs[].id. */
      tabId?: string;
      /** Legacy fallback: positional index into the current tab list. */
      index?: number;
    };

/** Context passed to WorkspaceController.dispatch for each inbound message. */
export interface WorkspaceContext {
  clientId: string;
  sessionId: string | undefined;
  message: WorkspaceInboundMessage;
  sendToClient(clientId: string, message: WSMessage): void;
  /**
   * Sends a workspace message to the session's TRUSTED clients only
   * (loopback/Viewer-origin per checkWorkspaceTrust). Tab titles/URLs must
   * never be broadcast to legacy LAN clients bound to the same session.
   */
  sendToTrustedSessionClients(sessionId: string, message: WSMessage): void;
  /** Legacy broadcast — NOT used for workspace_state (trust filtering). */
  broadcastToSession(sessionId: string, message: WSMessage): void;
}

/** Internal error that maps 1:1 to a `workspace_error` reply. */
class WorkspaceError extends Error {}

const NAVIGATE_TIMEOUT_MS = 15000;
const HISTORY_TIMEOUT_MS = 15000;

/**
 * Validates a navigation URL from an untrusted WS client.
 * Only absolute http(s) URLs and exactly `about:blank` (the safe initial
 * blank page) are allowed; everything else is rejected before any page call.
 */
export function assertSafeNavigationUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new WorkspaceError('Navigation URL is empty');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WorkspaceError(`Invalid URL: ${trimmed}`);
  }
  if (parsed.protocol === 'about:') {
    if (parsed.href === 'about:blank') return 'about:blank';
    throw new WorkspaceError(`Unsupported URL scheme: ${parsed.protocol} (only about:blank is allowed)`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WorkspaceError(`Unsupported URL scheme: ${parsed.protocol} (only http/https/about:blank are allowed)`);
  }
  return parsed.href;
}

/** Internal resolved session for one dispatch. */
interface ResolvedSession {
  sessionId: string;
  handle: WorkspaceSessionHandle;
}

export class WorkspaceController {
  private resolver: WorkspaceSessionResolver | undefined;
  private handoffProbe: WorkspaceHandoffProbe | undefined;

  /**
   * Stable opaque IDs per tab. Keyed by the XBPage instance — the CDP
   * driver's `context.pages()` returns the same wrapper objects on every
   * call, so identity holds across snapshots. IDs die with the page (WeakMap)
   * and with the controller (daemon restart) — clients holding a stale ID
   * get a "tab no longer exists" error and re-pull state.
   */
  private readonly tabIds = new WeakMap<Page, string>();

  private tabIdFor(page: Page): string {
    let id = this.tabIds.get(page);
    if (!id) {
      id = 'tab-' + randomUUID().slice(0, 8);
      this.tabIds.set(page, id);
    }
    return id;
  }

  /**
   * Per-session mutation serialization. Overlapping viewers (or a racing
   * navigate + tab close) must not interleave: two concurrent closes on a
   * two-tab session could both pass the last-tab guard and leave the session
   * pageless, and a stale select index could rebind onto a just-closed page.
   * Every mutation re-snapshots `context.pages()` at its turn, so running
   * them one-at-a-time per session keeps the last-tab invariant and index
   * freshness. Reads (`workspace_request`) stay unserialized.
   */
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(private readonly sessionManager: SessionManager) {}

  /** Host (daemon) injects session ownership lookup. */
  setResolver(resolver: WorkspaceSessionResolver | undefined): void {
    this.resolver = resolver;
  }

  /** Host (daemon) injects the waitForHuman handoff-waiting probe. */
  setHandoffProbe(probe: WorkspaceHandoffProbe | undefined): void {
    this.handoffProbe = probe;
  }

  /** Runs mutations one at a time per session; rejections propagate to caller. */
  private enqueueMutation<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.mutationQueues.get(sessionId) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(task);
    const tail = run.then(() => undefined, () => undefined);
    this.mutationQueues.set(sessionId, tail);
    tail.finally(() => {
      if (this.mutationQueues.get(sessionId) === tail) this.mutationQueues.delete(sessionId);
    }).catch(() => {});
    return run;
  }

  // -----------------------------------------------------------------------
  // Dispatch
  // -----------------------------------------------------------------------

  async dispatch(ctx: WorkspaceContext): Promise<void> {
    try {
      switch (ctx.message.type) {
        case 'workspace_request':
          await this.onRequest(ctx);
          return;
        case 'workspace_navigate':
          await this.onNavigate(ctx);
          return;
        case 'workspace_history':
          await this.onHistory(ctx);
          return;
        case 'workspace_tab':
          await this.onTab(ctx);
          return;
        default:
          this.replyError(ctx, `Unknown workspace message type: ${(ctx.message as { type: string }).type}`);
      }
    } catch (err) {
      if (err instanceof WorkspaceError) {
        this.replyError(ctx, err.message);
        return;
      }
      this.replyError(ctx, err instanceof Error ? err.message : String(err));
    }
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  private async onRequest(ctx: WorkspaceContext): Promise<void> {
    const resolved = this.resolveSession(ctx);
    const state = await this.buildState(resolved);
    // Reply ONLY to the requesting client. The requester already passed the
    // trust gate at the transport layer; broadcasting here would leak tab
    // titles/URLs to untrusted legacy clients bound to the same session.
    ctx.sendToClient(ctx.clientId, state);
  }

  private async onNavigate(ctx: WorkspaceContext): Promise<void> {
    if (!ctx.sessionId) {
      throw new WorkspaceError('Not bound to a session. Connect via /preview/<sessionId> or send {"type":"bind"} first.');
    }
    await this.enqueueMutation(ctx.sessionId, async () => {
      const msg = ctx.message as { type: 'workspace_navigate'; url: string };
      const resolved = this.resolveSession(ctx);
      this.requireManaged(resolved);

      const url = assertSafeNavigationUrl(typeof msg.url === 'string' ? msg.url : '');

      // Reuse the session's bound page — the goto call flows through the
      // driver connection where the CDP Guard rule engine evaluates it.
      await resolved.handle.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS });

      ctx.sendToTrustedSessionClients(resolved.sessionId, await this.buildState(resolved));
    });
  }

  private async onHistory(ctx: WorkspaceContext): Promise<void> {
    if (!ctx.sessionId) {
      throw new WorkspaceError('Not bound to a session. Connect via /preview/<sessionId> or send {"type":"bind"} first.');
    }
    await this.enqueueMutation(ctx.sessionId, async () => {
      const msg = ctx.message as { type: 'workspace_history'; action: string };
      const resolved = this.resolveSession(ctx);
      this.requireManaged(resolved);

      const action = msg.action;
      const page = resolved.handle.page;
      if (action === 'back') {
        await page.goBack({ timeout: HISTORY_TIMEOUT_MS });
      } else if (action === 'forward') {
        await page.goForward({ timeout: HISTORY_TIMEOUT_MS });
      } else if (action === 'reload') {
        await page.reload({ timeout: HISTORY_TIMEOUT_MS });
      } else {
        throw new WorkspaceError(`Invalid history action: ${String(action)} (expected back | forward | reload)`);
      }

      ctx.sendToTrustedSessionClients(resolved.sessionId, await this.buildState(resolved));
    });
  }

  private async onTab(ctx: WorkspaceContext): Promise<void> {
    if (!ctx.sessionId) {
      throw new WorkspaceError('Not bound to a session. Connect via /preview/<sessionId> or send {"type":"bind"} first.');
    }
    await this.enqueueMutation(ctx.sessionId, async () => {
      const msg = ctx.message as { type: 'workspace_tab'; action: string; tabId?: string; index?: number };
      const resolved = this.resolveSession(ctx);
      this.requireManaged(resolved);
      const context = resolved.handle.context;
      if (!context) {
        throw new WorkspaceError('Session has no owned browser context; workspace tab controls are unavailable');
      }

      switch (msg.action) {
        case 'new':
          await this.tabNew(ctx, resolved, context);
          return;
        case 'select':
          await this.tabSelect(ctx, resolved, context, msg);
          return;
        case 'close':
          await this.tabClose(ctx, resolved, context, msg);
          return;
        default:
          throw new WorkspaceError(`Invalid tab action: ${String(msg.action)} (expected new | select | close)`);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Tab operations (mirror src/commands/tab.ts semantics)
  // -----------------------------------------------------------------------

  private async tabNew(
    ctx: WorkspaceContext,
    resolved: ResolvedSession,
    context: BrowserContext,
  ): Promise<void> {
    // newPage() lands on about:blank — the safe initial blank page. An
    // explicit goto('about:blank') is not required; a brand-new tab is
    // already blank, and failing to force it is not fatal.
    const newPage = await context.newPage();

    this.rebindActivePage(resolved, newPage);
    ctx.sendToTrustedSessionClients(resolved.sessionId, await this.buildState(resolved));
  }

  /**
   * Resolves the target page for select/close.
   *
   * `tabId` (stable opaque ID from workspace_state) is the preferred path:
   * it names the exact tab regardless of index shifts caused by earlier
   * queued closes, and a stale ID (tab already closed) is rejected instead
   * of silently acting on whatever now sits at that position. `index` is
   * the legacy fallback resolved against the CURRENT snapshot (kept for
   * mock/test clients). If both are supplied, tabId wins.
   */
  private resolveTabTarget(
    pages: Page[],
    activePage: Page,
    action: 'select' | 'close',
    msg: { tabId?: string; index?: number },
  ): Page {
    const tabId = typeof msg.tabId === 'string' ? msg.tabId.trim() : '';
    if (tabId) {
      const target = pages.find(pg => this.tabIds.get(pg) === tabId);
      if (!target) {
        throw new WorkspaceError(
          `Tab ${tabId} no longer exists (it may have been closed). Send workspace_request to refresh the tab list.`,
        );
      }
      return target;
    }
    if (typeof msg.index === 'number') {
      if (!Number.isInteger(msg.index) || msg.index < 0 || msg.index >= pages.length) {
        throw new WorkspaceError(`Invalid tab index: ${String(msg.index)}. Valid range: 0-${Math.max(0, pages.length - 1)}`);
      }
      return pages[msg.index];
    }
    if (action === 'close') return activePage; // close-the-active-tab shorthand
    throw new WorkspaceError('workspace_tab select requires a tabId (preferred) or an integer index');
  }

  private async tabSelect(
    ctx: WorkspaceContext,
    resolved: ResolvedSession,
    context: BrowserContext,
    msg: { tabId?: string; index?: number },
  ): Promise<void> {
    // Refresh the pages snapshot right before selecting so concurrent tab
    // changes don't resolve a stale index (same rule as `tab switch`).
    const pages = context.pages();
    const targetPage = this.resolveTabTarget(pages, resolved.handle.page, 'select', msg);
    await targetPage.bringToFront().catch(() => { /* headless targets may reject; not fatal */ });

    // Warm up the wrapper before rebinding: freshly-created tabs can
    // transiently fail evaluate, and the first Input dispatch can be slow
    // until the tab's input agent activates (see `tab switch` notes).
    for (let i = 0; i < 5; i++) {
      const okProbe = await targetPage.evaluate('1').then(() => true, () => false);
      if (okProbe) break;
      await new Promise(r => setTimeout(r, 300));
    }
    try {
      const mouse = (targetPage as unknown as { mouse?: { move: (x: number, y: number) => Promise<void> } }).mouse;
      if (mouse) await mouse.move(1, 1).catch(() => {});
    } catch { /* best-effort input warm-up */ }

    this.rebindActivePage(resolved, targetPage);
    ctx.sendToTrustedSessionClients(resolved.sessionId, await this.buildState(resolved));
  }

  private async tabClose(
    ctx: WorkspaceContext,
    resolved: ResolvedSession,
    context: BrowserContext,
    msg: { tabId?: string; index?: number },
  ): Promise<void> {
    // Refresh pages right before closing so a stale index can't close the
    // wrong tab (same rule as `tab close`).
    const pages = context.pages();

    // Resolve the target FIRST: a named tabId that no longer exists is
    // reported as such even when only one tab remains (accurate diagnostic
    // beats the generic last-tab message).
    const activePage = resolved.handle.page;
    const pageToClose = this.resolveTabTarget(pages, activePage, 'close', msg);

    if (pages.length <= 1) {
      throw new WorkspaceError('Cannot close the last remaining tab');
    }
    const isActivePage = pageToClose === activePage;

    await pageToClose.close();

    const remainingPages = context.pages();
    if (remainingPages.length === 0) {
      throw new WorkspaceError('All tabs closed; the session needs a page');
    }
    if (isActivePage) {
      const closeIndex = pages.indexOf(pageToClose);
      const switchIndex = closeIndex >= 0 && closeIndex < remainingPages.length ? closeIndex : remainingPages.length - 1;
      this.rebindActivePage(resolved, remainingPages[switchIndex]);
    }

    ctx.sendToTrustedSessionClients(resolved.sessionId, await this.buildState(resolved));
  }

  // -----------------------------------------------------------------------
  // State building
  // -----------------------------------------------------------------------

  /**
   * Builds the `workspace_state` payload for a session.
   *
   * - Managed sessions enumerate the full context tab list.
   * - Externally-owned sessions (or standalone mode without a resolver) get
   *   a read-only single-page state describing only the bound page — the
   *   user's other tabs are never enumerated.
   */
  async buildState(resolved: ResolvedSession): Promise<WorkspaceStateMessage> {
    const { sessionId, handle } = resolved;
    const context = handle.context;
    const handoffWaiting = this.handoffProbe?.(sessionId) === true ? { handoffWaiting: true } : {};

    if (!handle.managed || !context) {
      const page = handle.page;
      if (!page) {
        return { type: 'workspace_state', sessionId, tabs: [], activeIndex: -1, readOnly: true, ...handoffWaiting };
      }
      const title = await page.title().catch(() => '');
      return {
        type: 'workspace_state',
        sessionId,
        tabs: [{ id: this.tabIdFor(page), index: 0, url: page.url(), ...(title ? { title } : {}) }],
        activeIndex: 0,
        readOnly: true,
        ...handoffWaiting,
      };
    }

    const pages = context.pages();
    const activePage = handle.page;
    let activeIndex = pages.findIndex(pg => pg === activePage);

    const tabs: WorkspaceTabInfo[] = [];
    for (let i = 0; i < pages.length; i++) {
      const url = pages[i].url();
      const title = await pages[i].title().catch(() => '');
      if (pages[i] === activePage) activeIndex = i;
      tabs.push({ id: this.tabIdFor(pages[i]), index: i, url, ...(title ? { title } : {}) });
    }
    if (activeIndex < 0 && tabs.length > 0) {
      // Active page vanished (closed externally) — report index 0 so the
      // panel still renders; the next tab op re-establishes coherence.
      activeIndex = 0;
    }
    return { type: 'workspace_state', sessionId, tabs, activeIndex, ...handoffWaiting };
  }

  // -----------------------------------------------------------------------
  // Session resolution / guards
  // -----------------------------------------------------------------------

  /**
   * Resolves the client's bound session. Bound session ownership: the client
   * must be bound to a registered session; operations never touch sessions
   * other than the one this client is bound to.
   */
  private resolveSession(ctx: WorkspaceContext): ResolvedSession {
    if (!ctx.sessionId) {
      throw new WorkspaceError('Not bound to a session. Connect via /preview/<sessionId> or send {"type":"bind"} first.');
    }
    const resolved = this.resolveBySessionId(ctx.sessionId);
    if (!resolved) {
      throw new WorkspaceError(`Session "${ctx.sessionId}" not found`);
    }
    return resolved;
  }

  /**
   * SessionId → handle. Prefers the host resolver (daemon, authoritative
   * ManagedSession); falls back to the WS-registered page as a read-only
   * single-page session (standalone viewer without a resolver).
   */
  private resolveBySessionId(sessionId: string): ResolvedSession | undefined {
    const handle = this.resolver?.(sessionId);
    if (handle?.page) {
      return { sessionId, handle };
    }
    const wsPage = this.sessionManager.getPageForSession(sessionId);
    if (wsPage) {
      return { sessionId, handle: { page: wsPage, context: null, managed: false } };
    }
    return undefined;
  }

  /**
   * Pushes a fresh `workspace_state` to the session's viewers via the
   * supplied trusted-targeting send (never the legacy broadcast — tab
   * metadata must not reach untrusted clients). Used by WSServer on
   * `page-switched` so panels stay in sync when the active tab changes
   * out-of-band (e.g. a CLI `tab switch` command).
   */
  async pushState(sessionId: string, send: (sessionId: string, message: WSMessage) => void): Promise<void> {
    const resolved = this.resolveBySessionId(sessionId);
    if (!resolved) return;
    send(sessionId, await this.buildState(resolved));
  }

  private requireManaged(resolved: ResolvedSession): void {
    if (!resolved.handle.managed || !resolved.handle.context) {
      throw new WorkspaceError(
        `Session "${resolved.sessionId}" is attached to an external browser; ` +
        'workspace navigation and tab controls are read-only. Reopen the session as a managed (self-launched) session to control it.',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Active page coherence
  // -----------------------------------------------------------------------

  /**
   * Rebinds the session's active page after a tab switch/new/close using the
   * existing lifecycle helpers:
   * 1. host-side `setActivePage` (browser.ts) updates the ManagedSession,
   * 2. SessionManager re-registration moves the screencast + element monitor
   *    to the new page and emits `page-switched` (viewer follows the tab).
   */
  private rebindActivePage(resolved: ResolvedSession, page: Page): void {
    resolved.handle.setActivePage?.(page);
    // Keep this dispatch's handle coherent with the new active page so the
    // state built right after reports the correct activeIndex.
    resolved.handle.page = page;
    // Re-register through SessionManager.registerSession: same-page is a
    // no-op, different page goes through updateSessionPage (capturer restart
    // + page-switched broadcast).
    this.sessionManager.registerSession(resolved.sessionId, page, undefined);
  }

  // -----------------------------------------------------------------------
  // Replies
  // -----------------------------------------------------------------------

  private replyError(ctx: WorkspaceContext, message: string): void {
    ctx.sendToClient(ctx.clientId, { type: 'workspace_error', message });
  }
}
