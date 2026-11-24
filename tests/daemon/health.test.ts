import { describe, it, expect, afterEach } from 'vitest';
import { buildHealthPayload } from '../../src/daemon/health.js';
import { sessions, type ManagedSession } from '../../src/browser/state.js';

function addSession(id: string): void {
  sessions.set({ id, name: id, lastActivityAt: Date.now() } as unknown as ManagedSession);
}

describe('daemon health payload', () => {
  afterEach(() => {
    sessions.clear();
  });

  it('reports the daemon identity', () => {
    const payload = buildHealthPayload({ version: '1.35.0', buildId: 'build-1' }, '2026-11-24T00:00:00.000Z', 4242);
    expect(payload).toEqual({
      status: 'ok',
      pid: 4242,
      version: '1.35.0',
      buildId: 'build-1',
      startedAt: '2026-11-24T00:00:00.000Z',
      activeSessions: 0,
    });
  });

  it('reports the number of sessions the daemon is holding', () => {
    addSession('a');
    addSession('b');
    expect(buildHealthPayload({ version: '1.35.0', buildId: 'build-1' }, '2026-11-24T00:00:00.000Z', 4242).activeSessions).toBe(2);
  });
});
