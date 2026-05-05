import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionInfo } from '@dyyz1993/xcli-core';

const SESSION_DIR = join(homedir(), '.xbrowser', 'sessions');
const DAEMON_CONFIG_PATH = join(homedir(), '.xbrowser', 'daemon.json');

function ensureSessionDir(): void {
  mkdirSync(SESSION_DIR, { recursive: true });
}

function getDaemonPort(): number {
  if (!existsSync(DAEMON_CONFIG_PATH)) {
    return 0;
  }
  try {
    const config = JSON.parse(readFileSync(DAEMON_CONFIG_PATH, 'utf-8'));
    return config.port || 0;
  } catch {
    return 0;
  }
}

export async function daemonRequest(
  method: string,
  params?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const port = getDaemonPort();
  if (!port) {
    throw new Error('Daemon not running. Use "xbrowser daemon" to start.');
  }

  const res = await fetch(`http://localhost:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const result = (await res.json()) as Record<string, unknown>;
  if (result.error) {
    throw new Error(result.error as string);
  }
  return result;
}

export function requireSession(name?: string): string {
  const sessionName = name || 'default';
  const sessionFile = join(SESSION_DIR, `${sessionName}.json`);
  if (!existsSync(sessionFile)) {
    throw new Error(
      `Session '${sessionName}' not found. Use "xbrowser session open <url>" to create one.`
    );
  }
  return sessionName;
}

export async function getSession(name: string): Promise<SessionInfo | null> {
  const path = join(SESSION_DIR, `${name}.json`);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export async function saveSession(session: SessionInfo): Promise<void> {
  ensureSessionDir();
  const path = join(SESSION_DIR, `${session.name}.json`);
  writeFileSync(path, JSON.stringify(session, null, 2));
}

export async function openSession(name: string, url: string): Promise<SessionInfo> {
  ensureSessionDir();
  const result = (await daemonRequest('session.create', { name, url })) as { id: string };
  const session: SessionInfo = {
    id: result.id,
    name,
    url,
    createdAt: new Date().toISOString(),
  };
  await saveSession(session);
  return session;
}

export async function closeSession(name: string): Promise<void> {
  await daemonRequest('session.close', { name });
}

export async function closeAllSessions(): Promise<void> {
  await daemonRequest('session.closeAll');
}

export async function listSessions(): Promise<Array<{ id: string; name: string }>> {
  const port = getDaemonPort();
  if (!port) return [];
  try {
    const res = await fetch(`http://localhost:${port}/api/sessions`);
    if (res.ok) {
      return (await res.json()) as Array<{ id: string; name: string }>;
    }
  } catch {
    // ignore fetch error
  }
  return [];
}

export async function htmlSession(name?: string): Promise<string> {
  const sessionName = requireSession(name);
  const result = (await daemonRequest('page.html', { name: sessionName })) as { html: string };
  return result.html;
}

export async function gotoSession(name: string, url: string): Promise<{ ok: boolean }> {
  const sessionName = requireSession(name);
  return (await daemonRequest('page.goto', { name: sessionName, url })) as { ok: boolean };
}

export async function clickSession(name: string, selector: string): Promise<{ ok: boolean }> {
  const sessionName = requireSession(name);
  return (await daemonRequest('page.click', { name: sessionName, selector })) as { ok: boolean };
}

export async function fillSession(
  name: string,
  selector: string,
  value: string
): Promise<{ ok: boolean }> {
  const sessionName = requireSession(name);
  return (await daemonRequest('page.fill', { name: sessionName, selector, value })) as {
    ok: boolean;
  };
}

export async function screenshotSession(
  name: string,
  options?: { fullPage?: boolean; type?: 'png' | 'jpeg' }
): Promise<{ ok: boolean; data: string; format: string; size: number }> {
  const sessionName = requireSession(name);
  return (await daemonRequest('page.screenshot', { name: sessionName, ...options })) as {
    ok: boolean;
    data: string;
    format: string;
    size: number;
  };
}

export async function evalSession(
  name: string,
  expression: string
): Promise<{ ok: boolean; result: unknown }> {
  const sessionName = requireSession(name);
  return (await daemonRequest('page.eval', { name: sessionName, expression })) as {
    ok: boolean;
    result: unknown;
  };
}

export async function waitForSelectorSession(
  name: string,
  selector: string,
  options?: { state?: string; timeout?: number }
): Promise<{ ok: boolean; found: boolean }> {
  const sessionName = requireSession(name);
  return (await daemonRequest('page.waitForSelector', { name: sessionName, selector, ...options })) as {
    ok: boolean;
    found: boolean;
  };
}

export async function scrollSession(
  name: string,
  direction: string,
  options?: { distance?: number; selector?: string }
): Promise<{ ok: boolean }> {
  const sessionName = requireSession(name);
  return (await daemonRequest('page.scroll', { name: sessionName, direction, ...options })) as {
    ok: boolean;
  };
}
