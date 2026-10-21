import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from './browser-shim.js';
import { resolveCDPEndpoint } from './utils/cdp.js';
import { launch } from './cdp-driver/index.js';
import { createBrowser, getCDPTargets, getSharedCdpProxy, setSharedCdpProxy } from './browser/connection.js';
import {
  SESSION_DIR,
  type BrowserLaunchOptions,
  type ManagedSession,
  sessionFile,
  sessions,
  sharedState,
} from './browser/state.js';
import { findOrRestoreSession as findOrRestoreSessionImpl } from './browser/restore.js';
import { createSessionImpl } from './browser/create-session.js';
import { registerSession } from './browser/lifecycle.js';
export type { BrowserLaunchOptions, ManagedSession, SessionDiskMeta } from './browser/state.js';
export * from './browser/index.js';

function logSessionEvent(event: string, details: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.error(`[SESSION] ${timestamp} [PID:${process.pid}] ${event} | ${details}`);
}

const IDLE_TIMEOUT_MS = (process.env.XBROWSER_IDLE_TIMEOUT ? parseInt(process.env.XBROWSER_IDLE_TIMEOUT, 10) : 30) * 60 * 1000;
export function resetIdleTimer(): void {
  if (sharedState.idleTimer) clearTimeout(sharedState.idleTimer);
  sharedState.idleTimer = setTimeout(async () => {
    const now = Date.now();
    let allIdle = true;
    const idleSessions: string[] = [];
    for (const s of sessions) {
      if (now - s.lastActivityAt < IDLE_TIMEOUT_MS) {
        allIdle = false;
      } else {
        idleSessions.push(`${s.name}(${(now - s.lastActivityAt) / 1000}s idle)`);
      }
    }
    if (allIdle && (sessions.size > 0 || sharedState.browser)) {
      logSessionEvent('idle_timeout', `Sessions idle for >${IDLE_TIMEOUT_MS / 60000}min. Sessions: ${idleSessions.join(', ') || 'all'}. Calling destroyBrowser()`);
      await destroyBrowser().catch(() => {         });
    }
  }, IDLE_TIMEOUT_MS);
  // unref() so sharedState.idleTimer does not prevent process exit.
  // Daemon mode keeps itself alive via its own setInterval.
  if (sharedState.idleTimer && typeof sharedState.idleTimer.unref === 'function') {
    sharedState.idleTimer.unref();
  }
}

export async function findOrRestoreSession(name: string, cdpEndpoint?: string): Promise<ManagedSession | undefined> {
  return findOrRestoreSessionImpl(
    name,
    cdpEndpoint,
    closeSessionByName,
    installNetworkCapture
  );
}

export function touchSession(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastActivityAt = Date.now();
  resetIdleTimer();
}

process.on('exit', () => {
  for (const session of sessions.list()) {
    if (session.isCDP) {
      logSessionEvent('process_exit', `Session "${session.name}": CDP connection (not closing external browser).`);
    } else {
      logSessionEvent('process_exit', `Session "${session.name}": Closing self-launched browser.`);
      try { session.browser?.close(); } catch { /* force cleanup on exit */ }
    }
  }
  if (sharedState.browser) {
    logSessionEvent('process_exit', 'Closing shared browser (self-launched only, external CDP is safe).');
    try { sharedState.browser.close(); } catch { /* force cleanup on exit */ }
    sharedState.browser = null;
  }
  const cdpProxy = getSharedCdpProxy();
  if (cdpProxy) {
    try { cdpProxy.stop(); } catch { /* best effort */ }
    setSharedCdpProxy(null);
  }
  sessions.clear();
});

/**
 * Get or create the shared browser instance (lazy singleton).
 *
 * Used by non-session callers such as {@link createEphemeralContext} and
 * project-scope commands that don't need per-session isolation.
 *
 * @param options - Launch options including headless mode, executable path, or CDP endpoint.
 * @returns The shared Playwright Browser instance.
 *
 * @example
 * ```ts
 * const browser = await getBrowser({ headless: true });
 * ```
 */
export async function getBrowser(options?: BrowserLaunchOptions): Promise<Browser> {
  if (sharedState.browser) return sharedState.browser;
  sharedState.browser = await createBrowser(options);
  // Track CDP proxy for shared browser cleanup
  if (options?.cdpEndpoint && options.intercept) {
    // Proxy lifecycle is handled by destroyBrowser
  }
  return sharedState.browser;
}

/**
 * Find a managed session by its name.
 *
 * @param name - The session name to search for.
 * @returns The matching session, or `undefined` if not found.
 */
export function findSession(name: string): ManagedSession | undefined {
  return sessions.find(name);
}

export function getSessionById(id: string): ManagedSession | undefined {
  return sessions.get(id);
}

export function setActivePage(session: ManagedSession, page: Page): void {
  session.page = page;
  session.lastActivityAt = Date.now();
}

/**
 * Create an ephemeral (short-lived) BrowserContext for one-off commands.
 *
 * When using CDP, creates a dedicated connection (new client) so that
 * concurrent calls don't interfere with each other. The connection is
 * tracked and disconnected by {@link closeEphemeralContext}.
 *
 * @param options - Browser launch options.
 * @returns The BrowserContext and its default Page.
 */
export async function createEphemeralContext(
  options?: BrowserLaunchOptions,
): Promise<{ context: BrowserContext; page: Page }> {
  if (options?.cdpEndpoint) {
    // CDP mode: create a dedicated connection (new client) for isolation.
    // CDP Tunnel assigns each connectOverCDP a separate clientId.
    const endpoint = await resolveCDPEndpoint(options.cdpEndpoint);
    const { browser: b } = await launch({ cdpEndpoint: endpoint });
    const contexts = b.contexts();
    const ctx = contexts[0] || await b.newContext();

    // Prefer existing pages over creating new ones.
    // A new blank tab (about:blank) won't have the site's JS loaded,
    // and page.goto() on a fresh tab may not render SPAs correctly.
    const allPages = ctx.pages();
    const existingPages = allPages.filter(p => {
      const url = p.url();
      return url !== 'about:blank' && !url.startsWith('chrome://') && !url.startsWith('chrome-untrusted://') && !url.startsWith('chrome-error://');
    });
    const page = existingPages.length > 0
      ? existingPages[0]  // Reuse the user's existing tab
      : allPages.length > 0
        ? allPages[0]  // Use any page (even about:blank) rather than creating new
        : await ctx.newPage();  // Last resort: create new tab

    resetIdleTimer();
    // Store the browser connection so closeEphemeralContext can disconnect it.
    ephemeralConnections.set(page, b);
    return { context: ctx, page };
  }

  // Non-CDP mode: use the shared browser instance.
  const b = await getBrowser(options);
  const context = await b.newContext();
  const page = await context.newPage();
  resetIdleTimer();
  return { context, page };
}

/** Tracks dedicated CDP connections created by createEphemeralContext. */
const ephemeralConnections = new WeakMap<Page, Browser>();

/**
 * Close an ephemeral BrowserContext without destroying the shared Browser.
 *
 * For CDP connections, disconnects the dedicated browser instance (new client)
 * without affecting the user's browser or other clients.
 *
 * Safe to call after one-off commands. Other sessions remain unaffected.
 */
export async function closeEphemeralContext(context: BrowserContext): Promise<void> {
  try {
    // Check if this context has a dedicated CDP connection to disconnect.
    const pages = context.pages();
    for (const p of pages) {
      const conn = ephemeralConnections.get(p);
      if (conn) {
        ephemeralConnections.delete(p);
        // close() on CDP connection only disconnects, does NOT kill remote browser.
        await conn.close();
        break;
      }
    }
    await context.close();
  } catch {
    // ignore close errors
  }

  // If no managed sessions exist, clear the idle timer so the process can exit.
  // Ephemeral commands (scrape/search/map etc.) don't need session lifecycle management.
  if (sessions.size === 0 && sharedState.idleTimer) {
    clearTimeout(sharedState.idleTimer);
    sharedState.idleTimer = null;
  }
}

/**
 * Get all active managed sessions.
 *
 * @returns Array of all active sessions.
 */
export function getAllSessions(): ManagedSession[] {
  return sessions.list();
}

async function installNetworkCapture(page: Page, sessionName: string): Promise<void> {
  if (process.env.XBROWSER_DAEMON_WORKER !== '1') return;

  const { networkStore } = await import('./daemon/network-store.js');

  // Store request data by requestId for later correlation with response events
  const requestData = new Map<string, {
    method: string;
    headers: Record<string, string>;
    postData: string | null;
    resourceType: string;
  }>();

  // Store response metadata by requestId for body fetching on requestfinished
  const responseMeta = new Map<string, {
    status: number;
    url: string;
    headers: Record<string, string>;
    mimeType: string;
    type: string;
  }>();

  // page is already XBPage (browser-shim aliases XBPage as Page)
  const xbPage = page;

  // Capture request data
  xbPage.on('request', (params: unknown) => {
    try {
      const p = params as {
        requestId: string;
        request: { url: string; method: string; headers: Record<string, string>; postData?: string };
        type: string;
      };
      requestData.set(p.requestId, {
        method: p.request.method,
        headers: p.request.headers,
        postData: p.request.postData ?? null,
        resourceType: p.type,
      });
    } catch {
      // ignore
    }
  });

  // Capture response metadata
  xbPage.on('response', (params: unknown) => {
    try {
      const p = params as {
        requestId: string;
        type: string;
        response: {
          status: number;
          url: string;
          headers: Record<string, string>;
          mimeType: string;
        };
      };
      responseMeta.set(p.requestId, {
        status: p.response.status,
        url: p.response.url,
        headers: p.response.headers,
        mimeType: p.response.mimeType,
        type: p.type,
      });
    } catch {
      // ignore
    }
  });

  // On request finished, combine all data and fetch body
  xbPage.on('requestfinished', async (params: unknown) => {
    try {
      const p = params as { requestId: string };
      const meta = responseMeta.get(p.requestId);
      if (!meta) return;

      const req = requestData.get(p.requestId);
      const method = req?.method ?? 'GET';
      const contentType = meta.headers['content-type'] || meta.headers['Content-Type'] || '';
      const resourceType = req?.resourceType ?? meta.type;

      // Capture request headers
      const requestHeaders = req?.headers ?? {};

      // Capture request body for POST/PATCH/PUT with JSON
      let requestBody: unknown = undefined;
      const isPostLike = ['POST', 'PATCH', 'PUT'].includes(method);
      if (isPostLike && requestHeaders['content-type']?.includes('application/json')) {
        const postData = req?.postData;
        if (postData) {
          try {
            requestBody = JSON.parse(postData);
          } catch {
            requestBody = postData;
          }
        }
      }

      let responseBody: unknown = undefined;
      let size = 0;

      const isJsonish =
        contentType.includes('json') ||
        contentType.includes('javascript') ||
        contentType.includes('text/');
      if (isJsonish) {
        try {
          const bodyResult = await xbPage._cdpSend<{ body?: string; base64Encoded?: boolean }>(
            'Network.getResponseBody',
            { requestId: p.requestId },
          );
          const text = bodyResult.body ?? '';
          size = text.length;
          if (size <= 10240) {
            try {
              responseBody = JSON.parse(text);
            } catch {
              responseBody = text.slice(0, 200);
            }
          }
        } catch {
          // body may not be available
        }
      } else {
        try {
          const bodyResult = await xbPage._cdpSend<{ body?: string; base64Encoded?: boolean }>(
            'Network.getResponseBody',
            { requestId: p.requestId },
          );
          size = bodyResult.body?.length ?? 0;
        } catch {
          size = 0;
        }
      }

      networkStore.add(sessionName, {
        timestamp: Date.now(),
        method,
        url: meta.url,
        path: new URL(meta.url).pathname,
        status: meta.status,
        contentType,
        size,
        headers: meta.headers,
        body: responseBody,
        requestHeaders,
        requestBody,
        resourceType,
      });

      // Cleanup
      requestData.delete(p.requestId);
      responseMeta.delete(p.requestId);
    } catch {
      // Silently ignore capture errors
    }
  });
}

export async function createSession(
  name: string,
  url?: string,
  options?: BrowserLaunchOptions
): Promise<ManagedSession> {
  return createSessionImpl(name, url, options, {
    closeSessionByName,
    installNetworkCapture,
    registerSession,
    logSessionEvent,
    getCDPTargets,
  });
}

/**
 * Close a session by its name or ID.
 *
 * @param name - Session name or UUID to close.
 * @returns `true` if a session was found and closed, `false` otherwise.
 */
export async function closeSessionByName(name: string): Promise<boolean> {
  for (const session of sessions) {
    if (session.name === name || session.id === name) {
      logSessionEvent('close_session', `name="${session.name}" id="${session.id}" url="${session.page.url()}"`);
      if (session.isCDP) {
        if (session.reusedExistingPage) {
          // Attached to an existing user tab: only hang up the CDP WebSocket.
          // Closing the page/context here could delete the user's workspace.
          logSessionEvent('close_session', `name="${session.name}" — reused existing tab, disconnecting only`);
          await session.browser.disconnect().catch(() => {});
        } else {
          // xbrowser created this tab; close it, then disconnect the connection
          // without touching the external browser or other user tabs.
          await session.page.close().catch(() => {});
          await session.browser.disconnect().catch(() => {});
        }
      } else {
        // Non-CDP mode (self-launched browser): close context + browser.
        // browser.close() kills the self-launched Chrome process.
        await session.context.close();
        if (session.browser) {
          await session.browser.close().catch(() => {});
        }
      }
      sessions.removeById(session.id);

      // Always clean up disk metadata
      const file = sessionFile(session.name);
      try { unlinkSync(file); } catch { /* file may not exist */ }

      // Clear associated network captures from memory
      try {
        const { networkStore, commandLogStore } = await import('./daemon/network-store.js');
        networkStore.clear(session.name);
        commandLogStore.clear(session.name);
      } catch { /* stores may not be loaded */ }

      // Clean up session recordings
      try {
        const { SessionRecorder } = await import('./recorder/session-recorder.js');
        SessionRecorder.cleanup(session.name);
      } catch { /* recorder module may not be loaded */ }

      return true;
    }
  }

  // Session not in memory — try cleaning disk metadata directly
  const file = sessionFile(name);
  try { unlinkSync(file); } catch { /* file may not exist */ }

  return false;
}

/**
 * Close all active browser sessions.
 *
 * Closes every managed context and its dedicated browser connection,
 * ignoring individual close errors.
 */
export async function closeAllSessions(): Promise<void> {
  const names = sessions.list().map(s => `${s.name}(${s.page.url()})`).join(', ');
  if (names) logSessionEvent('close_all_sessions', `Closing ${sessions.size} sessions: ${names}`);
  for (const session of sessions.list()) {
    try {
      if (session.isCDP) {
        // CDP mode: do NOT close page or context. Only disconnect WebSocket.
        // The user's tabs and login state must be preserved.
        if (session.browser) {
          await session.browser.close().catch(() => {});
        }
      } else {
        // Non-CDP (self-launched): close context + browser (killChrome if owned).
        await session.context.close();
        if (session.browser) {
          await session.browser.close().catch(() => {});
        }
      }
      sessions.removeById(session.id);
    } catch {
      sessions.removeById(session.id);
    }
  }
}

/**
 * Close all sessions and destroy all browser instances.
 *
 * After calling this, the module returns to a clean state and
 * {@link getBrowser} will create a new instance on next call.
 */
export async function destroyBrowser(): Promise<void> {
  logSessionEvent('destroy_browser', `Sessions count: ${sessions.size}. Clearing idle timer and closing all sessions.`);
  if (sharedState.idleTimer) {
    clearTimeout(sharedState.idleTimer);
    sharedState.idleTimer = null;
  }
  await closeAllSessions();
  if (sharedState.browser) {
    // close() internally checks childProcess:
    //   - self-launched → kills Chrome (cleanup)
    //   - external CDP   → only disconnects WebSocket
    await sharedState.browser.close().catch(() => {});
    sharedState.browser = null;
  }
  if (getSharedCdpProxy()) {
    await getSharedCdpProxy()!.stop().catch(() => {});
    setSharedCdpProxy(null);
  }
}

/**
 * Reset all internal state for testing purposes.
 *
 * Clears the session map and drops the browser reference without
 * closing anything. Intended for use in test teardown.
 */
export function resetForTesting(): void {
  sessions.clear();
  sharedState.browser = null;
  sharedState.idleTimer = null;
  setSharedCdpProxy(null);
  try {
    for (const file of readdirSync(SESSION_DIR)) unlinkSync(join(SESSION_DIR, file));
  } catch { /* dir may not exist */ }
}

/**
 * Force cleanup and ensure the process can exit.
 * Call this before process.exit() to release all Playwright resources.
 */
export async function ensureProcessCanExit(): Promise<void> {
  if (sharedState.idleTimer) {
    clearTimeout(sharedState.idleTimer);
    sharedState.idleTimer = null;
  }

  // Close self-launched browsers; external CDP connections are left alone.
  for (const session of sessions.list()) {
    if (session.browser) {
      if (session.isCDP) {
        // External CDP: just disconnect (browser keeps running).
        // In CDP mode, browser.close() on XBBrowserImpl has no childProcess,
        // so it only closes the WebSocket. Explicit skip for clarity.
      } else {
        // Self-launched: close browser (calls killChrome internally).
        await session.browser.close().catch(() => {});
      }
    }
  }

  sessions.clear();

  if (sharedState.browser) {
    // close() internally checks childProcess:
    //   - self-launched → kills Chrome (cleanup)
    //   - external CDP   → only disconnects WebSocket
    await sharedState.browser.close().catch(() => {});
    sharedState.browser = null;
  }

  if (getSharedCdpProxy()) {
    await getSharedCdpProxy()!.stop().catch(() => {});
    setSharedCdpProxy(null);
  }
}
