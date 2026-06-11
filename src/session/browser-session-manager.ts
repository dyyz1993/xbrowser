import { SessionManager, FileSessionPersistence } from '@dyyz1993/xcli-core';
import type { Page } from '../browser-shim.js';
import {
  createSession as browserCreateSession,
  findSession as browserFindSession,
  findOrRestoreSession as browserFindOrRestoreSession,
  closeSessionByName as browserCloseSession,
  getAllSessions as browserGetAllSessions,
  closeAllSessions as browserCloseAllSessions,
  destroyBrowser as browserDestroyBrowser,
  saveSessionDiskMeta,
  readSessionDiskMeta,
} from '../browser.js';

export interface BrowserSessionInfo {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  cdpEndpoint?: string;
}

/** Session metadata stored on disk for cross-process recovery. */
interface BrowserSessionDiskMeta {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  cdpEndpoint?: string;
}

function sessionToInfo(session: { id: string; name: string; page: Page; createdAt: string; cdpEndpoint?: string }): BrowserSessionInfo {
  return {
    id: session.id,
    name: session.name,
    url: session.page.url(),
    createdAt: session.createdAt,
    cdpEndpoint: session.cdpEndpoint,
  };
}

/**
 * Browser-specific session manager that extends core's SessionManager.
 *
 * Bridges the browser.ts functional API with the core SessionManager contract,
 * adding disk persistence and session recovery via findOrRestore.
 *
 * Consumers can use either:
 * - Core API: createSession, destroySession, getSession, listSessions, findOrRestore
 * - Browser API: closeAll, destroy
 */
export class BrowserSessionManager extends SessionManager<BrowserSessionInfo> {
  constructor() {
    super();
    this.setPersistence(
      new FileSessionPersistence<BrowserSessionDiskMeta>(
        undefined, // uses default ~/.xcli/sessions — xbrowser overrides below
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Core CRUD (overrides SessionManager)
  // ---------------------------------------------------------------------------

  protected override async allocateSession(
    name: string,
    config: Record<string, unknown>,
  ): Promise<BrowserSessionInfo> {
    const url = typeof config.url === 'string' ? config.url : 'about:blank';
    const cdpEndpoint =
      typeof config.cdpEndpoint === 'string' ? config.cdpEndpoint : undefined;

    const session = await browserCreateSession(name, url, { cdpEndpoint });
    const info = sessionToInfo(session);

    // Persist lightweight metadata to disk (xbrowser's own format)
    saveSessionDiskMeta(name, info);

    return info;
  }

  async destroySession(name: string): Promise<BrowserSessionInfo | undefined> {
    const existing = await this.getSession(name);
    if (!existing) return undefined;

    await browserCloseSession(name);
    this.store.removeById(existing.id);
    return existing;
  }

  async getSession(name: string): Promise<BrowserSessionInfo | undefined> {
    // Check in-memory store first
    const inMem = this.store.find(name);
    if (inMem) return inMem;

    // Fall back to browser.ts's in-memory sessions
    const session = browserFindSession(name);
    if (session) {
      const info = sessionToInfo(session);
      this.store.set(info);
      return info;
    }

    return undefined;
  }

  async listSessions(): Promise<BrowserSessionInfo[]> {
    // Merge browser.ts sessions with local store
    const browserSessions = browserGetAllSessions();
    for (const s of browserSessions) {
      if (!this.store.find(s.name)) {
        this.store.set(sessionToInfo(s));
      }
    }
    return this.store.list();
  }

  // ---------------------------------------------------------------------------
  // Enhanced: session recovery
  // ---------------------------------------------------------------------------

  async findOrRestore(name: string): Promise<BrowserSessionInfo | undefined> {
    // 1. Check local store
    const inMem = this.store.find(name);
    if (inMem) return inMem;

    // 2. Check browser.ts's in-memory sessions
    const browserSession = browserFindSession(name);
    if (browserSession) {
      const info = sessionToInfo(browserSession);
      this.store.set(info);
      return info;
    }

    // 3. Try disk + CDP restore via browser.ts
    const diskMeta = readSessionDiskMeta(name);
    if (!diskMeta) return undefined;

    const cdpEndpoint = diskMeta.cdpEndpoint;
    if (!cdpEndpoint) return undefined;

    const restored = await browserFindOrRestoreSession(name, cdpEndpoint);
    if (restored) {
      const info = sessionToInfo(restored);
      this.store.set(info);
      return info;
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Browser-specific API
  // ---------------------------------------------------------------------------

  async closeAll(): Promise<void> {
    await browserCloseAllSessions();
    this.store.clear();
  }

  async destroy(): Promise<void> {
    await browserDestroyBrowser();
    this.store.clear();
  }
}
