import { scoreEntries } from './network-scorer.js';
import type { ScoredEntry } from './network-scorer.js';

export type { ScoredEntry };

export interface NetworkCaptureEntry {
  id: number;
  timestamp: number;
  method: string;
  url: string;
  path: string;
  status: number;
  contentType: string;
  size: number;
  headers: Record<string, string>;
  body?: unknown;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
}

export interface NetworkListResult {
  session: string;
  total: number;
  captures: NetworkCaptureEntry[];
}

export interface NetworkInspectResult {
  session: string;
  capture: NetworkCaptureEntry | null;
}

export interface NetworkTopResult {
  session: string;
  entries: ScoredEntry[];
}

interface SessionStore {
  entries: NetworkCaptureEntry[];
  counter: number;
}

export class NetworkCaptureStore {
  private stores = new Map<string, SessionStore>();
  private maxEntries: number;

  constructor(maxEntries = 2000) {
    this.maxEntries = maxEntries;
  }

  private getStore(sessionName: string): SessionStore {
    let store = this.stores.get(sessionName);
    if (!store) {
      store = { entries: [], counter: 0 };
      this.stores.set(sessionName, store);
    }
    return store;
  }

  add(sessionName: string, entry: Omit<NetworkCaptureEntry, 'id'>): void {
    const store = this.getStore(sessionName);
    store.counter += 1;
    const fullEntry: NetworkCaptureEntry = { ...entry, id: store.counter };
    store.entries.push(fullEntry);
    if (store.entries.length > this.maxEntries) {
      store.entries.splice(0, store.entries.length - this.maxEntries);
    }
  }

  list(
    sessionName: string,
    options?: { filter?: string; method?: string; limit?: number; offset?: number },
  ): NetworkListResult {
    const store = this.getStore(sessionName);
    let entries = store.entries;

    if (options?.filter) {
      const f = options.filter.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.url.toLowerCase().includes(f) ||
          e.path.toLowerCase().includes(f) ||
          e.contentType.toLowerCase().includes(f),
      );
    }

    if (options?.method) {
      const m = options.method.toUpperCase();
      entries = entries.filter((e) => e.method === m);
    }

    const total = entries.length;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const captures = entries.slice(offset, offset + limit);

    return { session: sessionName, total, captures };
  }

  inspect(sessionName: string, id: number): NetworkInspectResult {
    const store = this.getStore(sessionName);
    const capture = store.entries.find((e) => e.id === id) ?? null;
    return { session: sessionName, capture };
  }

  clear(sessionName: string): void {
    this.stores.delete(sessionName);
  }

  top(
    sessionName: string,
    options?: { minScore?: number; limit?: number; feedbackFn?: (path: string, method: string) => number },
  ): NetworkTopResult {
    const store = this.getStore(sessionName);
    const feedbackFn = options?.feedbackFn;
    const scored = feedbackFn
      ? scoreEntries(store.entries, undefined, feedbackFn)
      : scoreEntries(store.entries);
    const minScore = options?.minScore ?? 0;
    const filtered = scored.filter((e) => e.score >= minScore);
    const limit = options?.limit ?? 20;
    return { session: sessionName, entries: filtered.slice(0, limit) };
  }

  around(
    sessionName: string,
    commandId: number,
    cmdLogStore: CommandLogStore,
    windowMs: number = 5000,
  ): AroundResult | null {
    const cmd = cmdLogStore.findEntry(sessionName, commandId);
    if (!cmd) return null;

    const netStore = this.getStore(sessionName);

    const before = netStore.entries.filter(
      e => e.timestamp >= cmd.timestamp - windowMs && e.timestamp < cmd.timestamp,
    );
    const after = netStore.entries.filter(
      e => e.timestamp >= cmd.timestamp && e.timestamp < cmd.timestamp + windowMs,
    );

    return { command: cmd, before, after, afterCount: after.length };
  }

  clearAll(): void {
    this.stores.clear();
  }
}

export interface CommandLogEntry {
  id: number;
  timestamp: number;
  command: string;
  params: Record<string, unknown>;
  session: string;
}

export interface AroundResult {
  command: CommandLogEntry;
  before: NetworkCaptureEntry[];
  after: NetworkCaptureEntry[];
  afterCount: number;
}

interface CommandSessionStore {
  entries: CommandLogEntry[];
  counter: number;
}

export class CommandLogStore {
  private stores = new Map<string, CommandSessionStore>();
  private maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  private getStore(sessionName: string): CommandSessionStore {
    let store = this.stores.get(sessionName);
    if (!store) {
      store = { entries: [], counter: 0 };
      this.stores.set(sessionName, store);
    }
    return store;
  }

  add(sessionName: string, entry: Omit<CommandLogEntry, 'id'>): void {
    const store = this.getStore(sessionName);
    store.counter += 1;
    const fullEntry: CommandLogEntry = { ...entry, id: store.counter };
    store.entries.push(fullEntry);
    if (store.entries.length > this.maxEntries) {
      store.entries.splice(0, store.entries.length - this.maxEntries);
    }
  }

  list(sessionName: string, options?: { limit?: number; offset?: number }): CommandLogEntry[] {
    const store = this.getStore(sessionName);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    return store.entries.slice(offset, offset + limit);
  }

  findEntry(sessionName: string, id: number): CommandLogEntry | null {
    const store = this.stores.get(sessionName);
    return store?.entries.find(e => e.id === id) ?? null;
  }

  clear(sessionName: string): void {
    this.stores.delete(sessionName);
  }

  clearAll(): void {
    this.stores.clear();
  }
}

export const commandLogStore = new CommandLogStore();

export const networkStore = new NetworkCaptureStore();
