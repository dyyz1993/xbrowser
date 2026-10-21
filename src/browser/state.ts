import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SessionStore } from '@dyyz1993/xcli-core';
import type { Browser, BrowserContext, Page } from '../browser-shim.js';
import type { CDPInterceptorConfig } from '../cdp-interceptor/types.js';

export interface ManagedSession {
  id: string;
  name: string;
  context: BrowserContext;
  page: Page;
  browser: Browser;
  createdAt: string;
  lastActivityAt: number;
  isCDP?: boolean;
  cdpEndpoint?: string;
  /** True when CDP attach reused an existing user tab; close must only disconnect. */
  reusedExistingPage?: boolean;
}

export interface SessionDiskMeta {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  cdpEndpoint?: string;
  conversationUrl?: string;
}

export interface BrowserLaunchOptions {
  headless?: boolean;
  executablePath?: string;
  cdpEndpoint?: string;
  intercept?: boolean | CDPInterceptorConfig;
}

export const SESSION_DIR = join(homedir(), '.xbrowser', 'sessions');
export const sessions = new SessionStore<ManagedSession>();
export const sharedState: {
  browser: Browser | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
} = { browser: null, idleTimer: null };

export function sessionFile(name: string): string {
  return join(SESSION_DIR, `${name}.json`);
}

export function ensureSessionDir(): void {
  mkdirSync(SESSION_DIR, { recursive: true });
}

export function saveSessionDiskMeta(name: string, data: Partial<SessionDiskMeta>): void {
  ensureSessionDir();
  const file = sessionFile(name);
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // New metadata file.
  }
  Object.assign(existing, data, { name });
  writeFileSync(file, JSON.stringify(existing, null, 2));
}

export function readSessionDiskMeta(name: string): SessionDiskMeta | null {
  try {
    return JSON.parse(readFileSync(sessionFile(name), 'utf8')) as SessionDiskMeta;
  } catch {
    return null;
  }
}

export function deleteSessionDiskMeta(name: string): void {
  try {
    unlinkSync(sessionFile(name));
  } catch {
    // Metadata may already be absent.
  }
}

export function resetSessionState(): void {
  sessions.clear();
  sharedState.browser = null;
  sharedState.idleTimer = null;
  try {
    if (!existsSync(SESSION_DIR)) return;
    for (const file of readdirSync(SESSION_DIR)) unlinkSync(join(SESSION_DIR, file));
  } catch {
    // Directory may not exist.
  }
}

export function newSessionId(): string {
  return randomUUID();
}
