import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface ManagedSession {
  id: string;
  name: string;
  context: BrowserContext;
  page: Page;
  createdAt: string;
  isCDP?: boolean;
  cdpEndpoint?: string;
}

export interface BrowserLaunchOptions {
  headless?: boolean;
  executablePath?: string;
  cdpEndpoint?: string;
}

const sessions = new Map<string, ManagedSession>();
let browser: Browser | null = null;

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

export function findSession(name: string): ManagedSession | undefined {
  for (const [, session] of sessions) {
    if (session.name === name) return session;
  }
  return undefined;
}

export function getSessionById(id: string): ManagedSession | undefined {
  return sessions.get(id);
}

export function getAllSessions(): ManagedSession[] {
  return Array.from(sessions.values());
}

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
    id: crypto.randomUUID(),
    name,
    context,
    page,
    createdAt: new Date().toISOString(),
    isCDP,
    cdpEndpoint: options?.cdpEndpoint,
  };
  sessions.set(session.id, session);
  return session;
}

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

export async function destroyBrowser(): Promise<void> {
  await closeAllSessions();
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    browser = null;
  }
}

export function resetForTesting(): void {
  sessions.clear();
  browser = null;
}
