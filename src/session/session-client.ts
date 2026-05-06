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

/**
 * Open a new browser session, navigate to the given URL, and persist session metadata.
 *
 * @param name - Unique name for the session.
 * @param url - The initial URL to navigate to.
 * @param options - Optional CDP endpoint configuration.
 * @returns Session info including id, name, url, and creation timestamp.
 *
 * @example
 * ```ts
 * const info = await openSession('default', 'https://example.com');
 * ```
 */
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

/**
 * Close a browser session by name.
 *
 * @param name - The session name to close.
 */
export async function closeSession(name: string): Promise<void> {
  await closeSessionByName(name);
}

export { closeAllSessions, getAllSessions, destroyBrowser, findSession };

/**
 * List all active sessions with their IDs and names.
 *
 * @returns Array of objects with `id` and `name` fields.
 */
export async function listSessions(): Promise<Array<{ id: string; name: string }>> {
  return getAllSessions().map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Get the Playwright Page for a named session.
 *
 * @param name - The session name. Defaults to "default".
 * @returns The page instance, or `null` if the session does not exist.
 */
export async function getSessionPage(name?: string) {
  const session = findSession(name || 'default');
  return session?.page ?? null;
}

export type { ManagedSession };
