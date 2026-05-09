import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

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

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const now = Date.now();
    let allIdle = true;
    for (const [, s] of sessions) {
      if (now - s.lastActivityAt < IDLE_TIMEOUT_MS) {
        allIdle = false;
        break;
      }
    }
    if (allIdle && browser) {
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
  resetIdleTimer();
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
      await session.context.close();
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
  for (const [, session] of sessions) {
    try {
      await session.context.close();
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
  await closeAllSessions();
  if (browser) {
    const b = browser;
    browser = null;
    b.close().catch(() => {});
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
