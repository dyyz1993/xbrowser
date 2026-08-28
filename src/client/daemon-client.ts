import type { ExecutionResult } from '../executor.js';
import { errMsg } from '../utils/error.js';
import { startDaemonProcess, stopDaemonProcess } from '../daemon/daemon.js';
import { version as cliVersion } from '../version.js';
import { request as httpRequest } from 'http';

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
      .then((d: { status?: string; version?: string } | null) => {
        if (d?.status === 'ok') {
          // Version mismatch — force restart
          if (d.version && d.version !== cliVersion) {
            return { needsRestart: true };
          }
          return { needsRestart: false };
        }
        return null;
      })
      .catch(() => null);
    if (healthOk?.needsRestart === false) return; // Same version, daemon is fine
    if (healthOk?.needsRestart === true) {
      console.error(`⚠️ Daemon version mismatch. Restarting...`);
      await stopDaemonProcess().catch(() => {});
      break; // Fall through to start logic below
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 500));
  }

  console.error('🔄 Starting daemon...');
  _ensurePromise = startDaemonProcess(DAEMON_PORT).then(() => {});
  _ensurePromise.catch(() => { _ensurePromise = null; });
  try {
    await _ensurePromise;
  } catch {
    _ensurePromise = null;
    throw new Error('Daemon not available');
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const ready = await fetch(`${DAEMON_BASE}/health`, { signal: AbortSignal.timeout(1000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { status?: string; version?: string } | null) => d?.status === 'ok')
      .catch(() => false);
    if (ready) {
      console.error('✅ Daemon ready');
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Daemon HTTP server not ready after 4s');
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
  // Raw http.request instead of fetch: undici hard-caps response-body waits at
  // 300s REGARDLESS of AbortSignal — long RPCs (vision-task, replay) died at
  // exactly 5:01. Only the explicit timeoutMs applies here.
  return new Promise<T>((resolve, reject) => {
    const body = JSON.stringify({ method, params });
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: DAEMON_PORT,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as T & { error?: string };
            if (parsed && typeof parsed.error === 'string' && Object.keys(parsed).length === 1) {
              reject(new Error(`Daemon error: ${parsed.error}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`RPC ${method} timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end(body);
  });
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
  } catch (e) {
    return { success: false, data: null, message: errMsg(e), duration: 0 };
  }
}

export async function forwardPluginExec(
  command: string,
  params: Record<string, unknown>,
  session: string = 'default',
  cdpEndpoint?: string,
  timeoutMs: number = 120000,
): Promise<ExecutionResult> {
  const rpcParams: Record<string, unknown> = { command, params, session };
  if (cdpEndpoint) rpcParams.cdpEndpoint = cdpEndpoint;
  try {
    return await rpcCall<ExecutionResult>('plugin:exec', rpcParams, timeoutMs);
  } catch (e) {
    return { success: false, data: null, message: errMsg(e), duration: 0 };
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
  } catch (e) {
    return { success: false, steps: [], totalDuration: 0, stoppedReason: errMsg(e) };
  }
}

export async function forwardAgentObserve(
  session: string = 'default',
  options?: { cdpEndpoint?: string; includeHidden?: boolean; limit?: number },
): Promise<ExecutionResult> {
  const params: Record<string, unknown> = { session };
  if (options?.cdpEndpoint) params.cdpEndpoint = options.cdpEndpoint;
  if (options?.includeHidden !== undefined) params.includeHidden = options.includeHidden;
  if (options?.limit !== undefined) params.limit = options.limit;
  return rpcCall<ExecutionResult>('agent:observe', params, 30000);
}

export async function forwardAgentAct(
  session: string = 'default',
  params: Record<string, unknown>,
  cdpEndpoint?: string,
): Promise<ExecutionResult> {
  const rpcParams: Record<string, unknown> = { ...params, session };
  if (cdpEndpoint) rpcParams.cdpEndpoint = cdpEndpoint;
  return rpcCall<ExecutionResult>('agent:act', rpcParams, 30000);
}

export async function forwardAgentWait(
  session: string = 'default',
  params: Record<string, unknown>,
  cdpEndpoint?: string,
  timeoutMs: number = 30000,
): Promise<ExecutionResult> {
  const rpcParams: Record<string, unknown> = { ...params, session };
  if (cdpEndpoint) rpcParams.cdpEndpoint = cdpEndpoint;
  return rpcCall<ExecutionResult>('agent:wait', rpcParams, timeoutMs + 5000);
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

export async function forwardRecordStart(session: string, url?: string, cdpEndpoint?: string, stream?: string): Promise<unknown> {
  return rpcCall('record:start', { session, url, cdpEndpoint, stream }, 15000);
}

export async function forwardRecordStop(session: string, output?: string): Promise<unknown> {
  const params: Record<string, unknown> = { session };
  if (output) params.output = output;
  return rpcCall('record:stop', params, 10000);
}

export async function forwardRecordStatus(session: string): Promise<unknown> {
  return rpcCall('record:status', { session }, 5000);
}

export async function forwardRecordSummary(session: string): Promise<unknown> {
  return rpcCall('record:summary', { session }, 5000);
}

export async function forwardReplay(file: string, session: string, slowMo?: number): Promise<unknown> {
  // Real-site replays legitimately exceed 5 minutes: slow page loads, stealth
  // trajectories, per-step load-state waits. Node fetch (undici) hard-caps the
  // response body wait at 300s regardless of AbortSignal — use raw http.request
  // (no body timeout) so only the replayer's own per-step timeouts apply.
  return longRpcCall('replay', { file, session, slowMo }, 20 * 60_000);
}

/** Long-running calls share the same undici-free transport as rpcCall now. */
function longRpcCall<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return rpcCall<T>(method, params, timeoutMs);
}

export async function forwardRecordCheckpoint(session: string, type: string, hint: string, selector?: string): Promise<unknown> {
  return rpcCall('record:checkpoint', { session, type, hint, selector }, 10000);
}

export async function forwardReplayResume(session: string): Promise<unknown> {
  return rpcCall('replay:resume', { session }, 10000);
}

export async function forwardViewerCheckSelector(
  name: string,
  selector: string,
): Promise<{ found: boolean; box?: { x: number; y: number; width: number; height: number } }> {
  return rpcCall('viewer:check-selector', { name, selector }, 5000);
}
