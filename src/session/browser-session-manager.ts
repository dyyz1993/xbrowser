import type { SessionManagerContract } from '@dyyz1993/xcli-core';
import type { ManagedSession } from '../browser.js';
import {
  findSession,
  createSession,
  closeSessionByName,
  getAllSessions,
  closeAllSessions,
  destroyBrowser,
  saveSessionDiskMeta,
} from '../browser.js';

export interface BrowserSessionInfo {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  cdpEndpoint?: string;
}

function sessionToInfo(s: ManagedSession): BrowserSessionInfo {
  return {
    id: s.id,
    name: s.name,
    url: s.page.url(),
    createdAt: s.createdAt,
    cdpEndpoint: s.cdpEndpoint,
  };
}

/**
 * Browser-specific session manager that implements the core {@link ISessionManager} interface.
 *
 * Wraps the browser lifecycle (Playwright Page instances) behind the standard
 * `createSession` / `destroySession` / `getSession` / `listSessions` contract
 * so that downstream consumers can program against the generic interface.
 */
export class BrowserSessionManager implements SessionManagerContract<BrowserSessionInfo> {
  async createSession(
    name: string,
    config: Record<string, unknown>,
  ): Promise<BrowserSessionInfo> {
    const url = typeof config.url === 'string' ? config.url : 'about:blank';
    const cdpEndpoint =
      typeof config.cdpEndpoint === 'string' ? config.cdpEndpoint : undefined;

    const session = await createSession(name, url, { cdpEndpoint });
    const info = sessionToInfo(session);
    saveSessionDiskMeta(name, info);
    return info;
  }

  async destroySession(name: string): Promise<BrowserSessionInfo | undefined> {
    const session = findSession(name);
    if (!session) return undefined;
    const info = sessionToInfo(session);
    await closeSessionByName(name);
    return info;
  }

  async getSession(name: string): Promise<BrowserSessionInfo | undefined> {
    const session = findSession(name);
    if (!session) return undefined;
    return sessionToInfo(session);
  }

  async listSessions(): Promise<BrowserSessionInfo[]> {
    return getAllSessions().map(sessionToInfo);
  }

  async closeAll(): Promise<void> {
    await closeAllSessions();
  }

  async destroy(): Promise<void> {
    await destroyBrowser();
  }
}
