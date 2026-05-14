import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';

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
}

const sessions = new Map<string, ManagedSession>();
let browser: Browser | null = null;

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
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
      await destroyBrowser().catch(() => {});
    }
  }, IDLE_TIMEOUT_MS);
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

  return raw;
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
    const endpoint = await resolveCDPEndpoint(options.cdpEndpoint);
    browser = await chromium.connectOverCDP(endpoint);
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
    const page = await context.newPage();

    // Navigate to conversationUrl (specific page) or url (generic)
    const targetUrl = meta.conversationUrl || meta.url || 'about:blank';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

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
 * Find a managed session by its unique ID.
 *
 * @param id - The session UUID.
 * @returns The matching session, or `undefined` if not found.
 */
export function getSessionById(id: string): ManagedSession | undefined {
  return sessions.get(id);
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
      return true;
    }
  }
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
  for (const [, session] of sessions) {
    try {
      if (!session.isCDP) {
        await session.context.close();
      }
    } catch {
      // ignore
    }
  }
  sessions.clear();
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
  const hasCDPSession = [...sessions.values()].some(s => s.isCDP);
  await closeAllSessions();
  if (browser) {
    const b = browser;
    browser = null;
    if (!hasCDPSession) {
      b.close().catch(() => {});
    }
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
  browser = null;
  try {
    for (const f of readdirSync(SESSION_DIR)) {
      unlinkSync(join(SESSION_DIR, f));
    }
  } catch { /* dir may not exist */ }
}

/**
 * Create an ephemeral BrowserContext for one-off commands (scrape/crawl/map).
 *
 * Shares the single Browser instance but creates an isolated context
 * that can be closed independently without affecting other sessions.
 *
 * @param options - Browser launch options.
 * @returns The BrowserContext and its default Page.
 */
export async function createEphemeralContext(
  options?: BrowserLaunchOptions,
): Promise<{ context: BrowserContext; page: Page }> {
  const b = await getBrowser(options);
  const context = await b.newContext();
  const page = await context.newPage();
  resetIdleTimer();
  return { context, page };
}

/**
 * Close an ephemeral BrowserContext without destroying the shared Browser.
 *
 * Safe to call after one-off commands. Other sessions remain unaffected.
 */
export async function closeEphemeralContext(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // ignore close errors
  }
}
