import { errMsg } from '../utils/error.js';
import { createBrowser, getCDPTargets } from './connection.js';
import {
  deleteSessionDiskMeta,
  type ManagedSession,
  readSessionDiskMeta,
  sessions,
} from './state.js';
import { findSession } from './lifecycle.js';

function logSessionEvent(event: string, details: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.error(`[SESSION] ${timestamp} [PID:${process.pid}] ${event} | ${details}`);
}

export async function isSessionPageAlive(session: ManagedSession): Promise<boolean> {
  const page = session.page as unknown as { evaluate?: (expression: string) => Promise<unknown> } | undefined;
  if (!page || typeof page.evaluate !== 'function') return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await Promise.race([
        page.evaluate('1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('liveness probe timeout')), 1500)),
      ]);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return false;
}

export async function findOrRestoreSession(
  name: string,
  cdpEndpoint?: string,
  cleanup: (name: string) => Promise<boolean> = async () => false,
  installNetworkCapture: (page: ManagedSession['page'], sessionName: string) => Promise<void> = async () => {}
): Promise<ManagedSession | undefined> {
  const inMemory = findSession(name);
  if (inMemory) {
    if (await isSessionPageAlive(inMemory)) return inMemory;
    logSessionEvent('stale_session', `name="${name}" — page probe failed; rebuilding`);
    try {
      await cleanup(name);
    } catch {
      // Stale session cleanup is best-effort.
    }
  }

  const meta = readSessionDiskMeta(name);
  if (!meta) return undefined;
  const endpoint = cdpEndpoint || meta.cdpEndpoint;
  if (!endpoint) return undefined;

  try {
    const browser = await createBrowser({ cdpEndpoint: endpoint });
    await new Promise((resolve) => setTimeout(resolve, 500));
    let contexts = browser.contexts();
    if (contexts.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      contexts = browser.contexts();
    }
    const context = contexts[0] || await browser.newContext();
    const savedUrl = meta.conversationUrl || meta.url;
    let targetHostname = '';
    if (savedUrl) {
      try {
        targetHostname = new URL(savedUrl).hostname;
      } catch {
        targetHostname = '';
      }
    }

    let page: ManagedSession['page'] | null = null;
    let fallbackPage: ManagedSession['page'] | null = null;
    for (const browserContext of contexts) {
      for (const candidate of browserContext.pages()) {
        const url = candidate.url();
        if (!url || url === 'about:blank' || url.startsWith('chrome://')
          || url.startsWith('chrome-untrusted://') || url.startsWith('chrome-error://')) continue;
        if (targetHostname && url.includes(targetHostname)) {
          page = candidate;
          break;
        }
        fallbackPage ??= candidate;
      }
      if (page) break;
    }
    page ??= fallbackPage;

    if (!page) {
      const targets = await getCDPTargets(endpoint);
      const match = targets.find((target) => target.url
        && target.url !== 'about:blank'
        && !target.url.startsWith('chrome://')
        && !target.url.startsWith('chrome-untrusted://')
        && !target.url.startsWith('chrome-error://')
        && (!targetHostname || target.url.includes(targetHostname)));
      if (match?.url) {
        page = await context.newPage();
        await page.goto(match.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }
    if (!page) {
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();
    }

    try {
      await Promise.race([
        page.evaluate(() => true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
    } catch {
      deleteSessionDiskMeta(name);
      return undefined;
    }

    const targetUrl = meta.conversationUrl || meta.url;
    if (targetUrl && page.url() !== targetUrl) {
      try {
        if (!page.url().includes(new URL(targetUrl).hostname)) {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        }
      } catch {
        // Ignore invalid URLs.
      }
    }

    const session: ManagedSession = {
      id: meta.id,
      name,
      context,
      page,
      browser,
      createdAt: meta.createdAt,
      lastActivityAt: Date.now(),
      isCDP: true,
      cdpEndpoint: endpoint,
    };
    for (const existing of sessions.list()) {
      if (existing.name === name) sessions.removeById(existing.id);
    }
    sessions.set(session);
    await installNetworkCapture(session.page, name);
    return session;
  } catch (error) {
    console.error(`[Session Restore] Failed for "${name}":`, errMsg(error));
    deleteSessionDiskMeta(name);
    return undefined;
  }
}
