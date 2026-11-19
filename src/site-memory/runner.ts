/**
 * Site-memory workflow runner.
 *
 * Executes an explicit, opt-in JSON flow definition against one page obtained
 * from a caller-provided `openPage` callback, and records a privacy-safe
 * `MemoryRun` (attempts with fixed `MemoryError` codes only — never raw
 * selectors, paths, expected text, or exception messages).
 *
 * Hard guarantees (pinned by tests/site-memory/runner.test.ts):
 * - Invalid spec ⇒ `SiteMemorySpecError`; no browser is started and the store
 *   is not touched (no `getBrief`, no `putRun`).
 * - Origin safety: only http(s) origins without credentials; paths resolve
 *   same-origin; every action (click / expect-text) and the post-goto state
 *   are origin-guarded, so cross-origin drift — including late, unexpected
 *   redirects — aborts the run with `origin-changed` before anything is sent.
 * - A click dispatches at most once: candidate fallback happens only while
 *   probing (before the action); after a dispatch there is no retry and no
 *   automatic resubmit. Every candidate probe is recorded as an attempt.
 * - The final step must be `expect-text` and is the verification proof; a run
 *   is `verified` only when it passes.
 * - Preflight: the definition key is SHA-256 over a normalized, versioned
 *   canonical form of the spec. A prior verified matching candidate index
 *   (from `store.getBrief`) may reorder click probes; warm runs still re-probe
 *   everything. `options.cold` skips memory entirely.
 * - Exactly one `putRun` per executed run, after the page is closed. The
 *   runner owns the page lifetime from the `openPage` callback: `close()` is
 *   invoked exactly once, even on failure (close errors are swallowed so they
 *   cannot mask the run result).
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
  MemoryError,
  MemoryRun,
  SiteHint,
  SiteMemoryStore,
  StepAttempt,
} from './types.js';

// ────────────────────────────────────────────────────────────────
// Public surface
// ────────────────────────────────────────────────────────────────

/**
 * Minimal structural page contract. The runtime `XBPage` satisfies this
 * without adaptation; tests use plain mocks. `waitForTimeout` is optional —
 * the runner falls back to an internal sleep when absent.
 */
export interface WorkflowPage {
  goto(url: string, opts?: { timeout?: number }): Promise<unknown>;
  url(): string;
  locator(selector: string): WorkflowLocator;
  waitForTimeout?(ms: number): Promise<void>;
}

/** Minimal locator contract used by the runner. */
export interface WorkflowLocator {
  waitFor(opts?: {
    state?: 'visible' | 'attached' | 'hidden' | 'detached';
    timeout?: number;
  }): Promise<void>;
  click(opts?: { timeout?: number }): Promise<void>;
  textContent(): Promise<string | null>;
}

/** Thrown (never persisted) when the opt-in spec is invalid. */
export class SiteMemorySpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteMemorySpecError';
  }
}

export interface RunWorkflowOptions {
  /** Cold runs skip the memory preflight entirely (definition probe order). */
  cold?: boolean;
}

export type OpenPage = () => Promise<{
  page: WorkflowPage;
  close: () => Promise<void>;
}>;

export async function runWorkflow(
  raw: unknown,
  store: Pick<SiteMemoryStore, 'putRun' | 'getBrief'>,
  openPage: OpenPage,
  options?: RunWorkflowOptions
): Promise<MemoryRun> {
  const parsed = parseSpec(raw);
  const definitionKey = computeDefinitionKey(parsed);
  const hints = options?.cold
    ? new Map<string, SiteHint>()
    : readHints(store, parsed, definitionKey);

  const attempts: StepAttempt[] = [];
  const run: MemoryRun = {
    runId: randomUUID(),
    origin: parsed.origin,
    flow: parsed.flow,
    definitionKey,
    startedAt: Date.now(),
    endedAt: 0,
    outcome: 'failed',
    verified: false,
    attempts,
  };

  let handle: Awaited<ReturnType<OpenPage>> | undefined;
  let allPassed = false;
  try {
    let page: WorkflowPage | undefined;
    try {
      handle = await openPage();
      page = handle.page;
    } catch {
      recordLaunchFailure(parsed, attempts);
    }
    if (page) {
      allPassed = await executeSteps(parsed, page, hints, attempts);
    }
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (closeError) {
        // Close is best-effort; a failing close must not mask the run result.
        void closeError;
      }
    }
  }

  run.endedAt = Date.now();
  run.outcome = allPassed ? 'passed' : 'failed';
  run.verified = allPassed;
  store.putRun(run);
  return run;
}

// ────────────────────────────────────────────────────────────────
// Spec model + validation (explicit opt-in, strict)
// ────────────────────────────────────────────────────────────────

interface GotoStep {
  id: string;
  op: 'goto';
  path: string;
}
interface ClickStep {
  id: string;
  op: 'click';
  selectors: string[];
}
interface ExpectTextStep {
  id: string;
  op: 'expect-text';
  selector: string;
  equals: string;
}
type WorkflowStep = GotoStep | ClickStep | ExpectTextStep;

interface WorkflowSpec {
  origin: string;
  flow: string;
  steps: WorkflowStep[];
}

/** Sensible limits — all waits and assertions below are hard bounds. */
const LIMITS = {
  SPEC_VERSION: 1,
  MAX_STEPS: 32,
  MAX_SELECTORS_PER_CLICK: 8,
  MAX_ID_LEN: 64,
  MAX_SELECTOR_LEN: 200,
  MAX_PATH_LEN: 512,
  MAX_EQUALS_LEN: 256,
  GOTO_TIMEOUT_MS: 15_000,
  PROBE_TIMEOUT_MS: 3_000,
  CLICK_TIMEOUT_MS: 5_000,
  TEXT_WAIT_MS: 8_000,
  POLL_INTERVAL_MS: 100,
} as const;

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** Heuristically non-semantic ids (pure ordinals) are rejected. */
const ORDINAL_ID_PATTERN = /^(?:step|s|op|id)-?\d+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** Conservative plain-CSS charset; chain/xpath/text syntaxes are not CSS. */
const SELECTOR_CHARSET = /^[A-Za-z0-9#._[\]()="':~,+*>^$| -]+$/;
const NON_CSS_PREFIX = /^(?:xpath|text|role|css)=/i;

function specError(message: string): never {
  throw new SiteMemorySpecError('site-memory: ' + message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStepId(raw: unknown, index: number): string {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > LIMITS.MAX_ID_LEN ||
    !ID_PATTERN.test(raw) ||
    ORDINAL_ID_PATTERN.test(raw)
  ) {
    specError(`steps[${index}].id must be a unique semantic kebab-case id`);
  }
  return raw;
}

function isPlausibleCssSelector(selector: string): boolean {
  if (
    selector.length === 0 ||
    selector.length > LIMITS.MAX_SELECTOR_LEN ||
    !SELECTOR_CHARSET.test(selector) ||
    selector.includes('>>') ||
    NON_CSS_PREFIX.test(selector)
  ) {
    return false;
  }
  let brackets = 0;
  let parens = 0;
  let quote: string | null = null;
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    if (brackets < 0 || parens < 0) return false;
  }
  return brackets === 0 && parens === 0 && quote === null;
}

function parseOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    specError('origin must be an http(s) URL string');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    specError('origin must be a valid http(s) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    specError('origin scheme must be http or https');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    specError('origin must not contain credentials');
  }
  if (
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    specError('origin must be a bare origin without path, query or fragment');
  }
  const origin = parsed.origin; // normalized: lowercase host, default port stripped
  if (!origin || origin === 'null') {
    specError('origin must be an http(s) origin');
  }
  return origin;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) return false;
  return keys.every((k) => k in value);
}

function parseSpec(raw: unknown): WorkflowSpec {
  if (!isPlainObject(raw)) {
    specError('spec must be a plain JSON object');
  }
  if (!hasExactKeys(raw, ['origin', 'flow', 'steps'])) {
    specError('spec must have exactly the keys: origin, flow, steps');
  }

  const origin = parseOrigin(raw.origin);

  const flow = raw.flow;
  if (
    typeof flow !== 'string' ||
    flow.length === 0 ||
    flow.length > LIMITS.MAX_ID_LEN ||
    !ID_PATTERN.test(flow)
  ) {
    specError('flow must be 1-64 chars, lowercase kebab-case, starting with a letter');
  }

  const rawSteps = raw.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    specError('steps must be a non-empty array');
  }
  if (rawSteps.length > LIMITS.MAX_STEPS) {
    specError(`steps must not exceed ${LIMITS.MAX_STEPS} entries`);
  }

  const seenIds = new Set<string>();
  const steps: WorkflowStep[] = rawSteps.map((value, index): WorkflowStep => {
    if (!isPlainObject(value)) {
      specError(`steps[${index}] must be a plain object`);
    }
    if (typeof value.op !== 'string') {
      specError(`steps[${index}].op must be a string`);
    }
    const id = parseStepId(value.id, index);
    if (seenIds.has(id)) {
      specError(`steps[${index}].id must be unique across steps`);
    }
    seenIds.add(id);

    if (value.op === 'goto') {
      if (!hasExactKeys(value, ['id', 'op', 'path'])) {
        specError(`steps[${index}] (goto) must have exactly id, op, path`);
      }
      return parseGotoStep(value, id, index, origin);
    }
    if (value.op === 'click') {
      if (!hasExactKeys(value, ['id', 'op', 'selectors'])) {
        specError(`steps[${index}] (click) must have exactly id, op, selectors`);
      }
      return parseClickStep(value, id, index);
    }
    if (value.op === 'expect-text') {
      if (!hasExactKeys(value, ['id', 'op', 'selector', 'equals'])) {
        specError(
          `steps[${index}] (expect-text) must have exactly id, op, selector, equals`
        );
      }
      return parseExpectTextStep(value, id, index);
    }
    specError(`steps[${index}].op must be one of goto, click, expect-text`);
  });

  if (steps[0].op !== 'goto') {
    specError('the first step must be a goto (anchors the origin)');
  }
  if (steps[steps.length - 1].op !== 'expect-text') {
    specError('the last step must be an expect-text (verification proof)');
  }
  return { origin, flow, steps };
}

function parseGotoStep(
  value: Record<string, unknown>,
  id: string,
  index: number,
  origin: string
): GotoStep {
  const path = value.path;
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > LIMITS.MAX_PATH_LEN ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    CONTROL_CHARS.test(path)
  ) {
    specError(`steps[${index}].path must be a root-relative same-origin path`);
  }
  // Belt and suspenders: the resolved target must stay on the spec origin.
  try {
    const resolved = new URL(path, origin);
    if (resolved.origin !== origin) {
      specError(`steps[${index}].path resolves to a different origin`);
    }
  } catch {
    specError(`steps[${index}].path is not a resolvable path`);
  }
  return { id, op: 'goto', path };
}

function parseClickStep(
  value: Record<string, unknown>,
  id: string,
  index: number
): ClickStep {
  const selectors = value.selectors;
  if (
    !Array.isArray(selectors) ||
    selectors.length === 0 ||
    selectors.length > LIMITS.MAX_SELECTORS_PER_CLICK
  ) {
    specError(
      `steps[${index}].selectors must contain 1..${LIMITS.MAX_SELECTORS_PER_CLICK} CSS selectors`
    );
  }
  const seen = new Set<string>();
  for (const selector of selectors) {
    if (typeof selector !== 'string' || !isPlausibleCssSelector(selector)) {
      specError(`steps[${index}].selectors must be plain CSS selector strings`);
    }
    if (seen.has(selector)) {
      specError(`steps[${index}].selectors must not contain duplicates`);
    }
    seen.add(selector);
  }
  return { id, op: 'click', selectors: selectors as string[] };
}

function parseExpectTextStep(
  value: Record<string, unknown>,
  id: string,
  index: number
): ExpectTextStep {
  const selector = value.selector;
  if (typeof selector !== 'string' || !isPlausibleCssSelector(selector)) {
    specError(`steps[${index}].selector must be a plain CSS selector string`);
  }
  const equals = value.equals;
  if (
    typeof equals !== 'string' ||
    equals.trim().length === 0 ||
    equals.length > LIMITS.MAX_EQUALS_LEN
  ) {
    specError(`steps[${index}].equals must be 1..${LIMITS.MAX_EQUALS_LEN} chars of text`);
  }
  return { id, op: 'expect-text', selector, equals };
}

// ────────────────────────────────────────────────────────────────
// Definition key — SHA-256 over a normalized, versioned canonical spec
// ────────────────────────────────────────────────────────────────

function computeDefinitionKey(parsed: WorkflowSpec): string {
  const normalized = {
    v: LIMITS.SPEC_VERSION,
    origin: parsed.origin,
    flow: parsed.flow,
    steps: parsed.steps.map((step): Record<string, unknown> => {
      // Fixed key order per op ⇒ stable canonical JSON regardless of input
      // key order or origin casing.
      if (step.op === 'goto') {
        return { id: step.id, op: step.op, path: step.path };
      }
      if (step.op === 'click') {
        return { id: step.id, op: step.op, selectors: [...step.selectors] };
      }
      return { id: step.id, op: step.op, selector: step.selector, equals: step.equals };
    }),
  };
  return createHash('sha256')
    .update(`site-memory/spec/v${LIMITS.SPEC_VERSION}\n`)
    .update(JSON.stringify(normalized))
    .digest('hex');
}

// ────────────────────────────────────────────────────────────────
// Memory preflight
// ────────────────────────────────────────────────────────────────

function readHints(
  store: Pick<SiteMemoryStore, 'putRun' | 'getBrief'>,
  parsed: WorkflowSpec,
  definitionKey: string
): Map<string, SiteHint> {
  try {
    const brief = store.getBrief(parsed.origin, parsed.flow, definitionKey);
    const hints = new Map<string, SiteHint>();
    if (!brief || !Array.isArray(brief.hints)) {
      return hints;
    }
    for (const hint of brief.hints) {
      if (
        hint &&
        typeof hint.stepId === 'string' &&
        Number.isInteger(hint.candidate) &&
        hint.candidate >= 0
      ) {
        hints.set(hint.stepId, hint);
      }
    }
    return hints;
  } catch {
    // Memory is a best-effort optimization — a broken read must never block
    // the run; fall back to definition probe order.
    return new Map<string, SiteHint>();
  }
}

/** Probe order: a prior verified candidate goes first, others keep order. */
function probeOrder(step: ClickStep, hint: SiteHint | undefined): number[] {
  const order = step.selectors.map((_, i) => i);
  if (
    hint &&
    hint.candidate > 0 &&
    hint.candidate < step.selectors.length
  ) {
    return [hint.candidate, ...order.filter((i) => i !== hint.candidate)];
  }
  return order;
}

// ────────────────────────────────────────────────────────────────
// Execution
// ────────────────────────────────────────────────────────────────

function sleep(ms: number, page: WorkflowPage): Promise<void> {
  if (page.waitForTimeout) return page.waitForTimeout(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Origin guard for every action. Returns null when the page is provably still
 * on the spec origin, otherwise the fixed error code that aborted the step.
 */
function originGuard(page: WorkflowPage, origin: string): MemoryError | null {
  let rawUrl: string;
  try {
    rawUrl = page.url();
  } catch {
    return 'browser-error';
  }
  try {
    return new URL(rawUrl).origin === origin ? null : 'origin-changed';
  } catch {
    return 'origin-changed';
  }
}

/** openPage rejected — record the run-opening failure against the first step. */
function recordLaunchFailure(parsed: WorkflowSpec, attempts: StepAttempt[]): void {
  const first = parsed.steps[0];
  attempts.push({
    stepId: first.id,
    operation: first.op,
    attempt: 1,
    startedAt: Date.now(),
    durationMs: 0,
    outcome: 'failed',
    errorCode: 'browser-error',
  });
}

async function executeSteps(
  parsed: WorkflowSpec,
  page: WorkflowPage,
  hints: Map<string, SiteHint>,
  attempts: StepAttempt[]
): Promise<boolean> {
  const counters = new Map<string, number>();
  const nextAttempt = (stepId: string): number => {
    const n = (counters.get(stepId) ?? 0) + 1;
    counters.set(stepId, n);
    return n;
  };

  for (const step of parsed.steps) {
    if (step.op === 'goto') {
      const passed = await runGotoStep(parsed.origin, step, page, nextAttempt, attempts);
      if (!passed) return false;
      continue;
    }

    // Click / expect-text: guard before the action — this is what rejects
    // cross-origin drift after late, unexpected redirects.
    const guard = originGuard(page, parsed.origin);
    if (guard) {
      attempts.push({
        stepId: step.id,
        operation: step.op,
        attempt: nextAttempt(step.id),
        startedAt: Date.now(),
        durationMs: 0,
        outcome: 'failed',
        errorCode: guard,
      });
      return false;
    }

    const passed =
      step.op === 'click'
        ? await runClickStep(step, page, hints.get(step.id), nextAttempt, attempts)
        : await runExpectTextStep(step, page, nextAttempt, attempts);
    if (!passed) return false;
  }
  return true;
}

async function runGotoStep(
  origin: string,
  step: GotoStep,
  page: WorkflowPage,
  nextAttempt: (stepId: string) => number,
  attempts: StepAttempt[]
): Promise<boolean> {
  const startedAt = Date.now();
  let errorCode: MemoryError | undefined;
  try {
    await page.goto(origin + step.path, { timeout: LIMITS.GOTO_TIMEOUT_MS });
    // An unexpected redirect during load is caught here.
    errorCode = originGuard(page, origin) ?? undefined;
  } catch {
    errorCode = 'navigation-failed';
  }
  attempts.push({
    stepId: step.id,
    operation: 'goto',
    attempt: nextAttempt(step.id),
    startedAt,
    durationMs: Date.now() - startedAt,
    outcome: errorCode ? 'failed' : 'passed',
    errorCode,
  });
  return !errorCode;
}

async function runClickStep(
  step: ClickStep,
  page: WorkflowPage,
  hint: SiteHint | undefined,
  nextAttempt: (stepId: string) => number,
  attempts: StepAttempt[]
): Promise<boolean> {
  for (const candidate of probeOrder(step, hint)) {
    const startedAt = Date.now();
    const source: 'definition' | 'memory' =
      hint && candidate === hint.candidate ? 'memory' : 'definition';

    let locator: WorkflowLocator;
    try {
      locator = page.locator(step.selectors[candidate]);
    } catch {
      // Page-level breakage — abort rather than continuing on a dead page.
      attempts.push({
        stepId: step.id,
        operation: 'click',
        attempt: nextAttempt(step.id),
        startedAt,
        durationMs: Date.now() - startedAt,
        outcome: 'failed',
        errorCode: 'browser-error',
        candidate,
        source,
      });
      return false;
    }

    // Probe (bounded): safe to fall back to the next candidate while nothing
    // has been dispatched yet. Every probe counts as an attempt.
    try {
      await locator.waitFor({ state: 'visible', timeout: LIMITS.PROBE_TIMEOUT_MS });
    } catch {
      attempts.push({
        stepId: step.id,
        operation: 'click',
        attempt: nextAttempt(step.id),
        startedAt,
        durationMs: Date.now() - startedAt,
        outcome: 'failed',
        errorCode: 'selector-not-ready',
        candidate,
        source,
      });
      continue;
    }

    // Action point: dispatch exactly once. No fallback and no retry beyond
    // this line — a dispatched click must never be resubmitted.
    try {
      await locator.click({ timeout: LIMITS.CLICK_TIMEOUT_MS });
    } catch {
      attempts.push({
        stepId: step.id,
        operation: 'click',
        attempt: nextAttempt(step.id),
        startedAt,
        durationMs: Date.now() - startedAt,
        outcome: 'failed',
        errorCode: 'click-failed',
        candidate,
        source,
      });
      return false;
    }

    attempts.push({
      stepId: step.id,
      operation: 'click',
      attempt: nextAttempt(step.id),
      startedAt,
      durationMs: Date.now() - startedAt,
      outcome: 'passed',
      candidate,
      source,
    });
    return true;
  }
  return false; // All candidates exhausted; every probe was recorded above.
}

async function runExpectTextStep(
  step: ExpectTextStep,
  page: WorkflowPage,
  nextAttempt: (stepId: string) => number,
  attempts: StepAttempt[]
): Promise<boolean> {
  const startedAt = Date.now();
  const fail = (errorCode: MemoryError): boolean => {
    attempts.push({
      stepId: step.id,
      operation: 'expect-text',
      attempt: nextAttempt(step.id),
      startedAt,
      durationMs: Date.now() - startedAt,
      outcome: 'failed',
      errorCode,
    });
    return false;
  };

  let locator: WorkflowLocator;
  try {
    locator = page.locator(step.selector);
  } catch {
    return fail('browser-error');
  }

  try {
    await locator.waitFor({ state: 'visible', timeout: LIMITS.TEXT_WAIT_MS });
  } catch {
    return fail('selector-not-ready');
  }

  const expected = step.equals.trim();
  const deadline = Date.now() + LIMITS.TEXT_WAIT_MS;
  for (;;) {
    let text: string | null;
    try {
      text = await locator.textContent();
    } catch {
      return fail('browser-error');
    }
    if ((text ?? '').trim() === expected) {
      attempts.push({
        stepId: step.id,
        operation: 'expect-text',
        attempt: nextAttempt(step.id),
        startedAt,
        durationMs: Date.now() - startedAt,
        outcome: 'passed',
      });
      return true;
    }
    if (Date.now() >= deadline) {
      return fail('assertion-failed');
    }
    await sleep(LIMITS.POLL_INTERVAL_MS, page);
  }
}
