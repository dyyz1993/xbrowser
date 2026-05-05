import {
  findSession,
  createSession,
  closeSessionByName,
  closeAllSessions,
  getAllSessions,
  destroyBrowser,
  type ManagedSession,
} from '../browser.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SESSION_DIR = join(homedir(), '.xbrowser', 'sessions');

function ensureSessionDir(): void {
  mkdirSync(SESSION_DIR, { recursive: true });
}

function sessionToInfo(s: ManagedSession) {
  return { id: s.id, name: s.name, url: s.page.url(), createdAt: s.createdAt };
}

export async function openSession(
  name: string,
  url: string,
  options?: { cdpEndpoint?: string }
): Promise<{ id: string; name: string; url: string; createdAt: string }> {
  ensureSessionDir();
  const session = await createSession(name, url, { cdpEndpoint: options?.cdpEndpoint });
  const info = sessionToInfo(session);
  writeFileSync(join(SESSION_DIR, `${name}.json`), JSON.stringify(info, null, 2));
  return info;
}

export async function closeSession(name: string): Promise<void> {
  await closeSessionByName(name);
}

export { closeAllSessions, getAllSessions, destroyBrowser, findSession };

export async function listSessions(): Promise<Array<{ id: string; name: string }>> {
  return getAllSessions().map((s) => ({ id: s.id, name: s.name }));
}

export async function getSessionPage(name?: string) {
  const session = findSession(name || 'default');
  return session?.page ?? null;
}

export type { ManagedSession };
