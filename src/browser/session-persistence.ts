/** Explicit login snapshots for self-launched sessions. */

import {
  lstatSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Cookie } from '../browser-shim.js';
import { sessions } from './state.js';

// ── Types ─────────────────────────────────────────────────────

/** Minimal structural page surface needed for storage capture/injection. */
export interface StoragePageLike {
  url(): string;
  evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R>;
}

/** Minimal structural context surface needed for storage capture/injection. */
export interface StorageContextLike {
  cookies(urls?: string | string[]): Promise<Cookie[]>;
  addCookies(cookies: Cookie[]): Promise<void>;
  pages(): StoragePageLike[];
}

/** Input for {@link saveLoginSessionState}. ManagedSession satisfies this. */
export interface SaveLoginSessionInput {
  name: string;
  /** CDP-attached session — refused. */
  isCDP?: boolean;
  /** chrome-bridge session (truthy marker, e.g. ManagedSession.bridge) — refused. */
  bridge?: boolean | Record<string, unknown>;
  context: StorageContextLike;
}

/** Target for {@link restoreLoginSessionState}. */
export interface RestoreLoginTarget {
  context: StorageContextLike;
  /** Primary page, used to navigate to origins that have no open tab. */
  page: StoragePageLike & {
    goto?(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  };
}

/** On-disk saved state (versioned). */
export interface SavedLoginState {
  version: 1;
  name: string;
  createdAt: string;
  cookies: Cookie[];
  /** origin -> { key -> value } */
  localStorage: Record<string, Record<string, string>>;
}

/** Metadata summary — never contains cookie values. */
export interface SavedLoginSummary {
  name: string;
  createdAt: string;
  cookieCount: number;
  origins: string[];
  file: string;
}

export interface RestoreLoginResult {
  name: string;
  cookiesRestored: number;
  originsRestored: string[];
  /** Origins whose localStorage could not be applied (no open tab / nav failed). */
  originsSkipped: string[];
}

export interface PersistenceDirOptions {
  /** Override storage directory (tests). Default: savedSessionsDir(). */
  dir?: string;
}

export interface RestoreLoginOptions extends PersistenceDirOptions {
  /**
   * Allow navigating the primary page to an origin that has no open tab so
   * its localStorage can be injected (default true). Cookies restore first,
   * so the navigation itself carries the restored login state.
   */
  navigate?: boolean;
}

// ── Paths & guards ────────────────────────────────────────────

export function savedSessionsDir(): string {
  return process.env.XBROWSER_SAVED_SESSIONS_DIR
    || join(homedir(), '.xbrowser', 'saved-sessions');
}

export function sanitizeSessionName(name: string): string {
  if (!name || name === '.' || name === '..') {
    throw new Error(`Invalid session name "${name}": must be a non-empty file-safe name`);
  }
  if (name.length > 64) {
    throw new Error(`Invalid session name: too long (max 64 chars, got ${name.length})`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(
      `Invalid session name "${name}": only [A-Za-z0-9._-] allowed and it must start with an alphanumeric character`,
    );
  }
  return name;
}

function pageOrigin(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** String expression (arg-free) so synthetic pages and CDP driver both work. */
function localStorageSnapshotExpr(origin: string): string {
  return '((origin) => { try { if (location.origin !== origin) return null; ' +
    'const items = Object.create(null); for (let i = 0; i < localStorage.length; i++) ' +
    '{ const k = localStorage.key(i); if (k !== null) items[k] = localStorage.getItem(k) ?? \'\'; } ' +
    'return JSON.stringify(items); } catch { return null; } })(' + JSON.stringify(origin) + ')';
}

function localStorageApplyExpr(origin: string, items: Record<string, string>): string {
  return (
    '((origin, items) => { if (location.origin !== origin) return false; for (const [k, v] of Object.entries(items)) ' +
    '{ try { localStorage.setItem(k, v); } catch { return false; } } ' +
    'return true; })(' + JSON.stringify(origin) + ',' + JSON.stringify(items) + ')'
  );
}

function atomicWriteJson(file: string, data: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
  try { renameSync(tmp, file); }
  finally { if (existsSync(tmp)) unlinkSync(tmp); }
}

function assertSelfLaunched(kind: { name: string; isCDP?: boolean; bridge?: unknown }): void {
  if (kind.isCDP) {
    throw new Error(
      `Refusing to persist login state for CDP-attached session "${kind.name}": ` +
      'persistence is opt-in and limited to self-launched headless sessions',
    );
  }
  if (kind.bridge) {
    throw new Error(
      `Refusing to persist login state for chrome-bridge session "${kind.name}": ` +
      'persistence is opt-in and limited to self-launched headless sessions',
    );
  }
}

/**
 * Explicitly save the login state (cookies + per-origin localStorage) of a
 * self-launched session into `<dir>/<name>.json` (atomic, 0600).
 */
export async function saveLoginSessionState(
  input: SaveLoginSessionInput,
  opts: PersistenceDirOptions = {},
): Promise<SavedLoginSummary> {
  const name = sanitizeSessionName(input.name);
  assertSelfLaunched(input);

  const cookies = await input.context.cookies();
  const localStorageByOrigin: Record<string, Record<string, string>> = {};
  for (const page of input.context.pages()) {
    const origin = pageOrigin(page.url());
    // SecurityError on detached/restricted documents (mistakes.md 2026-11-21):
    // evaluate returns null on failure — skip the origin, never abort the save.
    if (!origin || localStorageByOrigin[origin]) continue;
    const raw = await Promise.resolve(
      page.evaluate<string>(localStorageSnapshotExpr(origin)),
    ).catch(() => null);
    if (typeof raw !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        localStorageByOrigin[origin] = parsed as Record<string, string>;
      }
    } catch { /* malformed snapshot — skip origin */ }
  }

  const state: SavedLoginState = {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    cookies,
    localStorage: localStorageByOrigin,
  };

  const dir = opts.dir ?? savedSessionsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (!info.isDirectory() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
    throw new Error('Saved sessions directory must be private (0700)');
  }
  const file = join(dir, `${name}.json`);
  atomicWriteJson(file, state);

  return {
    name,
    createdAt: state.createdAt,
    cookieCount: cookies.length,
    origins: Object.keys(localStorageByOrigin),
    file,
  };
}

function readSavedLoginState(name: string, opts: PersistenceDirOptions): SavedLoginState {
  const safeName = sanitizeSessionName(name);
  const file = join(opts.dir ?? savedSessionsDir(), `${safeName}.json`);
  let state: SavedLoginState;
  try {
    state = JSON.parse(readFileSync(file, 'utf8')) as SavedLoginState;
  } catch {
    throw new Error(`No saved login state found for session "${safeName}" (expected ${file})`);
  }
  if (state.version !== 1) {
    throw new Error(`Saved login state "${safeName}" has unsupported version ${String(state.version)}`);
  }
  if (state.name !== safeName) {
    throw new Error(`Saved login state name mismatch: file is "${state.name}", requested "${safeName}"`);
  }
  return state;
}

/**
 * Restore a previously saved login state into a self-launched session:
 * cookies first (so any navigation carries the login), then localStorage
 * per origin — on an open tab of that origin when one exists, otherwise by
 * navigating the primary page (unless `navigate: false`).
 */
export async function restoreLoginSessionState(
  name: string,
  target: RestoreLoginTarget,
  opts: RestoreLoginOptions = {},
): Promise<RestoreLoginResult> {
  const state = readSavedLoginState(name, opts);

  await target.context.addCookies(state.cookies);

  const originsRestored: string[] = [];
  const originsSkipped: string[] = [];
  const allowNavigate = opts.navigate !== false;

  for (const [origin, items] of Object.entries(state.localStorage)) {
    if (Object.keys(items).length === 0) continue;
    let page = target.context.pages().find((p) => pageOrigin(p.url()) === origin);
    if (!page && allowNavigate && typeof target.page.goto === 'function') {
      await Promise.resolve(
        target.page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }),
      ).catch(() => { /* navigation failure handled below */ });
      if (pageOrigin(target.page.url()) === origin) page = target.page;
    }
    if (!page) {
      originsSkipped.push(origin);
      continue;
    }
    const applied = await Promise.resolve(
      page.evaluate<boolean>(localStorageApplyExpr(origin, items)),
    ).catch(() => false);
    if (applied) originsRestored.push(origin);
    else originsSkipped.push(origin);
  }

  return {
    name: state.name,
    cookiesRestored: state.cookies.length,
    originsRestored,
    originsSkipped,
  };
}

/**
 * List saved login states (metadata only — never exposes cookie values).
 */
export function listSavedLoginStates(opts: PersistenceDirOptions = {}): SavedLoginSummary[] {
  const dir = opts.dir ?? savedSessionsDir();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries: SavedLoginSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const state = JSON.parse(readFileSync(join(dir, entry.name), 'utf8')) as SavedLoginState;
      if (state.version !== 1 || typeof state.name !== 'string') continue;
      summaries.push({
        name: state.name,
        createdAt: state.createdAt,
        cookieCount: Array.isArray(state.cookies) ? state.cookies.length : 0,
        origins: Object.keys(state.localStorage ?? {}),
        file: join(dir, entry.name),
      });
    } catch { /* unreadable/corrupt entry — skip */ }
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

/**
 * Delete a saved login state file. Returns true when a file was removed.
 * Isolated profile directories are untouched (see deleteIsolatedProfileDir).
 */
export function deleteLoginSessionState(name: string, opts: PersistenceDirOptions = {}): boolean {
  const file = join(opts.dir ?? savedSessionsDir(), `${sanitizeSessionName(name)}.json`);
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// ── Name-based convenience wrappers (the CLI/daemon hook surface) ──

/** Save the login state of an ACTIVE session looked up by name. */
export async function saveLoginSessionByName(
  name: string,
  opts: PersistenceDirOptions = {},
): Promise<SavedLoginSummary> {
  const session = sessions.find(name);
  if (!session) {
    throw new Error(`No active session named "${name}" — open a self-launched session first`);
  }
  return saveLoginSessionState(
    {
      name: session.name,
      isCDP: session.isCDP,
      bridge: !!session.bridge,
      context: session.context,
    },
    opts,
  );
}

/**
 * Restore a saved login state into an ACTIVE self-launched session.
 * (`savedName` may differ from the target session name.)
 */
export async function restoreLoginSessionByName(
  savedName: string,
  targetSessionName: string,
  opts: RestoreLoginOptions = {},
): Promise<RestoreLoginResult> {
  const session = sessions.find(targetSessionName);
  if (!session) {
    throw new Error(`No active session named "${targetSessionName}" — open a self-launched session first`);
  }
  assertSelfLaunched(session);
  return restoreLoginSessionState(savedName, { context: session.context, page: session.page }, opts);
}
