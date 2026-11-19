/**
 * Unit tests for the site-memory SQLite store.
 *
 * Covers:
 * 1. defaultSiteMemoryPath
 * 2. putRun/getRun roundtrip + allowlist persistence (raw commands / page
 *    inputs must never reach the database)
 * 3. Idempotent run-id dedup (same store, sequential stores, concurrent
 *    stores on one file = cross-process semantics)
 * 4. Sealed-shape validation rejects malformed runs with sanitized errors
 * 5. Readonly mode (no writes, missing-file reads empty, corrupt/incompatible
 *    files throw instead of faking an empty database)
 * 6. close() idempotency; putRun throws on closed stores, reads stay safe
 * 7. Write failure exposure: a failed transaction must throw so a successful
 *    run is never believed saved
 * 8. listRuns / listSites
 * 9. getStats aggregation
 * 10. getBrief hints (verified candidates, most-recent wins, 30d recency,
 *    demotion by newer failures of the same definition)
 * 11. Schema version enforcement
 * 12. Per origin+flow history retention cap
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { defaultSiteMemoryPath, openSiteMemoryStore } from '../../src/site-memory/store.js';
import type { MemoryError, MemoryRun, SiteMemoryStore, StepAttempt } from '../../src/site-memory/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN = 'https://example.com';

let dbDir: string;
let dbPath: string;

function open(path = dbPath, opts?: { readonly?: boolean }): SiteMemoryStore {
  return openSiteMemoryStore(path, opts);
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'xb-site-memory-'));
  dbPath = join(dbDir, 'memory.sqlite');
});

afterEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

let runCounter = 0;

function makeAttempt(partial: Partial<StepAttempt> = {}): StepAttempt {
  const now = Date.now();
  return {
    stepId: 'step-click-login',
    operation: 'click',
    attempt: 1,
    startedAt: now - 5000,
    durationMs: 120,
    outcome: 'passed',
    ...partial,
  };
}

function makeRun(partial: Partial<MemoryRun> = {}): MemoryRun {
  runCounter += 1;
  const now = Date.now();
  return {
    runId: `run-${runCounter}`,
    origin: ORIGIN,
    flow: 'login',
    definitionKey: 'def-v1',
    startedAt: now - 60000,
    endedAt: now - 1000,
    outcome: 'passed',
    verified: true,
    attempts: [
      makeAttempt({ stepId: 'step-goto', operation: 'goto', startedAt: now - 60000, durationMs: 800 }),
      makeAttempt({ stepId: 'step-click-login', candidate: 0, startedAt: now - 5000 }),
    ],
    ...partial,
  };
}

describe('defaultSiteMemoryPath', () => {
  it('returns an absolute path under ~/.xbrowser without touching the filesystem', () => {
    const p = defaultSiteMemoryPath();
    expect(typeof p).toBe('string');
    expect(isAbsolute(p)).toBe(true);
    expect(p.startsWith(join(homedir(), '.xbrowser'))).toBe(true);
  });
});

describe('putRun / getRun', () => {
  it('persists a run and returns it with attempts in insertion order', () => {
    const store = open();
    const run = makeRun({
      attempts: [
        makeAttempt({ stepId: 's-goto', operation: 'goto', attempt: 1, durationMs: 800 }),
        makeAttempt({ stepId: 's-click', operation: 'click', attempt: 1, outcome: 'failed', errorCode: 'click-failed', candidate: 0, durationMs: 40 }),
        makeAttempt({ stepId: 's-click', operation: 'click', attempt: 2, outcome: 'passed', candidate: 1, source: 'memory', durationMs: 60 }),
        makeAttempt({ stepId: 's-assert', operation: 'expect-text', attempt: 1, outcome: 'passed' }),
      ],
    });
    store.putRun(run);
    expect(store.getRun(run.runId)).toStrictEqual(run);
    store.close();
  });

  it('drops unknown properties: raw commands and page inputs are never persisted', () => {
    const store = open();
    const clean = makeRun();
    const polluted = {
      ...clean,
      rawCommand: 'xbrowser fill "#pw" "hunter2"',
      pageInput: { password: 'hunter2' },
      attempts: clean.attempts.map((a, i) => ({
        ...a,
        rawCommand: `fill #field-${i} "secret-value"`,
        pageInput: { keys: 'secret' },
      })),
    };
    store.putRun(polluted as MemoryRun);
    expect(store.getRun(clean.runId)).toStrictEqual(clean);
    store.close();
  });

  it('returns null for unknown run ids', () => {
    const store = open();
    expect(store.getRun('does-not-exist')).toBeNull();
    store.close();
  });
});

describe('idempotent run dedup', () => {
  it('ignores duplicate puts of the same run id within one store', () => {
    const store = open();
    const run = makeRun();
    store.putRun(run);
    store.putRun(run);
    expect(store.listRuns(run.origin)).toHaveLength(1);
    store.close();
  });

  it('first write wins when the same run id is re-put with different content', () => {
    const store = open();
    const first = makeRun({ flow: 'login' });
    store.putRun(first);
    store.putRun(makeRun({ runId: first.runId, flow: 'logout' }));
    expect(store.getRun(first.runId)?.flow).toBe('login');
    store.close();
  });

  it('dedupes across sequentially opened stores (cross-process idempotency)', () => {
    const run = makeRun();
    const a = open();
    a.putRun(run);
    a.close();
    const b = open();
    b.putRun(makeRun({ runId: run.runId, flow: 'other-flow' }));
    b.close();
    const c = open();
    expect(c.listRuns(run.origin)).toHaveLength(1);
    expect(c.getRun(run.runId)?.flow).toBe('login');
    c.close();
  });

  it('dedupes with two stores open concurrently on the same file', () => {
    const run = makeRun();
    const s1 = open();
    const s2 = open();
    s1.putRun(run);
    s2.putRun(run);
    s1.close();
    s2.close();
    const s3 = open();
    expect(s3.listRuns(run.origin)).toHaveLength(1);
    s3.close();
  });
});

describe('sealed-shape validation', () => {
  const invalidRuns: Array<[string, MemoryRun]> = [
    ['empty run id', makeRun({ runId: '' })],
    ['non-string run id', makeRun({ runId: 42 as unknown as string })],
    ['oversized run id', makeRun({ runId: 'x'.repeat(200) })],
    ['empty origin', makeRun({ origin: '' })],
    ['non-string flow', makeRun({ flow: 7 as unknown as string })],
    ['empty definition key', makeRun({ definitionKey: '' })],
    ['unknown outcome', makeRun({ outcome: 'crashed' as MemoryRun['outcome'] })],
    ['non-boolean verified', makeRun({ verified: 'yes' as unknown as boolean })],
    ['endedAt before startedAt', makeRun({ startedAt: 2000, endedAt: 1000 })],
    ['non-finite startedAt', makeRun({ startedAt: Number.NaN })],
    ['attempts not an array', makeRun({ attempts: 'nope' as unknown as MemoryRun['attempts'] })],
    ['unknown step operation', makeRun({ attempts: [makeAttempt({ operation: 'scroll' as StepAttempt['operation'] })] })],
    ['unknown error code', makeRun({ attempts: [makeAttempt({ outcome: 'failed', errorCode: 'timeout' as MemoryError })] })],
    ['unknown source', makeRun({ attempts: [makeAttempt({ source: 'guess' as StepAttempt['source'] })] })],
    ['negative candidate', makeRun({ attempts: [makeAttempt({ candidate: -1 })] })],
    ['fractional candidate', makeRun({ attempts: [makeAttempt({ candidate: 1.5 })] })],
    ['negative duration', makeRun({ attempts: [makeAttempt({ durationMs: -3 })] })],
    ['empty step id', makeRun({ attempts: [makeAttempt({ stepId: '' })] })],
    ['oversized step id', makeRun({ attempts: [makeAttempt({ stepId: 'x'.repeat(400) })] })],
    ['attempt startedAt not a number', makeRun({ attempts: [makeAttempt({ startedAt: 'soon' as unknown as number })] })],
  ];

  it.each(invalidRuns)('rejects %s with a sanitized error and persists nothing', (_label, bad) => {
    const store = open();
    expect(() => store.putRun(bad)).toThrow(/site-memory: putRun rejected/);
    expect(store.listRuns(ORIGIN)).toHaveLength(0);
    store.close();
  });

  it('rejects non-object input with a single-line sanitized error', () => {
    const store = open();
    for (const bad of [null, 'run', 123]) {
      let message = '';
      try {
        store.putRun(bad as unknown as MemoryRun);
        expect.unreachable('putRun must throw on non-object input');
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/^site-memory: putRun rejected/);
      expect(message).not.toContain('\n');
    }
    expect(store.listRuns(ORIGIN)).toHaveLength(0);
    store.close();
  });

  it('rejects runs with more attempts than the safety cap', () => {
    const store = open();
    const attempts = Array.from({ length: 1001 }, () => makeAttempt());
    expect(() => store.putRun(makeRun({ attempts }))).toThrow(/site-memory: putRun rejected/);
    expect(store.listRuns(ORIGIN)).toHaveLength(0);
    store.close();
  });
});

describe('readonly mode', () => {
  it('serves reads and silently refuses writes', () => {
    const run = makeRun();
    const w = open();
    w.putRun(run);
    w.close();
    const ro = open(dbPath, { readonly: true });
    expect(ro.getRun(run.runId)).toStrictEqual(run);
    expect(() => ro.putRun(makeRun())).not.toThrow();
    expect(ro.listRuns(run.origin)).toHaveLength(1);
    ro.close();
    const w2 = open();
    expect(w2.listRuns(run.origin)).toHaveLength(1); // readonly put wrote nothing
    w2.close();
  });

  it('opens a missing database without creating the file and serves empty results', () => {
    const ro = open(dbPath, { readonly: true });
    expect(existsSync(dbPath)).toBe(false);
    expect(ro.listRuns(ORIGIN)).toEqual([]);
    expect(ro.getRun('x')).toBeNull();
    expect(ro.getStats(ORIGIN, 'login')).toEqual([]);
    expect(ro.listSites()).toEqual([]);
    expect(ro.getBrief(ORIGIN, 'login', 'def-v1')).toEqual({ origin: ORIGIN, flow: 'login', hints: [] });
    expect(() => ro.putRun(makeRun())).not.toThrow();
    ro.close();
    expect(existsSync(dbPath)).toBe(false);
  });

  it('throws a sanitized error when the file is not a database (must not read as empty)', () => {
    writeFileSync(dbPath, 'this is definitely not a sqlite database');
    expect(() => open(dbPath, { readonly: true })).toThrow(/site-memory: cannot open readonly/);
  });
});

describe('close', () => {
  it('is idempotent; putRun throws but reads stay safe and empty (no throws)', () => {
    const store = open();
    store.close();
    expect(() => store.close()).not.toThrow();
    expect(() => store.putRun(makeRun())).toThrow(/site-memory: putRun failed: store is closed/);
    expect(store.getRun('x')).toBeNull();
    expect(store.listSites()).toEqual([]);
    expect(store.listRuns(ORIGIN)).toEqual([]);
    expect(store.getStats(ORIGIN, 'login')).toEqual([]);
    expect(store.getBrief(ORIGIN, 'login', 'def-v1')).toEqual({ origin: ORIGIN, flow: 'login', hints: [] });
  });
});

describe('write failure exposure', () => {
  it('throws a sanitized error when the database write fails on valid input, then recovers', () => {
    const nodeRequire = createRequire(import.meta.url);
    const { DatabaseSync } = nodeRequire('node:sqlite') as {
      DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void };
    };

    const store = open();
    // A second connection holding the write lock makes the store's
    // transaction fail for real after the busy timeout.
    const blocker = new DatabaseSync(dbPath);
    blocker.exec('BEGIN EXCLUSIVE');

    const run = makeRun();
    let message = '';
    try {
      store.putRun(run);
      expect.unreachable('putRun must throw when the transaction cannot start');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^site-memory: putRun failed to persist run/);
    expect(message).not.toContain('\n');
    // the failed run was NOT saved
    expect(store.listRuns(run.origin)).toEqual([]);

    // after the lock is released the store is usable again and the retry persists
    blocker.exec('ROLLBACK');
    blocker.close();
    store.putRun(run);
    expect(store.listRuns(run.origin)).toHaveLength(1);
    store.close();
  });
});

describe('listRuns', () => {
  const base = Date.now() - 1_000_000;

  function seed(store: SiteMemoryStore): void {
    store.putRun(makeRun({ runId: 'a', flow: 'login', startedAt: base, endedAt: base + 100 }));
    store.putRun(makeRun({ runId: 'b', flow: 'login', startedAt: base + 500, endedAt: base + 600 }));
    store.putRun(makeRun({ runId: 'c', flow: 'logout', startedAt: base + 900, endedAt: base + 950 }));
  }

  it('filters by origin and flow and orders newest first', () => {
    const store = open();
    seed(store);
    expect(store.listRuns(ORIGIN).map((r) => r.runId)).toEqual(['c', 'b', 'a']);
    expect(store.listRuns(ORIGIN, 'login').map((r) => r.runId)).toEqual(['b', 'a']);
    expect(store.listRuns('https://other.com')).toEqual([]);
    store.close();
  });

  it('returns summaries without attempts', () => {
    const store = open();
    seed(store);
    expect(store.listRuns(ORIGIN, 'logout')).toStrictEqual([
      {
        runId: 'c',
        origin: ORIGIN,
        flow: 'logout',
        definitionKey: 'def-v1',
        startedAt: base + 900,
        endedAt: base + 950,
        outcome: 'passed',
        verified: true,
      },
    ]);
    store.close();
  });

  it('applies the limit and treats an invalid limit as the default', () => {
    const store = open();
    seed(store);
    expect(store.listRuns(ORIGIN, 'login', 1).map((r) => r.runId)).toEqual(['b']);
    expect(store.listRuns(ORIGIN, 'login', 0)).toHaveLength(2);
    expect(store.listRuns(ORIGIN, 'login', -5)).toHaveLength(2);
    store.close();
  });
});

describe('listSites', () => {
  it('aggregates runs per origin+flow', () => {
    const base = Date.now() - 1_000_000;
    const store = open();
    store.putRun(makeRun({ runId: 'a', flow: 'login', startedAt: base, endedAt: base + 10, outcome: 'passed' }));
    store.putRun(makeRun({ runId: 'b', flow: 'login', startedAt: base + 100, endedAt: base + 110, outcome: 'failed' }));
    store.putRun(makeRun({ runId: 'c', origin: 'https://other.com', flow: 'login', startedAt: base + 200, endedAt: base + 210, outcome: 'passed' }));
    expect(store.listSites()).toStrictEqual([
      { origin: ORIGIN, flow: 'login', runs: 2, passed: 1, lastRunAt: base + 100 },
      { origin: 'https://other.com', flow: 'login', runs: 1, passed: 1, lastRunAt: base + 200 },
    ]);
    store.close();
  });
});

describe('getStats', () => {
  it('aggregates executions, attempts, failures and errors per step', () => {
    const base = Date.now() - 1_000_000;
    const store = open();
    store.putRun(makeRun({
      runId: 'r1',
      startedAt: base,
      endedAt: base + 100,
      attempts: [
        makeAttempt({ stepId: 's1', operation: 'click', attempt: 1, outcome: 'failed', errorCode: 'click-failed', candidate: 0, startedAt: base }),
        makeAttempt({ stepId: 's1', operation: 'click', attempt: 2, outcome: 'passed', candidate: 1, startedAt: base + 10 }),
        makeAttempt({ stepId: 's2', operation: 'expect-text', attempt: 1, outcome: 'passed', startedAt: base + 20 }),
      ],
    }));
    store.putRun(makeRun({
      runId: 'r2',
      startedAt: base + 500,
      endedAt: base + 600,
      attempts: [makeAttempt({ stepId: 's1', operation: 'click', attempt: 1, outcome: 'passed', startedAt: base + 500 })],
    }));
    expect(store.getStats(ORIGIN, 'login')).toStrictEqual([
      {
        stepId: 's1',
        operation: 'click',
        executions: 2,
        attempts: 3,
        failedAttempts: 1,
        passedExecutions: 2,
        errors: { 'click-failed': 1 },
      },
      {
        stepId: 's2',
        operation: 'expect-text',
        executions: 1,
        attempts: 1,
        failedAttempts: 0,
        passedExecutions: 1,
        errors: {},
      },
    ]);
    expect(store.getStats(ORIGIN, 'unknown-flow')).toEqual([]);
    store.close();
  });
});

describe('getBrief', () => {
  it('emits candidate hints only from passed attempts of passed+verified runs', () => {
    const startedAt = Date.now() - 61_000;
    const endedAt = Date.now() - 60_000;
    const store = open();
    store.putRun(makeRun({
      runId: 'r1',
      startedAt,
      endedAt,
      attempts: [
        makeAttempt({ stepId: 's1', operation: 'goto', outcome: 'passed' }),
        makeAttempt({ stepId: 's2', operation: 'click', outcome: 'failed', errorCode: 'click-failed', candidate: 4 }),
        makeAttempt({ stepId: 's2', operation: 'click', outcome: 'passed', candidate: 5, source: 'memory' }),
      ],
    }));
    expect(store.getBrief(ORIGIN, 'login', 'def-v1')).toStrictEqual({
      origin: ORIGIN,
      flow: 'login',
      hints: [{ stepId: 's2', candidate: 5, verifiedAt: endedAt }],
    });
    store.close();
  });

  it('emits no hints for failed runs or unverified runs', () => {
    const store = open();
    store.putRun(makeRun({ runId: 'f1', outcome: 'failed', verified: true }));
    store.putRun(makeRun({ runId: 'u1', outcome: 'passed', verified: false }));
    expect(store.getBrief(ORIGIN, 'login', 'def-v1').hints).toEqual([]);
    store.close();
  });

  it('keeps only the most recent candidate observation per step', () => {
    const now = Date.now();
    const store = open();
    store.putRun(makeRun({ runId: 'r1', startedAt: now - 200_500, endedAt: now - 200_000, attempts: [makeAttempt({ stepId: 's2', candidate: 1 })] }));
    store.putRun(makeRun({ runId: 'r2', startedAt: now - 100_500, endedAt: now - 100_000, attempts: [makeAttempt({ stepId: 's2', candidate: 2 })] }));
    expect(store.getBrief(ORIGIN, 'login', 'def-v1').hints).toEqual([
      { stepId: 's2', candidate: 2, verifiedAt: now - 100_000 },
    ]);
    store.close();
  });

  it('drops hints older than 30 days and keeps fresher ones', () => {
    const now = Date.now();
    const store = open();
    store.putRun(makeRun({
      runId: 'old',
      startedAt: now - 31 * DAY_MS - 10_000,
      endedAt: now - 31 * DAY_MS - 5_000,
      attempts: [makeAttempt({ stepId: 's-old', candidate: 1, startedAt: now - 31 * DAY_MS - 10_000 })],
    }));
    store.putRun(makeRun({
      runId: 'fresh',
      startedAt: now - 29 * DAY_MS,
      endedAt: now - 29 * DAY_MS + 1_000,
      attempts: [makeAttempt({ stepId: 's-new', candidate: 2, startedAt: now - 29 * DAY_MS })],
    }));
    const hints = store.getBrief(ORIGIN, 'login', 'def-v1').hints;
    expect(hints.map((h) => h.stepId)).toEqual(['s-new']);
    store.close();
  });

  it('demotes hints when a newer run of the same definition fails, and restores them after re-verification', () => {
    const now = Date.now();
    const store = open();
    store.putRun(makeRun({
      runId: 'r1',
      startedAt: now - 300_500,
      endedAt: now - 300_000,
      attempts: [
        makeAttempt({ stepId: 's1', candidate: 7 }),
        makeAttempt({ stepId: 's2', candidate: 3 }),
      ],
    }));
    // failure for the same definition demotes both stale hints
    store.putRun(makeRun({ runId: 'rf', outcome: 'failed', startedAt: now - 200_500, endedAt: now - 200_000 }));
    expect(store.getBrief(ORIGIN, 'login', 'def-v1').hints).toEqual([]);
    // later re-verification revives only the step it covers
    store.putRun(makeRun({
      runId: 'r3',
      startedAt: now - 100_500,
      endedAt: now - 100_000,
      attempts: [makeAttempt({ stepId: 's2', candidate: 4 })],
    }));
    expect(store.getBrief(ORIGIN, 'login', 'def-v1').hints).toEqual([
      { stepId: 's2', candidate: 4, verifiedAt: now - 100_000 },
    ]);
    store.close();
  });

  it('does not demote hints on failures of a different definition', () => {
    const now = Date.now();
    const store = open();
    store.putRun(makeRun({ runId: 'r1', definitionKey: 'def-v1', startedAt: now - 300_500, endedAt: now - 300_000, attempts: [makeAttempt({ stepId: 's2', candidate: 9 })] }));
    store.putRun(makeRun({ runId: 'rf', definitionKey: 'def-v2', outcome: 'failed', startedAt: now - 100_500, endedAt: now - 100_000 }));
    expect(store.getBrief(ORIGIN, 'login', 'def-v1').hints).toEqual([
      { stepId: 's2', candidate: 9, verifiedAt: now - 300_000 },
    ]);
    store.close();
  });
});

describe('schema version enforcement', () => {
  it('refuses to open a database with an unsupported version in both modes', () => {
    const run = makeRun();
    const w = open();
    w.putRun(run);
    w.close();

    const nodeRequire = createRequire(import.meta.url);
    const { DatabaseSync } = nodeRequire('node:sqlite') as {
      DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void };
    };
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA user_version = 999;');
    raw.close();

    expect(() => open(dbPath)).toThrow(/version/i);
    // an incompatible readonly database must not masquerade as an empty one
    expect(() => open(dbPath, { readonly: true })).toThrow(/version/i);
  });
});

describe('history retention', () => {
  it('keeps only the most recent 200 runs per origin+flow', () => {
    const base = Date.now() - 1_000_000;
    const store = open();
    for (let i = 0; i < 205; i++) {
      store.putRun(makeRun({ runId: `r-${i}`, startedAt: base + i, endedAt: base + i + 10 }));
    }
    const all = store.listRuns(ORIGIN, 'login', 1000);
    expect(all).toHaveLength(200);
    expect(all[0].runId).toBe('r-204');
    expect(all.map((r) => r.runId)).not.toContain('r-0');
    expect(store.getRun('r-0')).toBeNull();
    expect(store.getRun('r-204')).not.toBeNull();
    store.close();
  });

  it('retention is per flow', () => {
    const base = Date.now() - 1_000_000;
    const store = open();
    for (let i = 0; i < 205; i++) {
      store.putRun(makeRun({ runId: `r-${i}`, startedAt: base + i, endedAt: base + i + 10 }));
    }
    for (let i = 0; i < 3; i++) {
      store.putRun(makeRun({ runId: `lo-${i}`, flow: 'logout', startedAt: base + 1000 + i, endedAt: base + 1000 + i + 10 }));
    }
    expect(store.listRuns(ORIGIN, 'logout', 1000)).toHaveLength(3);
    store.close();
  });
});
