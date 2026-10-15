import { findSession, resetIdleTimer } from '../browser.js';

export { findSession };
import { newSessionId, sessions, type ManagedSession } from './state.js';

export function getSessionById(id: string): ManagedSession | undefined {
  return sessions.get(id);
}

export function setActivePage(session: ManagedSession, page: ManagedSession['page']): void {
  session.page = page;
  session.lastActivityAt = Date.now();
}

export function getAllSessions(): ManagedSession[] {
  return sessions.list();
}

export async function replaceSession(
  name: string,
  closeExisting: (name: string) => Promise<boolean>
): Promise<void> {
  const existing = findSession(name);
  if (!existing) return;
  await closeExisting(name);
}

export function registerSession(session: Omit<ManagedSession, 'id' | 'createdAt' | 'lastActivityAt'> & Partial<Pick<ManagedSession, 'id' | 'createdAt' | 'lastActivityAt'>>): ManagedSession {
  const complete: ManagedSession = {
    id: session.id ?? newSessionId(),
    createdAt: session.createdAt ?? new Date().toISOString(),
    lastActivityAt: session.lastActivityAt ?? Date.now(),
    ...session,
  };
  sessions.set(complete);
  resetIdleTimer();
  return complete;
}
