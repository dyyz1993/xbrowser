import type { ExecutionResult } from '../executor.js';

const DAEMON_PORT = 9224;
const DAEMON_BASE = `http://localhost:${DAEMON_PORT}`;

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

export async function daemonPing(): Promise<{ ok: boolean; pid?: number } | null> {
  try {
    const resp = await fetch(`${DAEMON_BASE}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'ping', params: {} }),
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as { ok: boolean; pid?: number };
  } catch {
    return null;
  }
}

export async function forwardExec(
  command: string,
  params: Record<string, unknown>,
  session: string = 'default',
  cdpEndpoint?: string,
): Promise<ExecutionResult> {
  const rpcParams: Record<string, unknown> = { command, params, session };
  if (cdpEndpoint) rpcParams.cdpEndpoint = cdpEndpoint;
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'exec',
      params: rpcParams,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    return { success: false, data: null, message: `Daemon error: ${resp.statusText}`, duration: 0 };
  }

  const result = (await resp.json()) as ExecutionResult;
  return result;
}

export async function forwardChain(
  input: string,
  session: string = 'default',
  cdpEndpoint?: string,
): Promise<unknown> {
  const params: Record<string, unknown> = { chain: input, session };
  if (cdpEndpoint) params.cdpEndpoint = cdpEndpoint;
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'chain',
      params,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    return { success: false, steps: [], totalDuration: 0, stoppedReason: `Daemon error: ${resp.statusText}` };
  }

  return resp.json();
}

export async function forwardNetworkList(
  sessionName: string,
  options?: { filter?: string; method?: string; limit?: number },
): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'network:list',
      params: { session: sessionName, ...options },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkClear(sessionName: string): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:clear', params: { session: sessionName } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkTop(
  sessionName: string,
  options?: { minScore?: number; limit?: number },
): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'network:top',
      params: { session: sessionName, ...options },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardCommandLog(sessionName: string, limit?: number): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'command:log', params: { session: sessionName, limit } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkAnalyze(
  sessionName: string,
): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:analyze', params: { session: sessionName } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkAround(
  sessionName: string,
  commandId: number,
  windowMs?: number,
): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'network:around',
      params: { session: sessionName, commandId, window: windowMs },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkCurl(
  sessionName: string,
  id: number,
): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:curl', params: { session: sessionName, id } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkReplay(
  sessionName: string,
  id: number,
): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:replay', params: { session: sessionName, id } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkLike(sessionName: string, id: number): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:like', params: { session: sessionName, id } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkDislike(sessionName: string, id: number): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:dislike', params: { session: sessionName, id } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkExport(sessionName: string, id: number, lang?: string): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:export', params: { session: sessionName, id, lang } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}

export async function forwardNetworkInspect(sessionName: string, id: number): Promise<unknown> {
  const resp = await fetch(`${DAEMON_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'network:inspect', params: { session: sessionName, id } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Daemon error: ${resp.statusText}`);
  return resp.json();
}
