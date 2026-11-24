/**
 * rpc-handlers `exec` ↔ SessionRecorder integration.
 *
 * Runs the REAL recorder against a scripted mock page (only the session,
 * executor and CDP boundaries are mocked), so the race between the command
 * path and the recorder's 200 ms signal poll is exercised like in production.
 * Time is fake, so every interleaving below is an explicit step:
 *   poll()    one 200 ms tick of the recorder's signal poll (drains the queue)
 *   capture() the 300 ms click-context capture a drained click goes through
 *
 * 1. A FAILED command must not land in the recording
 * 2. An action signal flushed while the command is still in flight must not be
 *    recorded next to the command's own action
 * 3. Guards: rec-duel d02…d06 dedup semantics stay intact
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { ExecutionResult } from '../../src/executor.js';

// Mock browser.ts — the session itself is built per test (see beforeEach)
const hoisted = vi.hoisted(() => ({ session: undefined as unknown }));

vi.mock('../../src/browser.js', () => ({
  createSession: vi.fn(),
  findSession: vi.fn(() => hoisted.session),
  closeSessionByName: vi.fn().mockResolvedValue(undefined),
  getAllSessions: vi.fn(() => []),
  saveSessionDiskMeta: vi.fn(),
}));

// Mock executor.ts — each test decides whether the command succeeds, fails or throws
vi.mock('../../src/executor.js', () => ({
  executeCommand: vi.fn(),
  executeChain: vi.fn(),
}));

// Isolate homedir — the recorder persists recordings + site knowledge under ~/.xbrowser
// (per process, so concurrent vitest runs cannot read each other's recordings)
const TEST_HOME = vi.hoisted(() => `/tmp/xbrowser-test-rpc-recorder-${process.pid}`);
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const homedir = () => TEST_HOME;
  return { ...actual, default: { ...actual, homedir }, homedir };
});
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const homedir = () => TEST_HOME;
  return { ...actual, default: { ...actual, homedir }, homedir };
});

// Mock WebSocket server
vi.mock('../../src/websocket-server.js', () => ({
  WSServer: vi.fn().mockImplementation(() => ({
    attachToServer: vi.fn().mockResolvedValue(undefined),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    pauseScreencast: vi.fn().mockResolvedValue(undefined),
    resumeScreencast: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock utils/cdp — no real endpoint discovery
vi.mock('../../src/utils/cdp.js', () => ({
  resolveCDPEndpoint: vi.fn().mockResolvedValue('http://localhost:9222'),
}));

import { createRPCHandler } from '../../src/daemon/rpc-handlers.js';
import { executeCommand } from '../../src/executor.js';
import { SessionRecorder } from '../../src/recorder/session-recorder.js';
import type { RecordingData, UserAction } from '../../src/recorder/session-recorder.js';

type RpcHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** What the injected ACTION_SIGNAL_SCRIPT pushes onto window.__xb_pending_actions. */
interface RawSignal {
  type: string;
  ts: number;
  url: string;
  title: string;
  element?: UserAction['element'];
  value?: string;
  x?: number;
  y?: number;
  scrollX?: number;
  scrollY?: number;
}

const SESSION = 'rec-dedup';
const PAGE_URL = 'https://example.com/form';
const SUCCESS: ExecutionResult = { success: true, data: null, tips: [], duration: 5 };

/** window.__xb_describe(el) result for an element with an id. */
function describeElement(tag: string, selector: string, text: string): UserAction['element'] {
  return { tag, selector, text, strategy: 'id', confidence: 'high' };
}

/** Scripted page: answers the recorder's `evaluate` scripts and holds the pending action signals. */
function createMockPage() {
  let currentUrl = PAGE_URL;
  const pending: RawSignal[] = [];
  const drains: RawSignal[][] = [];
  const described = new Map<string, UserAction['element']>();
  const locator = { first: () => locator, screenshot: vi.fn(async () => Buffer.from('png')) };
  const page = {
    url: vi.fn(() => currentUrl),
    isClosed: vi.fn(() => false),
    goto: vi.fn(async (target: string) => { currentUrl = target; }),
    addInitScript: vi.fn(async () => {}),
    on: vi.fn(),
    off: vi.fn(),
    locator: vi.fn(() => locator),
    screenshot: vi.fn(async () => Buffer.from('png')),
    evaluate: vi.fn(async (script: unknown): Promise<unknown> => {
      if (typeof script !== 'string') return [];
      if (script.includes('__xb_pending_actions')) {
        const batch = pending.splice(0);
        drains.push(batch);
        return batch;
      }
      if (script.includes('__xb_describe')) {
        // The queried selector is embedded as a JSON string by queryJS: document.querySelector(\"#submit\")
        const selector = [...described.keys()]
          .find(s => script.includes(JSON.stringify(JSON.stringify(s)).slice(1, -1)));
        return selector ? described.get(selector) : null;
      }
      if (script.includes('window.__xb_action_signal')) return true; // injection probe
      if (script.includes('POPOVER_SELECTORS')) return { appeared: [], disappeared: [], stateChanges: [] };
      return [];
    }),
  };
  return {
    page,
    /** Queue a browser-side action signal for the recorder's next poll. */
    pushSignal: (signal: Omit<RawSignal, 'ts' | 'url' | 'title'>) =>
      pending.push({ ts: Date.now(), url: PAGE_URL, title: 'Form', ...signal }),
    /** Every batch handed to a recorder poll, in order. */
    drains,
    /** What window.__xb_describe(el) returns for a selector (absent = element not found). */
    describe: (selector: string, element: UserAction['element']) => described.set(selector, element),
  };
}

describe('createRPCHandler exec → recorder', () => {
  let handler: RpcHandler;
  let harness: ReturnType<typeof createMockPage>;

  beforeAll(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(executeCommand).mockReset();
    vi.mocked(executeCommand).mockResolvedValue(SUCCESS);
    vi.useFakeTimers();
    harness = createMockPage();
    hoisted.session = {
      id: 'rec-dedup-session',
      name: SESSION,
      page: harness.page,
      context: { on: vi.fn(), off: vi.fn(), pages: vi.fn(() => []), browser: vi.fn() },
      createdAt: Date.now(),
      cdpEndpoint: undefined,
    };
    handler = createRPCHandler() as unknown as RpcHandler;
    expect(await handler('record:start', { session: SESSION })).toMatchObject({ ok: true });
  });

  afterEach(async () => {
    await handler('record:stop', { session: SESSION });
    vi.useRealTimers();
  });

  /** Stop the recording and return the persisted actions. */
  async function recordedActions(): Promise<UserAction[]> {
    expect(await handler('record:stop', { session: SESSION })).toMatchObject({ ok: true });
    const data = SessionRecorder.readData(SESSION) as RecordingData | null;
    expect(data).not.toBeNull();
    return (data as RecordingData).actions;
  }

  /** Let queued promise callbacks run (no timer fires). */
  const tick = () => vi.advanceTimersByTimeAsync(0);
  /** One 200 ms tick of the recorder's signal poll. */
  const poll = () => vi.advanceTimersByTimeAsync(200);
  /** The 300 ms click-context capture a drained click goes through. */
  const capture = () => vi.advanceTimersByTimeAsync(300);

  /** Dispatch a command that stays in flight until the test finishes it. */
  function execInFlight(command: string, params: Record<string, unknown>) {
    let finish!: (result: ExecutionResult) => void;
    vi.mocked(executeCommand).mockReturnValueOnce(new Promise<ExecutionResult>((resolve) => { finish = resolve; }));
    return {
      promise: handler('exec', { command, params, session: SESSION }),
      /** Resolves once the daemon has dispatched the command. */
      dispatched: async () => {
        await tick();
        expect(executeCommand).toHaveBeenCalledTimes(1);
      },
      finish: (result: ExecutionResult) => finish(result),
    };
  }

  const clickSignal = { type: 'click', element: describeElement('button', '#submit', 'Submit'), x: 10, y: 20 };

  describe('failed commands', () => {
    it('records nothing for a failed command and does not swallow a later real action', async () => {
      vi.mocked(executeCommand).mockResolvedValueOnce({
        success: false, data: null, message: 'Element not found: #name', tips: [], duration: 3,
      });

      const result = await handler('exec', { command: 'fill', params: { selector: '#name', value: 'Alice' }, session: SESSION });

      expect(result).toMatchObject({ success: false, message: 'Element not found: #name' });
      // A moment later the user types into that very field by hand
      await poll();
      harness.pushSignal({ type: 'input', element: describeElement('input', '#name', ''), value: 'Alice' });
      await poll();

      expect(await recordedActions()).toEqual([
        expect.objectContaining({ type: 'input', value: 'Alice', element: expect.objectContaining({ selector: '#name' }) }),
      ]);
    });

    it('records nothing for a command that throws, and still rejects', async () => {
      vi.mocked(executeCommand).mockRejectedValueOnce(new Error('Target closed'));

      await expect(handler('exec', { command: 'click', params: { selector: '#submit' }, session: SESSION }))
        .rejects.toThrow('Target closed');

      harness.pushSignal(clickSignal);
      await poll();
      await capture();

      expect((await recordedActions()).map(a => a.type)).toEqual(['click']);
    });
  });

  describe('signal flushed while the command is in flight', () => {
    it('records exactly ONE action for that click', async () => {
      harness.describe('#submit', clickSignal.element);
      const exec = execInFlight('click', { selector: '#submit' });
      await exec.dispatched();

      // The page's trusted click event lands while `xbrowser click` is still running
      harness.pushSignal(clickSignal);
      await poll();
      exec.finish(SUCCESS);
      await exec.promise;
      await capture();

      expect(await recordedActions()).toEqual([
        expect.objectContaining({ type: 'cdp-click', element: expect.objectContaining({ selector: '#submit' }) }),
      ]);
    });

    it('reserves with the described selector, so it converges with the signal-side element.selector', async () => {
      // `xbrowser click button` → __xb_describe resolves the unique selector #submit,
      // which is exactly what the action signal reports (rec-duel d04/d06)
      harness.describe('button', describeElement('button', '#submit', 'Submit'));
      const exec = execInFlight('click', { selector: 'button' });
      await exec.dispatched();

      harness.pushSignal(clickSignal);
      await poll();
      exec.finish(SUCCESS);
      await exec.promise;
      await capture();

      expect(await recordedActions()).toEqual([
        expect.objectContaining({ type: 'cdp-click', element: expect.objectContaining({ selector: '#submit' }) }),
      ]);
    });
  });

  describe('guards', () => {
    it('keeps both interactions when a real click is still being captured as a command on the same element starts', async () => {
      harness.describe('#submit', clickSignal.element);
      // The user clicks the button by hand…
      harness.pushSignal(clickSignal);
      await poll();
      // …and while that click is still being captured, a CLI click on the same element starts
      const exec = execInFlight('click', { selector: '#submit' });
      await exec.dispatched();

      harness.pushSignal(clickSignal); // the CLI click's own real event
      await poll();
      await capture();
      exec.finish(SUCCESS);
      await exec.promise;
      await capture();

      // The user's click AND the command's action — neither may swallow the other
      expect((await recordedActions()).map(a => a.type).sort()).toEqual(['cdp-click', 'click']);
    });

    it('leaves selector-less commands untouched (goto, scroll)', async () => {
      expect(await handler('exec', { command: 'goto', params: { url: 'https://example.com/next' }, session: SESSION }))
        .toMatchObject({ success: true });
      expect(await handler('exec', { command: 'scroll', params: { direction: 'down', distance: 300 }, session: SESSION }))
        .toMatchObject({ success: true });
      // Page scroll signals carry no value, so they never share a dedup key with the scroll command
      await poll();
      harness.pushSignal({ type: 'scroll', scrollX: 0, scrollY: 300 });
      await poll();

      expect((await recordedActions()).map(a => ({ type: a.type, value: a.value }))).toEqual([
        { type: 'goto', value: undefined },
        { type: 'scroll', value: 'down:300' },
        { type: 'scroll', value: undefined },
      ]);
    });

    it('still suppresses the command action when a real signal was recorded first (reverse dedup)', async () => {
      harness.describe('#submit', clickSignal.element);
      // The user clicked the button by hand just before the CLI command
      harness.pushSignal(clickSignal);
      await poll();
      await capture();

      await handler('exec', { command: 'click', params: { selector: '#submit' }, session: SESSION });

      expect((await recordedActions()).map(a => a.type)).toEqual(['click']);
    });
  });

  describe('a right click command', () => {
    const menuSignal = { type: 'contextmenu', element: describeElement('button', '#submit', 'Submit'), x: 10, y: 20 };
    const rightClick = (selector = '#submit') => ({ command: 'click', params: { selector, button: 'right' }, session: SESSION });

    it('records one contextmenu, not a button-less click, when the page signal was missed', async () => {
      harness.describe('#submit', menuSignal.element);

      expect(await handler('exec', rightClick())).toMatchObject({ success: true });

      expect(await recordedActions()).toEqual([
        expect.objectContaining({ type: 'contextmenu', element: expect.objectContaining({ selector: '#submit' }) }),
      ]);
    });

    it('records it once when the page signal lands while the command is in flight', async () => {
      harness.describe('#submit', menuSignal.element);
      const exec = execInFlight('click', { selector: '#submit', button: 'right' });
      await exec.dispatched();

      harness.pushSignal(menuSignal);
      await poll();
      exec.finish(SUCCESS);
      await exec.promise;
      await capture();

      expect((await recordedActions()).map(a => a.type)).toEqual(['contextmenu']);
    });

    it('records it once when the page signal was recorded first', async () => {
      harness.describe('#submit', menuSignal.element);
      harness.pushSignal(menuSignal);
      await poll();

      expect(await handler('exec', rightClick())).toMatchObject({ success: true });

      expect((await recordedActions()).map(a => a.type)).toEqual(['contextmenu']);
    });
  });
});
