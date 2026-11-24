import { sessions } from '../browser/state.js';

export interface DaemonIdentity {
  version: string;
  buildId: string;
}

/**
 * Body of `GET /health`.
 *
 * `activeSessions` is what lets a CLI built from another checkout decide
 * whether restarting this daemon would interrupt anyone.
 *
 * @param identity - Version and build id the daemon was started from.
 * @param startedAt - ISO timestamp of the daemon start.
 * @param pid - Operating-system process id of the daemon.
 * @returns The JSON payload served by the health route.
 */
export function buildHealthPayload(identity: DaemonIdentity, startedAt: string, pid: number): Record<string, unknown> {
  return {
    status: 'ok',
    pid,
    version: identity.version,
    buildId: identity.buildId,
    startedAt,
    activeSessions: sessions.size,
  };
}
