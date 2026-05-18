import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { CDPInterceptorProxy } from './cdp-interceptor/proxy.js';
import type { CDPInterceptorConfig } from './cdp-interceptor/types.js';
import type { BrowserCommandContext } from './context.js';

/**
 * Log a session lifecycle event for traceability.
 * Format: [SESSION] event | details
 * Events: create, close, idle_timeout, destroy_browser, process_exit, cdp_disconnect
 */
function logSessionEvent(event: string, details: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const pid = process.pid;
  console.error(`[SESSION] ${ts} [PID:${pid}] ${event} | ${details}`);
}

/**
 * Represents a managed browser session with its Playwright context and page.
 */
export interface ManagedSession {
  id: string;
  name: string;
  context: BrowserContext;
  page: Page;
  createdAt: string;
  lastActivityAt: number;
  isCDP?: boolean;
  cdpEndpoint?: string;
}

/** Extra metadata stored on disk for cross-process session recovery. */
export interface SessionDiskMeta {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  cdpEndpoint?: string;
  conversationUrl?: string;   // specific page URL to restore (e.g. doubao chat conversation)
}

const SESSION_DIR = join(homedir(), '.xbrowser', 'sessions');

function sessionFile(name: string): string {
  return join(SESSION_DIR, `${name}.json`);
}

function ensureSessionDir(): void {
  mkdirSync(SESSION_DIR, { recursive: true });
}

/**
 * Options for launching or connecting to a browser instance.
 */
export interface BrowserLaunchOptions {
  headless?: boolean;
  executablePath?: string;
  cdpEndpoint?: string;
  /** Enable CDP-level interception for anti-crawler protection */
  intercept?: boolean | CDPInterceptorConfig;
}

const sessions = new Map<string, ManagedSession>();
let browser: Browser | null = null;
let cdpProxy: CDPInterceptorProxy | null = null;

const IDLE_TIMEOUT_MS = (process.env.XBROWSER_IDLE_TIMEOUT ? parseInt(process.env.XBROWSER_IDLE_TIMEOUT, 10) : 15) * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const now = Date.now();
    let allIdle = true;
    const idleSessions: string[] = [];
    for (const [, s] of sessions) {
      if (now - s.lastActivityAt < IDLE_TIMEOUT_MS) {
        allIdle = false;
      } else {
        idleSessions.push(`${s.name}(${(now - s.lastActivityAt) / 1000}s idle)`);
      }
    }
    if (allIdle && browser) {
      logSessionEvent('idle_timeout', `Sessions idle for >${IDLE_TIMEOUT_MS / 60000}min. Sessions: ${idleSessions.join(', ') || 'all'}. Calling destroyBrowser()`);
      await destroyBrowser().catch(() => {         });
    }
  }, IDLE_TIMEOUT_MS);
  // unref() so idleTimer does not prevent process exit.
  // Daemon mode keeps itself alive via its own setInterval.
  if (idleTimer && typeof idleTimer.unref === 'function') {
    idleTimer.unref();
  }
}

export function touchSession(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastActivityAt = Date.now();
  resetIdleTimer();
}

process.on('exit', () => {
  if (browser) {
    const sessionNames = [...sessions.values()].map(s => s.name).join(', ');
    logSessionEvent('process_exit', `Process exiting. Closing browser. Active sessions: ${sessionNames || '(none)'}`);
    try {
      browser.close();
    } catch {
      // force cleanup on exit
    }
    browser = null;
  }
  if (cdpProxy) {
    try {
      cdpProxy.stop();
    } catch {
      // best effort
    }
    cdpProxy = null;
  }
});

async function resolveCDPEndpoint(raw: string): Promise<string> {
  if (raw === 'auto') {
    const httpResp = await fetch('http://localhost:9222/json/version');
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error('Could not auto-discover CDP endpoint from localhost:9222');
    }
    return data.webSocketDebuggerUrl;
  }

  if (/^\d+$/.test(raw)) {
    const port = raw;
    const httpResp = await fetch(`http://localhost:${port}/json/version`);
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error(`Could not discover CDP endpoint from localhost:${port}`);
    }
    return data.webSocketDebuggerUrl;
  }

  // Handle HTTP/HTTPS URLs - fetch the WebSocket Debugger URL
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const httpResp = await fetch(`${raw}/json/version`);
      const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
      if (!data.webSocketDebuggerUrl) {
        throw new Error(`Could not discover CDP endpoint from ${raw}`);
      }
      return data.webSocketDebuggerUrl;
    } catch (error) {
      // If we can't fetch the WebSocket URL, fall back to using the endpoint directly
      console.warn(`Failed to fetch WebSocket URL from ${raw}, using endpoint directly: ${error instanceof Error ? error.message : String(error)}`);
      return raw;
    }
  }

  return raw;
}

export function resolveLaunchOpts(ctx: BrowserCommandContext): BrowserLaunchOptions {
  if (ctx.cdpEndpoint) {
    return { cdpEndpoint: ctx.cdpEndpoint };
  }
  return { headless: true };
}

/**
 * Get or create the shared browser instance.
 *
 * If a browser is already running, returns it directly. Otherwise launches a
 * new Chromium instance or connects via CDP depending on the provided options.
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
  if (browser) return browser;

  if (options?.cdpEndpoint) {
    const realEndpoint = await resolveCDPEndpoint(options.cdpEndpoint);

    // Start CDP interceptor proxy if requested
    if (options.intercept) {
      const config: CDPInterceptorConfig = typeof options.intercept === 'object'
        ? { ...options.intercept, cdpEndpoint: realEndpoint }
        : { cdpEndpoint: realEndpoint };

      cdpProxy = new CDPInterceptorProxy(config);
      const proxyPort = await cdpProxy.start();
      console.error(`[CDP Interceptor] Proxy running on ws://localhost:${proxyPort}, forwarding to ${realEndpoint}`);
      browser = await chromium.connectOverCDP(`ws://localhost:${proxyPort}`);
    } else {
      browser = await chromium.connectOverCDP(realEndpoint);
    }

    return browser;
  }

  const executablePath =
    options?.executablePath || process.env.XBROWSER_CHROMIUM_PATH || undefined;
  browser = await chromium.launch({ executablePath, headless: options?.headless ?? true });
  return browser;
}

/**
 * Find a managed session by its name.
 *
 * @param name - The session name to search for.
 * @returns The matching session, or `undefined` if not found.
 */
export function findSession(name: string): ManagedSession | undefined {
  for (const [, session] of sessions) {
    if (session.name === name) return session;
  }
  return undefined;
}

export function getSessionById(id: string): ManagedSession | undefined {
  return sessions.get(id);
}

/**
 * Save session metadata to disk for cross-process recovery.
 */
export function saveSessionDiskMeta(name: string, data: Partial<SessionDiskMeta>): void {
  ensureSessionDir();
  const file = sessionFile(name);
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(readFileSync(file, 'utf8')); } catch { /* new file */ }
  Object.assign(existing, data, { name });
  writeFileSync(file, JSON.stringify(existing, null, 2));
}

/**
 * Read session metadata from disk.
 */
export function readSessionDiskMeta(name: string): SessionDiskMeta | null {
  const file = sessionFile(name);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SessionDiskMeta;
  } catch {
    return null;
  }
}

/**
 * Find a session by name, falling back to disk-stored metadata when the
 * in-memory session is gone (e.g. cross-CLI-invocation).
 *
 * In restore mode, creates a fresh page via CDP and navigates to the saved
 * conversationUrl or url so the caller gets a working page.
 *
 * @param name - Session name.
 * @param cdpEndpoint - CDP endpoint to use when restoring from disk.
 * @returns A managed session (possibly restored), or `undefined`.
 */
export async function findOrRestoreSession(
  name: string,
  cdpEndpoint?: string,
): Promise<ManagedSession | undefined> {
  // 1. Try in-memory first
  const inMem = findSession(name);
  if (inMem) return inMem;

  // 2. Try disk recovery if we have CDP
  const meta = readSessionDiskMeta(name);
  if (!meta) return undefined;
  const ep = cdpEndpoint || meta.cdpEndpoint;
  if (!ep) return undefined;

  try {
    const b = await getBrowser({ cdpEndpoint: ep });
    const contexts = b.contexts();
    const context = contexts[0] || (await b.newContext());

    // Reuse an existing page (same logic as createSession) instead of creating a new one
    let page: Page | null = null;
    for (const ctx of contexts) {
      const pages = ctx.pages();
      for (const p of pages) {
        const pUrl = p.url();
        if (pUrl && pUrl !== 'about:blank' && !pUrl.startsWith('chrome://')) {
          page = p;
          break;
        }
      }
      if (page) break;
    }

    if (!page) {
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();
    }

    // Navigate to conversationUrl (specific page) or url (generic) if needed
    const targetUrl = meta.conversationUrl || meta.url;
    if (targetUrl && page.url() !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
    }

    const session: ManagedSession = {
      id: meta.id || randomUUID(),
      name,
      context,
      page,
      createdAt: meta.createdAt || new Date().toISOString(),
      lastActivityAt: Date.now(),
      isCDP: true,
      cdpEndpoint: ep,
    };
    sessions.set(session.id, session);
    resetIdleTimer();
    await installNetworkCapture(page, name);
    return session;
  } catch (e) {
    console.error(`[Session Restore] Failed for "${name}":`, (e as Error).message);
    return undefined;
  }
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
    const b = await chromium.connectOverCDP(endpoint);
    const contexts = b.contexts();
    const ctx = contexts[0] || await b.newContext();
    const page = await ctx.newPage();
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
  if (sessions.size === 0 && idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * Get all active managed sessions.
 *
 * @returns Array of all active sessions.
 */
export function getAllSessions(): ManagedSession[] {
  return Array.from(sessions.values());
}

async function installNetworkCapture(page: Page, sessionName: string): Promise<void> {
  if (process.env.XBROWSER_DAEMON_WORKER !== '1') return;

  const { networkStore } = await import('./daemon/network-store.js');

  page.on('response', async (response: Response) => {
    try {
      const request = response.request();
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Capture response headers
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(response.headers())) {
        headers[k] = v;
      }

      // Capture request headers
      const requestHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(request.headers())) {
        requestHeaders[k] = v;
      }

      // Capture request body for POST/PATCH/PUT with JSON
      let requestBody: unknown = undefined;
      const method = request.method();
      const isPostLike = ['POST', 'PATCH', 'PUT'].includes(method);
      if (isPostLike && requestHeaders['content-type']?.includes('application/json')) {
        try {
          const postData = request.postData();
          if (postData) {
            try {
              requestBody = JSON.parse(postData);
            } catch {
              // Keep as string if not valid JSON
              requestBody = postData;
            }
          }
        } catch {
          // Ignore errors reading post data
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
          const text = await response.text();
          size = text.length;
          if (size <= 10240) {
            try {
              responseBody = JSON.parse(text);
            } catch {
              responseBody = text.slice(0, 200);
            }
          }
        } catch {
          /* unable to read body */
        }
      } else {
        try {
          const text = await response.text();
          size = text.length;
        } catch {
          size = 0;
        }
      }

      networkStore.add(sessionName, {
        timestamp: Date.now(),
        method,
        url,
        path: new URL(url).pathname,
        status: response.status(),
        contentType,
        size,
        headers,
        body: responseBody,
        requestHeaders,
        requestBody,
        resourceType: request.resourceType(),
      });
    } catch {
      // Silently ignore capture errors
    }
  });
}

/**
 * Create a new browser session with a page and optional initial URL.
 *
 * If connecting via CDP, reuses existing pages when possible instead of
 * creating a new context/page pair.
 *
 * @param name - Unique name for the session.
 * @param url - Optional URL to navigate to after creation.
 * @param options - Browser launch or CDP connection options.
 * @returns The newly created managed session.
 *
 * @example
 * ```ts
 * const session = await createSession('default', 'https://example.com');
 * ```
 */
export async function createSession(
  name: string,
  url?: string,
  options?: BrowserLaunchOptions
): Promise<ManagedSession> {
  const b = await getBrowser(options);
  const isCDP = !!options?.cdpEndpoint;
  let context: BrowserContext;
  let page: Page;

  if (isCDP) {
    const contexts = b.contexts();
    context = contexts[0] || (await b.newContext());

    let targetPage: Page | null = null;
    for (const ctx of contexts) {
      const pages = ctx.pages();
      for (const p of pages) {
        const pUrl = p.url();
        if (pUrl && pUrl !== 'about:blank' && !pUrl.startsWith('chrome://')) {
          targetPage = p;
          break;
        }
      }
      if (targetPage) break;
    }

    if (targetPage) {
      page = targetPage;
    } else {
      const pages = context.pages();
      if (pages.length > 0) {
        page = pages[0];
      } else {
        page = await context.newPage();
      }
    }
  } else {
    context = await b.newContext();
    page = await context.newPage();
  }

  if (url && page.url() !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  const session: ManagedSession = {
    id: randomUUID(),
    name,
    context,
    page,
    createdAt: new Date().toISOString(),
    lastActivityAt: Date.now(),
    isCDP,
    cdpEndpoint: options?.cdpEndpoint,
  };
  sessions.set(session.id, session);
  logSessionEvent('create_session', `name="${name}" id="${session.id}" url="${url || '(no url)'}" isCDP=${isCDP} cdpEndpoint=${options?.cdpEndpoint || '(none)'}`);
  resetIdleTimer();
  await installNetworkCapture(page, name);
  return session;
}

/**
 * Close a session by its name or ID.
 *
 * @param name - Session name or UUID to close.
 * @returns `true` if a session was found and closed, `false` otherwise.
 */
export async function closeSessionByName(name: string): Promise<boolean> {
  for (const [id, session] of sessions) {
    if (session.name === name || session.id === name) {
      logSessionEvent('close_session', `name="${session.name}" id="${session.id}" url="${session.page.url()}"`);
      if (!session.isCDP) {
        await session.context.close();
      }
      sessions.delete(id);

      // Clean up disk metadata for this session
      const file = sessionFile(session.name);
      try { unlinkSync(file); } catch { /* file may not exist */ }

      // Clear associated network captures from memory
      try {
        const { networkStore, commandLogStore } = await import('./daemon/network-store.js');
        networkStore.clear(session.name);
        commandLogStore.clear(session.name);
      } catch { /* stores may not be loaded */ }

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
 * Closes every managed context, ignoring individual close errors.
 */
export async function closeAllSessions(): Promise<void> {
  const names = [...sessions.values()].map(s => `${s.name}(${s.page.url()})`).join(', ');
  if (names) logSessionEvent('close_all_sessions', `Closing ${sessions.size} sessions: ${names}`);
  for (const [id, session] of sessions) {
    try {
      if (!session.isCDP) {
        await session.context.close();
      }
      sessions.delete(id);
    } catch {
      sessions.delete(id);
    }
  }
}

/**
 * Close all sessions and destroy the shared browser instance.
 *
 * After calling this, the module returns to a clean state and
 * {@link getBrowser} will create a new instance on next call.
 */
export async function destroyBrowser(): Promise<void> {
  logSessionEvent('destroy_browser', `Sessions count: ${sessions.size}. Clearing idle timer and closing browser.`);
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  await closeAllSessions();
  if (browser) {
    const b = browser;
    browser = null;
    // close() on a CDP-connected browser only disconnects the WebSocket,
    // it does NOT shut down the remote browser.
    b.close().catch(() => {});
  }
  if (cdpProxy) {
    await cdpProxy.stop().catch(() => {});
    cdpProxy = null;
  }
}

/**
 * Reset all internal st    ate for testing purposes.
 *
 * Clears the session map and drops the browser reference without
 * closing anything. Intended for use in test teardown.
 */
export function resetForTesting(): void {
  sessions.clear();
  browser = null;
  cdpProxy = null;
  try {
    for (const f of readdirSync(SESSION_DIR)) {
      unlinkSync(join(SESSION_DIR, f));
    }
  } catch { /* dir may not exist */ }
}

/**
 * Force cleanup and ensure the process can exit.
 * Call this before process.exit() to release all Playwright resources.
 */
export async function ensureProcessCanExit(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Clear all sessions
  sessions.clear();

  // Close browser if exists
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }

  if (cdpProxy) {
    await cdpProxy.stop().catch(() => {});
    cdpProxy = null;
  }
}

