import type { ExecutionResult } from '../executor.js';
import { startDaemonProcess } from '../daemon/daemon.js';

const DAEMON_PORT = 9224;
const DAEMON_BASE = `http://localhost:${DAEMON_PORT}`;

let _ensurePromise: Promise<void> | null = null;

async function ensureDaemonRunning(): Promise<void> {
  if (_ensurePromise) {
    try { await _ensurePromise; } catch { /* will retry */ }
    _ensurePromise = null;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const healthOk = await fetch(`${DAEMON_BASE}/health`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { status?: string } | null) => d?.status === 'ok')
      .catch(() => false);
    if (healthOk) return;
    if (attempt < 2) await new Promise(r => setTimeout(r, 500));
  }

  _ensurePromise = startDaemonProcess(DAEMON_PORT).then(() => {});
  _ensurePromise.catch(() => { _ensurePromise = null; });
  try {
    await _ensurePromise;
  } catch {
    _ensurePromise = null;
    throw new Error('Daemon not available');
  }
}

/**
 * Make an RPC call to the daemon's HTTP server.
 * All daemon operations go through this single function.
 * Automatically ensures the daemon is running before making the call.
 */
async function rpcCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = 10000,
): Promise<T> {
  await ensureDaemonRunning();
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    throw new Error(`Daemon error: ${resp.statusText}`);
  }
  return resp.json() as Promise<T>;
}

/**
 * Check if the daemon is running by hitting its health endpoint.
 * This is a simple liveness check — does NOT auto-start the daemon.
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${DAEMON_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { status?: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Ping the daemon for a quick liveness check via RPC.
 */
export async function daemonPing(): Promise<{ ok: boolean; pid?: number } | null> {
  try {
    return await rpcCall<{ ok: boolean; pid?: number }>('ping', {}, 2000);
  } catch {
    return null;
  }
}

// ─── Session management ──────────────────────────────────────────

export async function forwardSessionCreate(
  name: string,
  url: string,
  cdpEndpoint?: string,
): Promise<{ id: string; name: string; url: string }> {
  const params: Record<string, unknown> = { name, url };
  if (cdpEndpoint) params.cdpEndpoint = cdpEndpoint;
  return rpcCall<{ id: string; name: string; url: string }>('session:create', params, 30000);
}

export async function forwardSessionClose(name: string): Promise<{ ok: boolean }> {
  return rpcCall<{ ok: boolean }>('session:close', { name }, 10000);
}

export async function forwardSessionList(): Promise<Array<{ id: string; name: string; url: string | null }>> {
  return rpcCall<Array<{ id: string; name: string; url: string | null }>>('session:list', {}, 5000);
}

// ─── Command execution ───────────────────────────────────────────

export async function forwardExec(
  command: string,
  params: Record<string, unknown>,
  session: string = 'default',
  cdpEndpoint?: string,
  timeoutMs: number = 120000,
): Promise<ExecutionResult> {
  const rpcParams: Record<string, unknown> = { command, params, session };
  if (cdpEndpoint) rpcParams.cdpEndpoint = cdpEndpoint;
  try {
    return await rpcCall<ExecutionResult>('exec', rpcParams, timeoutMs);
  } catch {
    return { success: false, data: null, message: `Daemon error: exec failed`, duration: 0 };
  }
}

export async function forwardChain(
  input: string,
  session: string = 'default',
  cdpEndpoint?: string,
): Promise<unknown> {
  const params: Record<string, unknown> = { chain: input, session };
  if (cdpEndpoint) params.cdpEndpoint = cdpEndpoint;
  try {
    return await rpcCall('chain', params, 120000);
  } catch {
    return { success: false, steps: [], totalDuration: 0, stoppedReason: 'Daemon error' };
  }
}

// ─── Network analysis ────────────────────────────────────────────

export async function forwardNetworkList(
  sessionName: string,
  options?: { filter?: string; method?: string; limit?: number },
): Promise<unknown> {
  return rpcCall('network:list', { session: sessionName, ...options }, 30000);
}

export async function forwardNetworkClear(sessionName: string): Promise<unknown> {
  return rpcCall('network:clear', { session: sessionName }, 10000);
}

export async function forwardNetworkTop(
  sessionName: string,
  options?: { minScore?: number; limit?: number },
): Promise<unknown> {
  return rpcCall('network:top', { session: sessionName, ...options }, 30000);
}

export async function forwardCommandLog(sessionName: string, limit?: number): Promise<unknown> {
  return rpcCall('command:log', { session: sessionName, limit }, 10000);
}

export async function forwardNetworkAnalyze(sessionName: string): Promise<unknown> {
  return rpcCall('network:analyze', { session: sessionName }, 30000);
}

export async function forwardNetworkAround(
  sessionName: string,
  commandId: number,
  windowMs?: number,
): Promise<unknown> {
  return rpcCall('network:around', { session: sessionName, commandId, window: windowMs }, 10000);
}

export async function forwardNetworkCurl(sessionName: string, id: number): Promise<unknown> {
  return rpcCall('network:curl', { session: sessionName, id }, 10000);
}

export async function forwardNetworkReplay(sessionName: string, id: number): Promise<unknown> {
  return rpcCall('network:replay', { session: sessionName, id }, 30000);
}

export async function forwardNetworkLike(sessionName: string, id: number): Promise<unknown> {
  return rpcCall('network:like', { session: sessionName, id }, 5000);
}

export async function forwardNetworkDislike(sessionName: string, id: number): Promise<unknown> {
  return rpcCall('network:dislike', { session: sessionName, id }, 5000);
}

export async function forwardNetworkExport(sessionName: string, id: number, lang?: string): Promise<unknown> {
  return rpcCall('network:export', { session: sessionName, id, lang }, 10000);
}

export async function forwardNetworkInspect(sessionName: string, id: number): Promise<unknown> {
  return rpcCall('network:inspect', { session: sessionName, id }, 10000);
}

// ─── Recording management (via daemon) ────────────────────────────

export async function forwardRecordStart(session: string, url?: string): Promise<unknown> {
  return rpcCall('record:start', { session, url }, 15000);
}

export async function forwardRecordStop(session: string): Promise<unknown> {
  return rpcCall('record:stop', { session }, 10000);
}

export async function forwardRecordStatus(session: string): Promise<unknown> {
  return rpcCall('record:status', { session }, 5000);
}

export async function forwardRecordSummary(session: string): Promise<unknown> {
  return rpcCall('record:summary', { session }, 5000);
}

export async function forwardReplay(file: string, session: string, slowMo?: number): Promise<unknown> {
  return rpcCall('replay', { file, session, slowMo }, 120000);
}
