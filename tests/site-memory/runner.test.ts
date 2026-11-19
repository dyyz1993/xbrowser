/**
 * Unit tests for site-memory workflow runner (src/site-memory/runner.ts).
 *
 * Contract under test (parent-agreed):
 * - runWorkflow(raw, store, openPage, options?) executes an explicit opt-in
 *   JSON flow spec against a page obtained from `openPage`.
 * - Invalid spec => SiteMemorySpecError, NO browser start, NO store calls.
 * - Candidate probes count as attempts; click dispatches at most once
 *   (fallback only before the action); no automatic resubmit.
 * - Cross-origin is rejected at every action, including after unexpected
 *   (late) redirects.
 * - Preflight: SHA256 definition key over a normalized versioned spec;
 *   prior verified matching candidate index may reorder probes; warm runs
 *   still re-probe.
 * - Exactly one putRun per executed run; verified=true only when the final
 *   expect-text proof succeeds.
 * - Privacy: no raw selectors / paths / text / exception messages persisted.
 * - The runner owns the browser lifetime from the openPage callback: the
 *   close callback is invoked exactly once, even on failure.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  runWorkflow,
  SiteMemorySpecError,
  type WorkflowPage,
  type WorkflowLocator,
} from '../../src/site-memory/runner.js';
import type { MemoryRun, SiteBrief } from '../../src/site-memory/types.js';

// ────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────

const ORIGIN = 'https://example.com';

interface LocBehavior {
  /** waitFor(visible) rejects when false */
  visible?: boolean;
  /** click() rejects with this error after dispatch is attempted */
  clickError?: Error;
  /** first textContent() reads (shifted); falls back to `text` */
  textSequence?: Array<string | null>;
  text?: string | null;
}

interface MockPage {
  page: WorkflowPage;
  locatorCalls: string[];
  clickDispatches: string[];
  gotoCalls: string[];
  waitForTimeout?: ReturnType<typeof vi.fn>;
}

function createMockPage(cfg: {
  urls?: string[];
  gotoError?: Error;
  urlError?: Error;
  locator?: (selector: string) => LocBehavior;
  withWaitForTimeout?: boolean;
} = {}): MockPage {
  const urlQueue = cfg.urls ? [...cfg.urls] : [ORIGIN + '/settings'];
  const lastKnownUrl = urlQueue[urlQueue.length - 1];
  const locatorCalls: string[] = [];
  const clickDispatches: string[] = [];
  const gotoCalls: string[] = [];
  const waitForTimeout = vi.fn(async (_ms: number) => {});

  const page: WorkflowPage = {
    goto: vi.fn(async (url: string) => {
      gotoCalls.push(url);
      if (cfg.gotoError) throw cfg.gotoError;
      return null;
    }),
    url: vi.fn((): string => {
      if (cfg.urlError) throw cfg.urlError;
      const next = urlQueue.shift();
      if (next !== undefined) return next;
      // After the scripted queue drains, stick to the last known URL.
      return urlQueue.length > 0 ? urlQueue[0] : lastKnownUrl;
    }),
    locator: vi.fn((selector: string): WorkflowLocator => {
      locatorCalls.push(selector);
      const behavior = cfg.locator?.(selector) ?? {};
      return {
        waitFor: async () => {
          if (behavior.visible === false) {
            throw new Error('timeout waiting for selector');
          }
        },
        click: async () => {
          clickDispatches.push(selector);
          if (behavior.clickError) throw behavior.clickError;
        },
        textContent: async () => {
          if (behavior.textSequence && behavior.textSequence.length > 0) {
            return behavior.textSequence.shift() ?? null;
          }
          return behavior.text === undefined ? 'Logged out' : behavior.text;
        },
      };
    }),
  };
  if (cfg.withWaitForTimeout) {
    page.waitForTimeout = waitForTimeout;
  }
  return {
    page,
    locatorCalls,
    clickDispatches,
    gotoCalls,
    waitForTimeout: cfg.withWaitForTimeout ? waitForTimeout : undefined,
  };
}

type MockStore = {
  runs: MemoryRun[];
  putRun: Mock<(run: MemoryRun) => void>;
  getBrief: Mock<
    (origin: string, flow: string, definitionKey: string) => SiteBrief
  >;
};

function createStore(brief?: SiteBrief | Error): MockStore {
  const runs: MemoryRun[] = [];
  const store: MockStore = {
    runs,
    putRun: vi.fn((run: MemoryRun) => {
      runs.push(run);
    }),
    getBrief: vi.fn((origin: string, _flow: string, _definitionKey: string) => {
      if (brief instanceof Error) throw brief;
      return brief ?? { origin, flow: _flow, hints: [] };
    }),
  };
  return store;
}

function createOpener(mock: MockPage, opts: { closeError?: Error } = {}) {
  const close = vi.fn(async () => {
    if (opts.closeError) throw opts.closeError;
  });
  const openPage = vi.fn(async () => ({ page: mock.page, close }));
  return { openPage, close };
}

/** Valid baseline spec (deep-fresh each call). */
function spec(): Record<string, unknown> {
  return {
    origin: ORIGIN,
    flow: 'logout',
    steps: [
      { id: 'open-settings', op: 'goto', path: '/settings' },
      {
        id: 'click-logout',
        op: 'click',
        selectors: ['#logout', '.user-menu button.logout'],
      },
      {
        id: 'confirm-logged-out',
        op: 'expect-text',
        selector: '.banner',
        equals: 'Logged out',
      },
    ],
  };
}

function logoutHint(candidate: number): SiteBrief {
  return {
    origin: ORIGIN,
    flow: 'logout',
    hints: [{ stepId: 'click-logout', candidate, verifiedAt: 1 }],
  };
}

// ────────────────────────────────────────────────────────────────
// 1. Spec validation — no browser, no store side effects
// ────────────────────────────────────────────────────────────────

describe('runWorkflow spec validation', () => {
  const invalidSpecs: Array<[string, unknown]> = [
    ['raw string instead of object', 'not-an-object'],
    ['unknown top-level key', { ...spec(), extra: 1 }],
    ['missing steps', { origin: ORIGIN, flow: 'logout' }],
    ['steps not an array', { ...spec(), steps: 'nope' }],
    ['steps empty', { ...spec(), steps: [] }],
    [
      'more than 32 steps',
      {
        ...spec(),
        steps: Array.from({ length: 33 }, (_, i) => ({
          id: `s-${i}`,
          op: 'goto',
          path: '/x',
        })),
      },
    ],
    ['ftp origin', { ...spec(), origin: 'ftp://example.com' }],
    ['origin with credentials', { ...spec(), origin: 'https://u:p@example.com' }],
    ['origin with username only', { ...spec(), origin: 'https://u@example.com' }],
    ['origin without scheme', { ...spec(), origin: 'example.com' }],
    ['origin with path', { ...spec(), origin: 'https://example.com/x' }],
    ['origin with query', { ...spec(), origin: 'https://example.com/?q=1' }],
    ['empty flow', { ...spec(), flow: '' }],
    ['uppercase flow', { ...spec(), flow: 'Logout' }],
    ['flow too long', { ...spec(), flow: 'f'.repeat(65) }],
    [
      'first step not goto',
      {
        origin: ORIGIN,
        flow: 'logout',
        steps: [
          { id: 'click-x', op: 'click', selectors: ['#x'] },
          { id: 'see-x', op: 'expect-text', selector: '.x', equals: 'X' },
        ],
      },
    ],
    [
      'last step not expect-text',
      {
        origin: ORIGIN,
        flow: 'logout',
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'click-x', op: 'click', selectors: ['#x'] },
        ],
      },
    ],
    ['unknown op', { ...spec(), steps: [{ id: 'a', op: 'fill', selector: '#a' }] }],
    [
      'unknown step key',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/', timeout: 5 },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'duplicate step ids',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'open', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'ordinal-only step id',
      {
        ...spec(),
        steps: [
          { id: 'step-1', op: 'goto', path: '/' },
          { id: 'step-2', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'uppercase step id',
      {
        ...spec(),
        steps: [
          { id: 'Open', op: 'goto', path: '/' },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'goto path protocol-relative cross-origin',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '//evil.example/x' },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'goto path absolute cross-origin url',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: 'https://evil.example/x' },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'goto path not root-relative',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: 'settings' },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    ['goto missing path', { ...spec(), steps: [{ id: 'open', op: 'goto' }] }],
    [
      'click with empty selectors',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'c', op: 'click', selectors: [] },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'click with 9 selectors',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          {
            id: 'c',
            op: 'click',
            selectors: Array.from({ length: 9 }, (_, i) => '#s' + i),
          },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'click selector chain syntax (not plain CSS)',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'c', op: 'click', selectors: ['div >> p'] },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'click selector xpath prefix',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'c', op: 'click', selectors: ['xpath=//button'] },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'click selector with declaration block characters',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'c', op: 'click', selectors: ['a{color:red}'] },
          { id: 'see', op: 'expect-text', selector: '.a', equals: 'A' },
        ],
      },
    ],
    [
      'expect-text empty equals',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'see', op: 'expect-text', selector: '.a', equals: '' },
        ],
      },
    ],
    [
      'expect-text whitespace equals',
      {
        ...spec(),
        steps: [
          { id: 'open', op: 'goto', path: '/' },
          { id: 'see', op: 'expect-text', selector: '.a', equals: '   ' },
        ],
      },
    ],
  ];

  it.each(invalidSpecs)('rejects invalid spec: %s', async (_name, raw) => {
    const mock = createMockPage();
    const { openPage } = createOpener(mock);
    const store = createStore();

    await expect(
      runWorkflow(raw, store, openPage, { cold: true })
    ).rejects.toBeInstanceOf(SiteMemorySpecError);

    // No browser, no store side effects for an invalid spec.
    expect(openPage).not.toHaveBeenCalled();
    expect(store.putRun).not.toHaveBeenCalled();
    expect(store.getBrief).not.toHaveBeenCalled();
    expect(mock.locatorCalls).toEqual([]);
  });

  it('error message carries no raw spec content', async () => {
    const raw = { ...spec(), origin: 'https://u:p@secret-host.example' };
    const store = createStore();
    const { openPage } = createOpener(createMockPage());
    const err = await runWorkflow(raw, store, openPage).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteMemorySpecError);
    const message = err instanceof Error ? err.message : String(err);
    expect(message).not.toContain('secret-host');
    expect(message).not.toContain('u:p');
  });
});

// ────────────────────────────────────────────────────────────────
// 2. Cold happy path
// ────────────────────────────────────────────────────────────────

describe('runWorkflow cold run', () => {
  it('executes steps in order, verifies, stores exactly one run', async () => {
    const mock = createMockPage();
    const { openPage, close } = createOpener(mock);
    const store = createStore();

    const run = await runWorkflow(spec(), store, openPage, { cold: true });

    // Browser opened once, closed once, memory untouched in cold mode.
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(store.getBrief).not.toHaveBeenCalled();

    // Navigation went to the resolved same-origin URL.
    expect(mock.gotoCalls).toEqual([ORIGIN + '/settings']);

    // Definition order probing: first declared selector first.
    expect(mock.locatorCalls).toEqual(['#logout', '.banner']);
    expect(mock.clickDispatches).toEqual(['#logout']);

    // Run summary.
    expect(run.outcome).toBe('passed');
    expect(run.verified).toBe(true);
    expect(run.origin).toBe(ORIGIN);
    expect(run.flow).toBe('logout');
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.definitionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(run.endedAt).toBeGreaterThanOrEqual(run.startedAt);

    // One attempt per step, complete records.
    expect(run.attempts).toHaveLength(3);
    const [gotoA, clickA, expectA] = run.attempts;
    expect(gotoA).toMatchObject({
      stepId: 'open-settings',
      operation: 'goto',
      attempt: 1,
      outcome: 'passed',
    });
    expect(clickA).toMatchObject({
      stepId: 'click-logout',
      operation: 'click',
      attempt: 1,
      outcome: 'passed',
      candidate: 0,
      source: 'definition',
    });
    expect(expectA).toMatchObject({
      stepId: 'confirm-logged-out',
      operation: 'expect-text',
      attempt: 1,
      outcome: 'passed',
    });
    for (const a of run.attempts) {
      expect(a.durationMs).toBeGreaterThanOrEqual(0);
      expect(a.startedAt).toBeGreaterThan(0);
    }

    // Exactly one complete run stored; same shape as returned.
    expect(store.putRun).toHaveBeenCalledTimes(1);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toEqual(run);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. Warm runs — memory reorder, still re-probe
// ────────────────────────────────────────────────────────────────

describe('runWorkflow warm run', () => {
  it('preflights memory before browser start and reorders probes', async () => {
    const mock = createMockPage();
    const { openPage } = createOpener(mock);
    const store = createStore(logoutHint(1));

    const run = await runWorkflow(spec(), store, openPage);

    // Preflight happens before the browser is started.
    expect(store.getBrief).toHaveBeenCalledTimes(1);
    expect(store.getBrief).toHaveBeenCalledWith(
      ORIGIN,
      'logout',
      run.definitionKey
    );
    expect(store.getBrief.mock.invocationCallOrder[0]).toBeLessThan(
      openPage.mock.invocationCallOrder[0]
    );

    // Hinted candidate (definition index 1) probed first.
    expect(mock.locatorCalls[0]).toBe('.user-menu button.logout');
    expect(mock.clickDispatches).toEqual(['.user-menu button.logout']);

    const clickAttempt = run.attempts.find((a) => a.operation === 'click');
    expect(clickAttempt).toMatchObject({
      candidate: 1,
      source: 'memory',
      outcome: 'passed',
    });

    // Warm runs re-probe: the click was really dispatched again.
    expect(mock.clickDispatches).toHaveLength(1);
    expect(run.verified).toBe(true);
  });

  it('default options consult memory (warm is the default)', async () => {
    const store = createStore(logoutHint(1));
    const { openPage } = createOpener(createMockPage());
    await runWorkflow(spec(), store, openPage);
    expect(store.getBrief).toHaveBeenCalledTimes(1);
  });

  it('ignores out-of-range hint candidates', async () => {
    const mock = createMockPage();
    const store = createStore(logoutHint(7));
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(mock.locatorCalls[0]).toBe('#logout');
    expect(run.attempts.find((a) => a.operation === 'click')).toMatchObject({
      candidate: 0,
      source: 'definition',
    });
  });

  it('ignores hints for steps not present in the spec', async () => {
    const store = createStore({
      origin: ORIGIN,
      flow: 'logout',
      hints: [{ stepId: 'unknown-step', candidate: 0, verifiedAt: 1 }],
    });
    const mock = createMockPage();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);
    expect(mock.locatorCalls[0]).toBe('#logout');
    expect(run.verified).toBe(true);
  });

  it('treats a failing getBrief as no memory, never blocks the run', async () => {
    const store = createStore(new Error('brief store exploded'));
    const mock = createMockPage();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(mock.locatorCalls[0]).toBe('#logout');
    expect(run.verified).toBe(true);
    expect(store.putRun).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────
// 4. Definition key stability
// ────────────────────────────────────────────────────────────────

describe('runWorkflow definition key', () => {
  it('is stable across key order and origin casing', async () => {
    const storeA = createStore();
    const storeB = createStore();
    const { openPage: openA } = createOpener(createMockPage());
    const { openPage: openB } = createOpener(createMockPage());

    const runA = await runWorkflow(spec(), storeA, openA);
    const runB = await runWorkflow(
      {
        flow: 'logout',
        origin: 'https://EXAMPLE.com',
        steps: [
          { op: 'goto', path: '/settings', id: 'open-settings' },
          {
            selectors: ['#logout', '.user-menu button.logout'],
            op: 'click',
            id: 'click-logout',
          },
          {
            equals: 'Logged out',
            selector: '.banner',
            op: 'expect-text',
            id: 'confirm-logged-out',
          },
        ],
      },
      storeB,
      openB
    );

    expect(runB.definitionKey).toBe(runA.definitionKey);
    expect(runB.origin).toBe(ORIGIN);
  });

  it('changes when the asserted text changes', async () => {
    vi.useFakeTimers();
    try {
      const storeA = createStore();
      const storeB = createStore();
      const { openPage: openA } = createOpener(createMockPage());
      const { openPage: openB } = createOpener(createMockPage());

      const runA = await runWorkflow(spec(), storeA, openA);
      const altered = spec();
      (altered.steps as Array<Record<string, unknown>>)[2].equals = 'Signed out';
      // Run B asserts a different text ⇒ its final proof fails after a bounded
      // window; fast-forward through it.
      const pendingB = runWorkflow(altered, storeB, openB);
      await vi.advanceTimersByTimeAsync(20_000);
      const runB = await pendingB;

      expect(runB.definitionKey).not.toBe(runA.definitionKey);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 5. Candidate probes, attempts, single dispatch
// ────────────────────────────────────────────────────────────────

describe('runWorkflow candidate probing', () => {
  it('counts every failed candidate probe as an attempt before falling back', async () => {
    const mock = createMockPage({
      locator: (selector) =>
        selector === '#logout' ? { visible: false } : {},
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(mock.locatorCalls).toEqual([
      '#logout',
      '.user-menu button.logout',
      '.banner',
    ]);
    expect(mock.clickDispatches).toEqual(['.user-menu button.logout']);

    const clickAttempts = run.attempts.filter((a) => a.stepId === 'click-logout');
    expect(clickAttempts).toHaveLength(2);
    expect(clickAttempts[0]).toMatchObject({
      attempt: 1,
      outcome: 'failed',
      errorCode: 'selector-not-ready',
      candidate: 0,
    });
    expect(clickAttempts[1]).toMatchObject({
      attempt: 2,
      outcome: 'passed',
      candidate: 1,
    });

    expect(run.outcome).toBe('passed');
    expect(run.verified).toBe(true);
    expect(store.putRun).toHaveBeenCalledTimes(1);
  });

  it('fails the run when all candidates are exhausted, dispatching nothing', async () => {
    const mock = createMockPage({
      locator: (selector) =>
        selector === '.banner' ? {} : { visible: false },
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(mock.clickDispatches).toEqual([]);
    // goto attempt + 2 failed probes; later steps not attempted.
    expect(run.attempts).toHaveLength(3);
    expect(run.attempts.filter((a) => a.stepId === 'click-logout')).toHaveLength(2);
    expect(run.attempts.every((a) => a.stepId !== 'confirm-logged-out')).toBe(true);
    expect(run.outcome).toBe('failed');
    expect(run.verified).toBe(false);
    expect(store.putRun).toHaveBeenCalledTimes(1);
  });

  it('never retries after a dispatched click rejects', async () => {
    const mock = createMockPage({
      locator: (selector) =>
        selector === '#logout' ? { clickError: new Error('detached node') } : {},
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    // Only the first candidate was even located: no fallback after the action.
    expect(mock.locatorCalls).toEqual(['#logout']);
    expect(mock.clickDispatches).toHaveLength(1);

    const clickAttempts = run.attempts.filter((a) => a.stepId === 'click-logout');
    expect(clickAttempts).toHaveLength(1);
    expect(clickAttempts[0]).toMatchObject({
      outcome: 'failed',
      errorCode: 'click-failed',
      candidate: 0,
    });
    expect(run.outcome).toBe('failed');
    expect(run.verified).toBe(false);
  });

  it('does not resubmit when the final proof fails after a successful click', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockPage({
        locator: (selector) =>
          selector === '.banner' ? { text: 'Still logged in' } : {},
      });
      const store = createStore();
      const { openPage } = createOpener(mock);

      // The bounded assertion window is real (8s) — fast-forward through it.
      const pending = runWorkflow(spec(), store, openPage);
      await vi.advanceTimersByTimeAsync(20_000);
      const run = await pending;

      expect(mock.clickDispatches).toEqual(['#logout']);
      expect(mock.clickDispatches).toHaveLength(1);

      const expectAttempt = run.attempts.find(
        (a) => a.stepId === 'confirm-logged-out'
      );
      expect(expectAttempt).toMatchObject({
        outcome: 'failed',
        errorCode: 'assertion-failed',
      });
      expect(run.outcome).toBe('failed');
      expect(run.verified).toBe(false);
      expect(store.putRun).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 6. Expect-text semantics
// ────────────────────────────────────────────────────────────────

describe('runWorkflow expect-text', () => {
  it('reports selector-not-ready when the element never appears', async () => {
    const mock = createMockPage({
      locator: (selector) => (selector === '.banner' ? { visible: false } : {}),
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    const expectAttempt = run.attempts.find(
      (a) => a.stepId === 'confirm-logged-out'
    );
    expect(expectAttempt).toMatchObject({
      outcome: 'failed',
      errorCode: 'selector-not-ready',
    });
    expect(run.verified).toBe(false);
  });

  it('polls bounded until the text appears, trimming whitespace', async () => {
    const mock = createMockPage({
      locator: (selector) =>
        selector === '.banner'
          ? { textSequence: ['Not yet', null, '  Logged out  '] }
          : {},
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(run.outcome).toBe('passed');
    expect(run.verified).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 7. Cross-origin rejection, including late redirects
// ────────────────────────────────────────────────────────────────

describe('runWorkflow origin guard', () => {
  it('rejects when goto lands on a different origin', async () => {
    const mock = createMockPage({
      urls: ['https://evil.example/settings'],
    });
    const store = createStore();
    const { openPage, close } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]).toMatchObject({
      stepId: 'open-settings',
      outcome: 'failed',
      errorCode: 'origin-changed',
    });
    expect(mock.clickDispatches).toEqual([]);
    expect(run.verified).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(store.putRun).toHaveBeenCalledTimes(1);
  });

  it('rejects a late redirect before the click action', async () => {
    const mock = createMockPage({
      // goto post-check sees the good origin; then the page drifts away.
      urls: [ORIGIN + '/settings', 'https://evil.example/redirected'],
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(mock.locatorCalls).toEqual([]);
    expect(mock.clickDispatches).toEqual([]);

    const clickAttempt = run.attempts.find((a) => a.stepId === 'click-logout');
    expect(clickAttempt).toMatchObject({
      outcome: 'failed',
      errorCode: 'origin-changed',
    });
    expect(run.outcome).toBe('failed');
    expect(run.verified).toBe(false);
  });

  it('rejects a late redirect before the final proof', async () => {
    const mock = createMockPage({
      // goto check, click check, then drift before expect-text.
      urls: [
        ORIGIN + '/settings',
        ORIGIN + '/settings',
        'https://evil.example/after-click',
      ],
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(mock.clickDispatches).toHaveLength(1);
    const expectAttempt = run.attempts.find(
      (a) => a.stepId === 'confirm-logged-out'
    );
    expect(expectAttempt).toMatchObject({
      outcome: 'failed',
      errorCode: 'origin-changed',
    });
    expect(run.verified).toBe(false);
  });

  it('accepts same-origin subresource-style URLs with port intact', async () => {
    const raw = spec();
    raw.origin = 'https://example.com:8443';
    const mock = createMockPage({ urls: ['https://example.com:8443/settings'] });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(raw, store, openPage);
    expect(run.attempts[0].outcome).toBe('passed');
    expect(run.verified).toBe(true);
  });

  it('rejects port drift to a different origin', async () => {
    const raw = spec();
    raw.origin = 'https://example.com:8443';
    const mock = createMockPage({ urls: ['https://example.com/settings'] });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(raw, store, openPage);
    expect(run.attempts[0]).toMatchObject({
      outcome: 'failed',
      errorCode: 'origin-changed',
    });
  });
});

// ────────────────────────────────────────────────────────────────
// 8. Browser errors, lifetime, and openPage failure
// ────────────────────────────────────────────────────────────────

describe('runWorkflow browser lifetime and errors', () => {
  it('records a browser-error attempt when openPage rejects', async () => {
    const store = createStore();
    const openPage = vi.fn(async () => {
      throw new Error('EXPLOSIVE launch failure');
    });

    const run = await runWorkflow(spec(), store, openPage);

    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]).toMatchObject({
      stepId: 'open-settings',
      operation: 'goto',
      attempt: 1,
      outcome: 'failed',
      errorCode: 'browser-error',
    });
    expect(run.outcome).toBe('failed');
    expect(run.verified).toBe(false);
    expect(store.putRun).toHaveBeenCalledTimes(1);
  });

  it('maps a rejecting goto to navigation-failed', async () => {
    const mock = createMockPage({
      gotoError: new Error('net::ERR_CONNECTION_RESET'),
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(run.attempts[0]).toMatchObject({
      outcome: 'failed',
      errorCode: 'navigation-failed',
    });
    expect(run.attempts).toHaveLength(1);
    expect(run.verified).toBe(false);
  });

  it('maps a throwing url() to browser-error', async () => {
    const mock = createMockPage({ urlError: new Error('target closed') });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(run.attempts[0]).toMatchObject({
      outcome: 'failed',
      errorCode: 'browser-error',
    });
  });

  it('closes the page exactly once even when close rejects', async () => {
    const mock = createMockPage();
    const { openPage, close } = createOpener(mock, {
      closeError: new Error('close raced with crash'),
    });
    const store = createStore();

    const run = await runWorkflow(spec(), store, openPage);

    expect(close).toHaveBeenCalledTimes(1);
    expect(run.verified).toBe(true);
    expect(store.putRun).toHaveBeenCalledTimes(1);
  });

  it('closes the page on mid-flow failure', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockPage({
        locator: (selector) => (selector === '.banner' ? { text: 'wrong' } : {}),
      });
      const { openPage, close } = createOpener(mock);
      const store = createStore();

      const pending = runWorkflow(spec(), store, openPage);
      await vi.advanceTimersByTimeAsync(20_000);
      await pending;

      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 9. Privacy — nothing raw persisted
// ────────────────────────────────────────────────────────────────

describe('runWorkflow privacy', () => {
  it('persists no raw selectors, paths, text, or exception messages', async () => {
    const mock = createMockPage({
      gotoError: new Error('EXPLOSIVE-exception-message'),
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);
    const persisted = JSON.stringify(store.runs[0]);

    // Raw spec content must never be persisted.
    for (const raw of [
      '/settings',
      '#logout',
      '.user-menu',
      'button.logout',
      '.banner',
      'Logged out',
    ]) {
      expect(persisted).not.toContain(raw);
    }
    // Exception messages must never be persisted.
    expect(persisted).not.toContain('EXPLOSIVE');
    expect(JSON.stringify(run)).not.toContain('EXPLOSIVE');

    // Structured fields that the contract does persist are present.
    expect(persisted).toContain('"origin":"https://example.com"');
    expect(persisted).toContain('"flow":"logout"');
    expect(persisted).toContain('open-settings');
  });

  it('leaks no raw content through attempts on click failures either', async () => {
    const mock = createMockPage({
      locator: (selector) =>
        selector === '#logout'
          ? { clickError: new Error('EXPLOSIVE-click') }
          : {},
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    await runWorkflow(spec(), store, openPage);
    const persisted = JSON.stringify(store.runs[0]);
    expect(persisted).not.toContain('EXPLOSIVE');
    expect(persisted).not.toContain('#logout');
  });
});

// ────────────────────────────────────────────────────────────────
// 10. Optional waitForTimeout
// ────────────────────────────────────────────────────────────────

describe('runWorkflow waitForTimeout optionality', () => {
  it('works without page.waitForTimeout (internal sleep fallback)', async () => {
    const mock = createMockPage(); // no waitForTimeout by default
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);
    expect(run.verified).toBe(true);
  });

  it('prefers the page-provided waitForTimeout when present', async () => {
    const mock = createMockPage({
      withWaitForTimeout: true,
      locator: (selector) =>
        selector === '.banner' ? { textSequence: ['Not yet', 'Logged out'] } : {},
    });
    const store = createStore();
    const { openPage } = createOpener(mock);

    const run = await runWorkflow(spec(), store, openPage);

    expect(run.verified).toBe(true);
    // One poll sleep happened (mismatch → wait → match) via page.waitForTimeout.
    expect(mock.waitForTimeout).toBeDefined();
    expect(mock.waitForTimeout!.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────
// 11. Structural compatibility with the real driver page
// ────────────────────────────────────────────────────────────────

describe('WorkflowPage contract', () => {
  it('is structurally satisfied by the real XBPage (compile-time guard)', () => {
    // If this assignment stops compiling, the parent wiring (passing real
    // driver pages to runWorkflow) would break. Runtime value is irrelevant.
    const driverPage: import('../../src/cdp-driver/types.js').XBPage =
      null as unknown as import('../../src/cdp-driver/types.js').XBPage;
    const workflowPage: WorkflowPage = driverPage;
    expect(workflowPage).toBeNull();
  });
});
