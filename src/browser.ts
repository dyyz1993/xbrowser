import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
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
 * Represents a managed browser session with its Playwright context, page,
 * and its own dedicated Browser connection.
 */
export interface ManagedSession {
  id: string;
  name: string;
  context: BrowserContext;
  page: Page;
  browser: Browser;
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

let _sharedBrowser: Browser | null = null;
let _sharedCdpProxy: CDPInterceptorProxy | null = null;

const IDLE_TIMEOUT_MS = (process.env.XBROWSER_IDLE_TIMEOUT ? parseInt(process.env.XBROWSER_IDLE_TIMEOUT, 10) : 30) * 60 * 1000;
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
    if (allIdle && (sessions.size > 0 || _sharedBrowser)) {
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
  for (const session of sessions.values()) {
    if (session.isCDP) {
      logSessionEvent('process_exit', `Session "${session.name}": CDP connection (not closing external browser).`);
    } else {
      logSessionEvent('process_exit', `Session "${session.name}": Closing browser.`);
      try { session.browser?.close(); } catch { /* force cleanup on exit */ }
    }
  }
  if (_sharedBrowser) {
    logSessionEvent('process_exit', 'Closing shared browser.');
    try { _sharedBrowser.close(); } catch { /* force cleanup on exit */ }
    _sharedBrowser = null;
  }
  if (_sharedCdpProxy) {
    try { _sharedCdpProxy.stop(); } catch { /* best effort */ }
    _sharedCdpProxy = null;
  }
  sessions.clear();
});

async function getCDPTargets(cdpEndpoint: string): Promise<Array<{ id: string; url: string; webSocketDebuggerUrl: string }>> {
  try {
    let host = 'localhost';
    let port = '9222';
    if (cdpEndpoint.startsWith('http://') || cdpEndpoint.startsWith('https://')) {
      const u = new URL(cdpEndpoint);
      host = u.hostname;
      port = u.port || '9222';
    } else if (/^\d+$/.test(cdpEndpoint)) {
      port = cdpEndpoint;
    }
    const resp = await fetch(`http://${host}:${port}/json/list`);
    return (await resp.json()) as Array<{ id: string; url: string; webSocketDebuggerUrl: string }>;
  } catch {
    return [];
  }
}

/**
 * Fetch a URL bypassing any HTTP proxy (for localhost CDP endpoints).
 * Node.js global fetch respects http_proxy/https_proxy which breaks localhost CDP discovery.
 */
async function fetchNoProxy(url: string): Promise<globalThis.Response> {
  const savedProxy = {
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    all_proxy: process.env.all_proxy,
    ALL_PROXY: process.env.ALL_PROXY,
  };
  // Temporarily clear proxy env vars
  for (const key of Object.keys(savedProxy)) delete process.env[key];
  try {
    return await fetch(url);
  } finally {
    // Restore proxy env vars
    for (const [key, val] of Object.entries(savedProxy)) {
      if (val !== undefined) process.env[key] = val;
    }
  }
}

async function resolveCDPEndpoint(raw: string): Promise<string> {
  if (raw === 'auto') {
    const httpResp = await fetchNoProxy('http://localhost:9222/json/version');
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error('Could not auto-discover CDP endpoint from localhost:9222');
    }
    return data.webSocketDebuggerUrl;
  }

  if (/^\d+$/.test(raw)) {
    const port = raw;
    const httpResp = await fetchNoProxy(`http://localhost:${port}/json/version`);
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error(`Could not discover CDP endpoint from localhost:${port}`);
    }
    return data.webSocketDebuggerUrl;
  }

  // Handle HTTP/HTTPS URLs - fetch the WebSocket Debugger URL
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const httpResp = await fetchNoProxy(`${raw}/json/version`);
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

const CHROMIUM_CANDIDATES = [
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
];

function discoverChromiumPath(): string | undefined {
  for (const p of CHROMIUM_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Always create a new Browser instance (never caches).
 *
 * @param options - Launch options including headless mode, executable path, or CDP endpoint.
 * @returns A fresh Playwright Browser instance.
 */
export async function createBrowser(options?: BrowserLaunchOptions): Promise<Browser> {
  if (options?.cdpEndpoint) {
    const realEndpoint = await resolveCDPEndpoint(options.cdpEndpoint);

    if (options.intercept) {
      const config: CDPInterceptorConfig = typeof options.intercept === 'object'
        ? { ...options.intercept, cdpEndpoint: realEndpoint }
        : { cdpEndpoint: realEndpoint };

      const proxy = new CDPInterceptorProxy(config);
      const proxyPort = await proxy.start();
      console.error(`[CDP Interceptor] Proxy running on ws://localhost:${proxyPort}, forwarding to ${realEndpoint}`);
      return await chromium.connectOverCDP(`ws://localhost:${proxyPort}`);
    }

    return await chromium.connectOverCDP(realEndpoint);
  }

  const executablePath =
    options?.executablePath ||
    process.env.XBROWSER_CHROMIUM_PATH ||
    discoverChromiumPath();
  return await chromium.launch({ executablePath, headless: options?.headless ?? true });
}

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
  if (_sharedBrowser) return _sharedBrowser;
  _sharedBrowser = await createBrowser(options);
  // Track CDP proxy for shared browser cleanup
  if (options?.cdpEndpoint && options.intercept) {
    // Proxy lifecycle is handled by destroyBrowser
  }
  return _sharedBrowser;
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

export function deleteSessionDiskMeta(name: string): void {
  const file = sessionFile(name);
  try { unlinkSync(file); } catch { /* file may not exist */ }
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
  // 1. Try in-memory first (same-process sessions are always valid)
  const inMem = findSession(name);
  if (inMem) return inMem;

  // 2. Try disk recovery if we have CDP
  const meta = readSessionDiskMeta(name);
  if (!meta) return undefined;
  const ep = cdpEndpoint || meta.cdpEndpoint;
  if (!ep) return undefined;

  try {
    const b = await createBrowser({ cdpEndpoint: ep });
    await new Promise(r => setTimeout(r, 500)); // 等待 contexts 填充
    let contexts = b.contexts();
    
    // 如果 contexts 仍为空，尝试等待更长时间
    if (contexts.length === 0) {
      await new Promise(r => setTimeout(r, 500));
      contexts = b.contexts();
    }
    
    const context = contexts[0] || (await b.newContext());

    const savedUrl = meta.conversationUrl || meta.url;
    const targetHostname = savedUrl ? (() => { try { return new URL(savedUrl).hostname; } catch { return ''; } })() : '';

    let page: Page | null = null;
    let fallbackPage: Page | null = null;

    for (const ctx of contexts) {
      const pages = ctx.pages();
      for (const p of pages) {
        const pUrl = p.url();
        if (pUrl && pUrl !== 'about:blank' && !pUrl.startsWith('chrome://')) {
          // Prefer the page matching the session's saved hostname
          if (targetHostname && pUrl.includes(targetHostname)) {
            page = p;
            break;
          }
          // Keep the first usable page as fallback
          if (!fallbackPage) {
            fallbackPage = p;
          }
        }
      }
      if (page) break;
    }

    // Use hostname-matched page, or fallback to first usable page
    page = page || fallbackPage;

    if (!page) {
      const targets = await getCDPTargets(ep);
      const matchTarget = targets.find(t =>
        t.url && t.url !== 'about:blank' && !t.url.startsWith('chrome://') &&
        (targetHostname ? t.url.includes(targetHostname) : true)
      );
      if (matchTarget && matchTarget.url) {
        page = await context.newPage();
        await page.goto(matchTarget.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }

    if (!page) {
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();
    }

    // Validate restored page is responsive
    try {
      await Promise.race([
        page.evaluate(() => true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
    } catch {
      // Page is dead (CDP disconnected, tab closed, etc.) — discard stale session, create fresh
      console.log(`[Session] "${name}" restored page unresponsive, creating fresh session`);
      deleteSessionDiskMeta(name);
      return undefined;
    }

    const targetUrl = meta.conversationUrl || meta.url;
    if (targetUrl && page.url() !== targetUrl && !page.url().includes(new URL(targetUrl).hostname)) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    const session: ManagedSession = {
      id: meta.id || randomUUID(),
      name,
      context,
      page,
      browser: b,
      createdAt: meta.createdAt || new Date().toISOString(),
      lastActivityAt: Date.now(),
      isCDP: true,
      cdpEndpoint: ep,
    };
    // Safety: remove any stale session with the same name before inserting.
    // This should never happen (findSession returned undefined above) but
    // guards against race conditions in daemon mode.
    for (const [existingId, existingSession] of sessions) {
      if (existingSession.name === name) {
        logSessionEvent('remove_stale', `Removing stale session name="${name}" id="${existingId}" during restore`);
        sessions.delete(existingId);
      }
    }

    sessions.set(session.id, session);
    resetIdleTimer();
    await installNetworkCapture(page, name);
    return session;
  } catch (e) {
    console.error(`[Session Restore] Failed for "${name}":`, (e as Error).message);
    // Discard corrupt session meta so next attempt starts fresh
    deleteSessionDiskMeta(name);
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
 * Each session gets its own dedicated Browser connection. If connecting via
 * CDP, reuses existing pages when possible instead of creating a new
 * context/page pair.
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
  // Enforce name uniqueness: close any existing session with the same name.
  // A session name is a unique identifier — there can be only one per name.
  const existing = findSession(name);
  if (existing) {
    logSessionEvent('replace_session', `name="${name}" id="${existing.id}" — closing existing session before creating new one`);
    await closeSessionByName(name);
  }

  const b = await createBrowser(options);
  const isCDP = !!options?.cdpEndpoint;
  let context: BrowserContext;
  let page: Page;

  if (isCDP) {
    await new Promise(r => setTimeout(r, 500)); // 等待 contexts 填充
    let contexts = b.contexts();
    if (contexts.length === 0) {
      await new Promise(r => setTimeout(r, 500));
      contexts = b.contexts();
    }

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

    if (!targetPage && options?.cdpEndpoint) {
      const targets = await getCDPTargets(options.cdpEndpoint);
      const matchTarget = targets.find(t =>
        t.url && t.url !== 'about:blank' && !t.url.startsWith('chrome://') &&
        (url ? t.url.includes(new URL(url).hostname) : true)
      );
      if (matchTarget && matchTarget.url) {
        targetPage = await context.newPage();
        await targetPage.goto(matchTarget.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }

    if (!targetPage) {
      const pages = context.pages();
      if (pages.length > 0) {
        targetPage = pages[0];
      } else {
        targetPage = await context.newPage();
      }
    }

    page = targetPage;
  } else {
    context = await b.newContext({ viewport: { width: 1920, height: 1080 } });
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
    browser: b,
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
      if (session.isCDP) {
        // CDP mode: close the page/tab we created (not the whole browser).
        // This only affects the tab xbrowser opened, not other user tabs.
        try { await session.page.close(); } catch { /* page may already be closed */ }
        // Disconnect the CDP WebSocket connection
        if (session.browser) {
          await session.browser.close().catch(() => {});
        }
      } else {
        // Non-CDP mode: close the context (and its pages), then the browser
        await session.context.close();
        if (session.browser) {
          await session.browser.close().catch(() => {});
        }
      }
      sessions.delete(id);

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
  const names = [...sessions.values()].map(s => `${s.name}(${s.page.url()})`).join(', ');
  if (names) logSessionEvent('close_all_sessions', `Closing ${sessions.size} sessions: ${names}`);
  for (const [id, session] of sessions) {
    try {
      if (!session.isCDP) {
        await session.context.close();
      }
      if (session.browser) {
        await session.browser.close().catch(() => {});
      }
      sessions.delete(id);
    } catch {
      sessions.delete(id);
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
  logSessionEvent('destroy_browser', `Sessions count: ${sessions.size}. Clearing idle timer and closing all browsers.`);
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  await closeAllSessions();
  if (_sharedBrowser) {
    await _sharedBrowser.close().catch(() => {});
    _sharedBrowser = null;
  }
  if (_sharedCdpProxy) {
    await _sharedCdpProxy.stop().catch(() => {});
    _sharedCdpProxy = null;
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
  _sharedBrowser = null;
  _sharedCdpProxy = null;
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

  // Close each session's own browser connection.
  // For CDP sessions: browser.close() only disconnects the WebSocket,
  // it does NOT close the remote browser or its pages.
  // The next CLI invocation will reconnect via findOrRestoreSession().
  for (const session of sessions.values()) {
    if (session.browser) {
      if (session.isCDP) {
        // CDP: just disconnect, remote browser keeps running
        await session.browser.close().catch(() => {});
      } else {
        // Non-CDP: close the browser we launched
        await session.browser.close().catch(() => {});
      }
    }
  }

  sessions.clear();

  if (_sharedBrowser) {
    await _sharedBrowser.close().catch(() => {});
    _sharedBrowser = null;
  }

  if (_sharedCdpProxy) {
    await _sharedCdpProxy.stop().catch(() => {});
    _sharedCdpProxy = null;
  }
}
