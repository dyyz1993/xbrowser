/**
 * Local site execution memory — SQLite-backed store for browser flow runs.
 *
 * Persistence contract (pinned by tests/site-memory/store.test.ts):
 * - Only allowlisted contract fields are persisted. Raw commands, page inputs
 *   and any other extra properties never reach the database.
 * - Runs are validated against the sealed data shape before persist. On a
 *   writable store a malformed run is rejected with a sanitized error — a
 *   caller must never believe an unsupported shape was saved. putRun also
 *   throws sanitized errors for real persistence failures (transaction,
 *   pruning, locked/unavailable database, closed store), so a successful
 *   browser run is never silently mistaken for a saved one. putRun on an
 *   explicitly readonly store is a silent no-op.
 * - Read queries never throw (blind-model safety): they return empty results
 *   on closed or broken stores.
 * - putRun is transactional and idempotent on run id (first write wins),
 *   safe across processes (WAL journal + busy timeout + IMMEDIATE locks).
 * - Briefs expose only candidate observations from passed attempts of runs
 *   that completed successfully with explicit `verified: true`, within the
 *   last 30 days. A newer failed run for the same definitionKey demotes the
 *   stale hints until they are re-verified after that failure.
 * - History retention: at most MAX_RUNS_PER_SITE_FLOW most recent runs are
 *   kept per (origin, flow); older runs (and their attempts) are pruned in
 *   the same transaction as the insert.
 * - node:sqlite (Node >= 22.13) is loaded lazily through createRequire with
 *   structural types, so a repo pinned to @types/node 20 still typechecks.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type {
  MemoryError,
  MemoryOutcome,
  MemoryRun,
  RunSummary,
  SiteBrief,
  SiteHint,
  SiteMemoryStore,
  SiteSummary,
  StepAttempt,
  StepOperation,
  StepStats,
} from './types.js';

type AttemptSource = 'definition' | 'memory';

// ---------------------------------------------------------------------------
// Lazy node:sqlite loading (structural adapter; repo @types/node is 20)
// ---------------------------------------------------------------------------

interface SqliteResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteDatabaseConstructor = new (
  location: string,
  options?: { open?: boolean; readOnly?: boolean },
) => SqliteDatabase;

let databaseSyncCtor: SqliteDatabaseConstructor | undefined;

function loadDatabaseSync(): SqliteDatabaseConstructor {
  if (!databaseSyncCtor) {
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire('node:sqlite') as { DatabaseSync: SqliteDatabaseConstructor };
    databaseSyncCtor = mod.DatabaseSync;
  }
  return databaseSyncCtor;
}

// ---------------------------------------------------------------------------
// Limits and schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;
const BUSY_TIMEOUT_MS = 5_000;
/** Briefs only expose hints verified within the last 30 days. */
const BRIEF_RECENCY_MS = 30 * 24 * 60 * 60 * 1000;
/** History retention cap per (origin, flow). */
const MAX_RUNS_PER_SITE_FLOW = 200;
const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 1_000;
const MAX_ATTEMPTS_PER_RUN = 1_000;
const MAX_RUN_ID_LENGTH = 128;
const MAX_KEY_LENGTH = 512;
const MAX_STEP_ID_LENGTH = 256;

const OPERATIONS: readonly StepOperation[] = ['goto', 'click', 'expect-text'];
const OUTCOMES: readonly MemoryOutcome[] = ['passed', 'failed'];
const ERROR_CODES: readonly MemoryError[] = [
  'browser-error',
  'navigation-failed',
  'origin-changed',
  'selector-not-ready',
  'click-failed',
  'assertion-failed',
];
const SOURCES: readonly AttemptSource[] = ['definition', 'memory'];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS runs (
    run_id         TEXT PRIMARY KEY,
    origin         TEXT NOT NULL,
    flow           TEXT NOT NULL,
    definition_key TEXT NOT NULL,
    started_at     REAL NOT NULL,
    ended_at       REAL NOT NULL,
    outcome        TEXT NOT NULL,
    verified       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_site_time ON runs (origin, flow, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_definition ON runs (origin, flow, definition_key, ended_at DESC);

  CREATE TABLE IF NOT EXISTS run_attempts (
    attempt_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id         TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
    seq            INTEGER NOT NULL,
    step_id        TEXT NOT NULL,
    operation      TEXT NOT NULL,
    attempt_no     INTEGER NOT NULL,
    started_at     REAL NOT NULL,
    duration_ms    REAL NOT NULL,
    outcome        TEXT NOT NULL,
    error_code     TEXT,
    candidate      INTEGER,
    source         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_run ON run_attempts (run_id, seq);
`;

const SQL_INSERT_RUN = `
  INSERT INTO runs (run_id, origin, flow, definition_key, started_at, ended_at, outcome, verified)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (run_id) DO NOTHING
`;

const SQL_INSERT_ATTEMPT = `
  INSERT INTO run_attempts
    (run_id, seq, step_id, operation, attempt_no, started_at, duration_ms, outcome, error_code, candidate, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SQL_PRUNE_RUNS = `
  DELETE FROM runs
  WHERE origin = ? AND flow = ?
    AND run_id NOT IN (
      SELECT run_id FROM runs WHERE origin = ? AND flow = ?
      ORDER BY started_at DESC, rowid DESC LIMIT ?
    )
`;

const SQL_GET_RUN = `
  SELECT run_id, origin, flow, definition_key, started_at, ended_at, outcome, verified
  FROM runs WHERE run_id = ?
`;

const SQL_GET_ATTEMPTS = `
  SELECT step_id, operation, attempt_no, started_at, duration_ms, outcome, error_code, candidate, source
  FROM run_attempts WHERE run_id = ?
  ORDER BY seq ASC, attempt_row_id ASC
`;

const SQL_LIST_RUNS_BY_ORIGIN = `
  SELECT run_id, origin, flow, definition_key, started_at, ended_at, outcome, verified
  FROM runs WHERE origin = ?
  ORDER BY started_at DESC, rowid DESC LIMIT ?
`;

const SQL_LIST_RUNS_BY_ORIGIN_FLOW = `
  SELECT run_id, origin, flow, definition_key, started_at, ended_at, outcome, verified
  FROM runs WHERE origin = ? AND flow = ?
  ORDER BY started_at DESC, rowid DESC LIMIT ?
`;

const SQL_LIST_SITES = `
  SELECT origin, flow, COUNT(*) AS runs,
         SUM(CASE WHEN outcome = 'passed' THEN 1 ELSE 0 END) AS passed,
         MAX(started_at) AS last_run_at
  FROM runs
  GROUP BY origin, flow
  ORDER BY origin ASC, flow ASC
`;

const SQL_STATS_ROWS = `
  SELECT r.run_id AS run_id, a.step_id AS step_id, a.operation AS operation,
         a.outcome AS outcome, a.error_code AS error_code
  FROM runs r JOIN run_attempts a ON a.run_id = r.run_id
  WHERE r.origin = ? AND r.flow = ?
  ORDER BY r.started_at ASC, r.rowid ASC, a.attempt_row_id ASC
`;

const SQL_HINT_ROWS = `
  SELECT a.step_id AS step_id, a.candidate AS candidate, r.ended_at AS ended_at
  FROM runs r JOIN run_attempts a ON a.run_id = r.run_id
  WHERE r.origin = ? AND r.flow = ? AND r.definition_key = ?
    AND r.outcome = 'passed' AND r.verified = 1
    AND a.outcome = 'passed' AND a.candidate IS NOT NULL
  ORDER BY r.ended_at DESC, a.attempt_row_id DESC
`;

const SQL_MAX_FAILED = `
  SELECT MAX(ended_at) AS max_failed
  FROM runs
  WHERE origin = ? AND flow = ? AND definition_key = ? AND outcome = 'failed'
`;

// ---------------------------------------------------------------------------
// Sealed-shape validation (allowlist write only)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return value;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, allow: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  return (allow as readonly string[]).includes(value) ? (value as T) : null;
}

function parseAttempt(raw: unknown): StepAttempt | null {
  if (!isPlainObject(raw)) return null;
  const stepId = boundedString(raw.stepId, MAX_STEP_ID_LENGTH);
  if (!stepId) return null;
  const operation = oneOf<StepOperation>(raw.operation, OPERATIONS);
  if (!operation) return null;
  if (typeof raw.attempt !== 'number' || !Number.isInteger(raw.attempt) || raw.attempt < 0) return null;
  const startedAt = finiteNumber(raw.startedAt);
  if (startedAt === null) return null;
  const durationMs = finiteNumber(raw.durationMs);
  if (durationMs === null || durationMs < 0) return null;
  const outcome = oneOf<MemoryOutcome>(raw.outcome, OUTCOMES);
  if (!outcome) return null;

  const attempt: StepAttempt = { stepId, operation, attempt: raw.attempt, startedAt, durationMs, outcome };
  if (raw.errorCode !== undefined && raw.errorCode !== null) {
    const errorCode = oneOf<MemoryError>(raw.errorCode, ERROR_CODES);
    if (!errorCode) return null;
    attempt.errorCode = errorCode;
  }
  if (raw.candidate !== undefined && raw.candidate !== null) {
    if (typeof raw.candidate !== 'number' || !Number.isInteger(raw.candidate) || raw.candidate < 0) return null;
    attempt.candidate = raw.candidate;
  }
  if (raw.source !== undefined && raw.source !== null) {
    const source = oneOf<AttemptSource>(raw.source, SOURCES);
    if (!source) return null;
    attempt.source = source;
  }
  return attempt;
}

function parseMemoryRun(input: unknown): MemoryRun | null {
  if (!isPlainObject(input)) return null;
  const runId = boundedString(input.runId, MAX_RUN_ID_LENGTH);
  if (!runId) return null;
  const origin = boundedString(input.origin, MAX_KEY_LENGTH);
  if (!origin) return null;
  const flow = boundedString(input.flow, MAX_KEY_LENGTH);
  if (!flow) return null;
  const definitionKey = boundedString(input.definitionKey, MAX_KEY_LENGTH);
  if (!definitionKey) return null;
  const startedAt = finiteNumber(input.startedAt);
  if (startedAt === null) return null;
  const endedAt = finiteNumber(input.endedAt);
  if (endedAt === null || endedAt < startedAt) return null;
  const outcome = oneOf<MemoryOutcome>(input.outcome, OUTCOMES);
  if (!outcome) return null;
  if (typeof input.verified !== 'boolean') return null;
  if (!Array.isArray(input.attempts) || input.attempts.length > MAX_ATTEMPTS_PER_RUN) return null;

  const attempts: StepAttempt[] = [];
  for (const raw of input.attempts) {
    const attempt = parseAttempt(raw);
    if (!attempt) return null;
    attempts.push(attempt);
  }
  return { runId, origin, flow, definitionKey, startedAt, endedAt, outcome, verified: input.verified, attempts };
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toOperation(value: unknown): StepOperation {
  return value === 'goto' || value === 'expect-text' ? value : 'click';
}

function rowToRunSummary(row: Record<string, unknown>): RunSummary {
  return {
    runId: String(row.run_id),
    origin: String(row.origin),
    flow: String(row.flow),
    definitionKey: String(row.definition_key),
    startedAt: Number(row.started_at),
    endedAt: Number(row.ended_at),
    outcome: row.outcome === 'passed' ? 'passed' : 'failed',
    verified: Number(row.verified) === 1,
  };
}

function rowToAttempt(row: Record<string, unknown>): StepAttempt {
  const attempt: StepAttempt = {
    stepId: String(row.step_id),
    operation: toOperation(row.operation),
    attempt: Number(row.attempt_no),
    startedAt: Number(row.started_at),
    durationMs: Number(row.duration_ms),
    outcome: row.outcome === 'passed' ? 'passed' : 'failed',
  };
  if (typeof row.error_code === 'string') attempt.errorCode = row.error_code as MemoryError;
  if (row.candidate !== null && row.candidate !== undefined) attempt.candidate = Number(row.candidate);
  if (typeof row.source === 'string') attempt.source = row.source as AttemptSource;
  return attempt;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return DEFAULT_RUN_LIMIT;
  return Math.min(Math.floor(limit), MAX_RUN_LIMIT);
}

// ---------------------------------------------------------------------------
// Stats aggregation (executions = distinct run × step groups)
// ---------------------------------------------------------------------------

interface ExecutionGroup {
  stepId: string;
  hasPassed: boolean;
}

interface StepBucket {
  stepId: string;
  order: number;
  operation: StepOperation;
  executions: number;
  attempts: number;
  failedAttempts: number;
  passedExecutions: number;
  errors: Map<MemoryError, number>;
}

function aggregateStats(rows: Record<string, unknown>[]): StepStats[] {
  const executions = new Map<string, ExecutionGroup>();
  const steps = new Map<string, StepBucket>();
  let order = 0;

  for (const row of rows) {
    const runId = String(row.run_id);
    const stepId = String(row.step_id);
    const operation = toOperation(row.operation);

    let step = steps.get(stepId);
    if (!step) {
      step = { stepId, order: order++, operation, executions: 0, attempts: 0, failedAttempts: 0, passedExecutions: 0, errors: new Map() };
      steps.set(stepId, step);
    }

    const execKey = `${runId}\u0000${stepId}`;
    let exec = executions.get(execKey);
    if (!exec) {
      exec = { stepId, hasPassed: false };
      executions.set(execKey, exec);
      step.executions += 1;
    }

    step.attempts += 1;
    step.operation = operation; // rows arrive in ascending order → last row wins
    if (row.outcome === 'failed') {
      step.failedAttempts += 1;
      if (typeof row.error_code === 'string') {
        const code = row.error_code as MemoryError;
        step.errors.set(code, (step.errors.get(code) ?? 0) + 1);
      }
    } else {
      exec.hasPassed = true;
    }
  }

  for (const exec of executions.values()) {
    const step = steps.get(exec.stepId);
    if (exec.hasPassed && step) step.passedExecutions += 1;
  }

  return [...steps.values()]
    .sort((a, b) => a.order - b.order)
    .map((step) => ({
      stepId: step.stepId,
      operation: step.operation,
      executions: step.executions,
      attempts: step.attempts,
      failedAttempts: step.failedAttempts,
      passedExecutions: step.passedExecutions,
      errors: Object.fromEntries(step.errors) as Partial<Record<MemoryError, number>>,
    }));
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

class SqliteSiteMemoryStore implements SiteMemoryStore {
  private readonly db: SqliteDatabase;
  private readonly statements = new Map<string, SqliteStatement>();
  private readonly readOnly: boolean;
  private closed = false;

  constructor(db: SqliteDatabase, readOnly: boolean) {
    this.db = db;
    this.readOnly = readOnly;
  }

  private stmt(key: string, sql: string): SqliteStatement {
    let statement = this.statements.get(key);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(key, statement);
    }
    return statement;
  }

  putRun(run: MemoryRun): void {
    if (this.readOnly) return; // explicitly readonly store: writes are a silent no-op
    if (this.closed) {
      throw sanitizeError('putRun failed: store is closed');
    }
    const clean = parseMemoryRun(run);
    if (!clean) {
      // Sealed-shape validation failed: reject loudly so an unsupported shape
      // is never mistaken for a persisted run.
      const runIdHint = isPlainObject(run) && typeof run.runId === 'string'
        ? ` (runId "${run.runId.slice(0, MAX_RUN_ID_LENGTH)}")`
        : '';
      throw sanitizeError(`putRun rejected a run that does not match the sealed MemoryRun shape${runIdHint}`);
    }
    try {
      this.writeRun(clean);
    } catch (err) {
      // A successful browser run must never be believed saved when the
      // transaction, pruning or database itself failed.
      throw sanitizeError('putRun failed to persist run', err);
    }
  }

  private writeRun(run: MemoryRun): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = this.stmt('insert-run', SQL_INSERT_RUN).run(
        run.runId,
        run.origin,
        run.flow,
        run.definitionKey,
        run.startedAt,
        run.endedAt,
        run.outcome,
        run.verified ? 1 : 0,
      );
      if (Number(inserted.changes) === 1) {
        const insertAttempt = this.stmt('insert-attempt', SQL_INSERT_ATTEMPT);
        for (let i = 0; i < run.attempts.length; i++) {
          const attempt = run.attempts[i];
          insertAttempt.run(
            run.runId,
            i,
            attempt.stepId,
            attempt.operation,
            attempt.attempt,
            attempt.startedAt,
            attempt.durationMs,
            attempt.outcome,
            attempt.errorCode ?? null,
            attempt.candidate ?? null,
            attempt.source ?? null,
          );
        }
        this.stmt('prune-runs', SQL_PRUNE_RUNS).run(
          run.origin,
          run.flow,
          run.origin,
          run.flow,
          MAX_RUNS_PER_SITE_FLOW,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Connection may already be unusable; nothing else to do.
      }
      throw err;
    }
  }

  listSites(): SiteSummary[] {
    if (this.closed) return [];
    try {
      const rows = this.stmt('list-sites', SQL_LIST_SITES).all() as unknown[];
      return rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          origin: String(r.origin),
          flow: String(r.flow),
          runs: Number(r.runs),
          passed: Number(r.passed),
          lastRunAt: Number(r.last_run_at),
        };
      });
    } catch {
      return [];
    }
  }

  listRuns(origin: string, flow?: string, limit?: number): RunSummary[] {
    if (this.closed) return [];
    try {
      const capped = normalizeLimit(limit);
      const rows =
        flow === undefined
          ? (this.stmt('list-runs-origin', SQL_LIST_RUNS_BY_ORIGIN).all(origin, capped) as unknown[])
          : (this.stmt('list-runs-origin-flow', SQL_LIST_RUNS_BY_ORIGIN_FLOW).all(origin, flow, capped) as unknown[]);
      return rows.map((row) => rowToRunSummary(row as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  getRun(runId: string): MemoryRun | null {
    if (this.closed) return null;
    try {
      const row = this.stmt('get-run', SQL_GET_RUN).get(runId);
      if (!row) return null;
      const attempts = (this.stmt('get-attempts', SQL_GET_ATTEMPTS).all(runId) as unknown[]).map((r) =>
        rowToAttempt(r as Record<string, unknown>),
      );
      return { ...rowToRunSummary(row as Record<string, unknown>), attempts };
    } catch {
      return null;
    }
  }

  getStats(origin: string, flow: string): StepStats[] {
    if (this.closed) return [];
    try {
      const rows = (this.stmt('stats-rows', SQL_STATS_ROWS).all(origin, flow) as unknown[]).map(
        (row) => row as Record<string, unknown>,
      );
      return aggregateStats(rows);
    } catch {
      return [];
    }
  }

  getBrief(origin: string, flow: string, definitionKey: string): SiteBrief {
    if (this.closed) return { origin, flow, hints: [] };
    try {
      const now = Date.now();
      const failedRow = this.stmt('max-failed', SQL_MAX_FAILED).get(origin, flow, definitionKey) as
        | Record<string, unknown>
        | null
        | undefined;
      const maxFailed =
        failedRow && failedRow.max_failed !== null && failedRow.max_failed !== undefined
          ? Number(failedRow.max_failed)
          : null;

      const hintRows = (this.stmt('hint-rows', SQL_HINT_ROWS).all(origin, flow, definitionKey) as unknown[]).map(
        (row) => row as Record<string, unknown>,
      );
      const hints: SiteHint[] = [];
      const seenSteps = new Set<string>();
      for (const row of hintRows) {
        const stepId = String(row.step_id);
        if (seenSteps.has(stepId)) continue; // only the most recent observation per step
        seenSteps.add(stepId);
        const verifiedAt = Number(row.ended_at);
        if (verifiedAt < now - BRIEF_RECENCY_MS) continue; // 30-day recency
        if (maxFailed !== null && verifiedAt <= maxFailed) continue; // demoted by a newer failure of this definition
        hints.push({ stepId, candidate: Number(row.candidate), verifiedAt });
      }
      hints.sort((a, b) => (a.stepId < b.stepId ? -1 : a.stepId > b.stepId ? 1 : 0));
      return { origin, flow, hints };
    } catch {
      return { origin, flow, hints: [] };
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.statements.clear();
    try {
      this.db.close();
    } catch {
      // Already closed or broken connection; nothing to do.
    }
  }
}

// ---------------------------------------------------------------------------
// Open helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wrap a low-level failure into a single-line, prefix-stable Error.
 * Only the (safe) message text of the original error survives — no stacks,
 * no SQL dumps, no multi-line driver output.
 */
function sanitizeError(scope: string, err?: unknown): Error {
  const raw = err === undefined ? '' : errorMessage(err);
  const reason = raw.split('\n')[0].trim();
  return new Error(`site-memory: ${scope}${reason ? `: ${reason}` : ''}`);
}

function readVersion(db: SqliteDatabase): number {
  const row = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | null | undefined;
  return row ? Number(row.user_version) : 0;
}

function hasRunsTable(db: SqliteDatabase): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() != null;
}

function initSchema(db: SqliteDatabase): void {
  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

function createEmptyVolatileStore(DatabaseSyncCtor: SqliteDatabaseConstructor): SiteMemoryStore {
  const db = new DatabaseSyncCtor(':memory:');
  initSchema(db);
  return new SqliteSiteMemoryStore(db, true); // volatile store is effectively read-only
}

function openWritableStore(dbPath: string): SiteMemoryStore {
  const DatabaseSyncCtor = loadDatabaseSync();
  const resolved = resolve(dbPath);
  try {
    mkdirSync(dirname(resolved), { recursive: true });
  } catch (err) {
    throw sanitizeError(`cannot create directory for site-memory database at ${resolved}`, err);
  }

  let db: SqliteDatabase;
  try {
    db = new DatabaseSyncCtor(resolved);
  } catch (err) {
    throw sanitizeError(`cannot open site-memory database at ${resolved}`, err);
  }

  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');

    const version = readVersion(db);
    if (version === SCHEMA_VERSION) {
      return new SqliteSiteMemoryStore(db, false);
    }
    if (version === 0 && !hasRunsTable(db)) {
      initSchema(db);
      return new SqliteSiteMemoryStore(db, false);
    }
    if (version === 0) {
      throw new Error(`database at ${resolved} has tables but no schema version; refusing to touch it`);
    }
    throw new Error(`schema version ${version} at ${resolved} is not supported (expected ${SCHEMA_VERSION})`);
  } catch (err) {
    try {
      db.close();
    } catch {
      // Secondary close failure must not mask the original error.
    }
    throw sanitizeError('cannot open writable site-memory database', err);
  }
}

function openReadonlyStore(dbPath: string): SiteMemoryStore {
  const DatabaseSyncCtor = loadDatabaseSync();
  // Only a missing database may read as empty — a hint-absent but healthy
  // database. Corrupt or incompatible files must fail loudly instead of
  // masquerading as "no memory".
  if (!existsSync(dbPath)) {
    return createEmptyVolatileStore(DatabaseSyncCtor);
  }
  let db: SqliteDatabase | undefined;
  try {
    db = new DatabaseSyncCtor(dbPath, { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    const version = readVersion(db);
    if (version !== SCHEMA_VERSION) {
      throw new Error(`schema version ${version} is not supported (expected ${SCHEMA_VERSION})`);
    }
    return new SqliteSiteMemoryStore(db, true);
  } catch (err) {
    if (db) {
      try {
        db.close();
      } catch {
        // Secondary close failure must not mask the original error.
      }
    }
    throw sanitizeError(`cannot open readonly site-memory database at ${dbPath}`, err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function defaultSiteMemoryPath(): string {
  return join(homedir(), '.xbrowser', 'site-memory', 'site-memory.sqlite');
}

export function openSiteMemoryStore(dbPath: string, opts?: { readonly?: boolean }): SiteMemoryStore {
  return opts?.readonly === true ? openReadonlyStore(dbPath) : openWritableStore(dbPath);
}
