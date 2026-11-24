import { describe, it, expect } from 'vitest';

import {
  generateJSScript,
  generatePythonScript,
  generateBashScript,
  normalizeToReplaySteps,
} from '../../src/commands/convert.js';
import type { Recording } from '../../src/commands/definitions.js';
import type { UserAction } from '../../src/recorder/recording-types.js';

const baseRecording: Recording = {
  startUrl: 'https://example.com',
  events: [],
};

// ─── Fixtures ──────────────────────────────────────────────────────

const START_URL = 'https://example.com/';
const RESULTS_URL = 'https://example.com/results?q=alice';
const T0 = 1_760_000_000_000;

/** One action as the current recorder stores it: selector under `element`, value/key/coords at the top level. */
function action(partial: Partial<UserAction> & Pick<UserAction, 'type' | 'timestamp'>): UserAction {
  return { id: 0, url: START_URL, pageTitle: 'Example Domain', ...partial };
}

function on(selector: string): UserAction['element'] {
  return { tag: 'input', selector, text: '' };
}

const navigation = (url: string, timestamp: number): UserAction =>
  action({ type: 'navigation', timestamp, url });

const clickAction = (selector: string, timestamp: number, viaCli = false): UserAction =>
  action({
    type: viaCli ? 'cdp-click' : 'click',
    timestamp,
    element: on(selector),
    ...(viaCli ? {} : { x: 88, y: 210 }),
  });

const modernRecording = (actions: UserAction[], startUrl = START_URL): Recording => ({
  startUrl,
  sessionName: 'demo flow',
  actions,
});

/** A CLI-driven flow: initial load, fill, click (logged twice), its submit, a scroll, a page change. */
const modernActions: UserAction[] = [
  navigation(START_URL, T0),
  action({ type: 'cdp-fill', timestamp: T0 + 1000, element: on('#name'), value: 'Alice' }),
  clickAction('#submit', T0 + 2000, true),
  clickAction('#submit', T0 + 2300),
  action({ type: 'submit', timestamp: T0 + 2301, element: { tag: 'form', selector: 'form:nth-of-type(1)', text: '' } }),
  action({ type: 'scroll', timestamp: T0 + 3000, value: 'down:600' }),
  navigation(RESULTS_URL, T0 + 4000),
];

/** A human-driven flow covering every remaining step kind. */
const humanActions: UserAction[] = [
  navigation(START_URL, T0),
  action({ type: 'scroll', timestamp: T0 + 1000, scrollX: 120, scrollY: 900 }),
  action({ type: 'hover', timestamp: T0 + 2000, element: on('#menu') }),
  action({ type: 'input', timestamp: T0 + 3000, element: on('#search'), value: 'playwright' }),
  action({ type: 'keydown', timestamp: T0 + 3500, element: on('#search'), key: 'Enter' }),
  action({ type: 'keydown', timestamp: T0 + 4000, key: 'Enter' }),
  action({ type: 'keydown', timestamp: T0 + 4500, element: on('#notes'), key: 'Ctrl+a' }),
  action({ type: 'scroll', timestamp: T0 + 5000, element: on('#list'), value: 'up:300' }),
];

const legacyRecording: Recording = {
  ...baseRecording,
  events: [
    { type: 'page_load', timestamp: 0 },
    { type: 'click', selector: '#btn', timestamp: 100, data: { x: 10, y: 20 } },
    { type: 'input', selector: '#search', timestamp: 200, data: { value: 'h' } },
    { type: 'type', selector: '#search', timestamp: 210, data: { value: 'he' } },
    { type: 'keydown', selector: '#search', timestamp: 250, data: { key: 'Tab' } },
    { type: 'keydown', selector: '#search', timestamp: 260, data: { key: 'Enter' } },
    { type: 'mousemove', timestamp: 300, data: { x: 100, y: 200 } },
    { type: 'click', selector: '#link', timestamp: 400 },
    { type: 'scroll', timestamp: 700, data: { x: 100, y: 500 } },
  ],
};

const legacySteps = [
  { kind: 'click', selector: '#btn' },
  { kind: 'fill', selector: '#search', value: 'he' },
  { kind: 'press', key: 'Enter', selector: '#search' },
  { kind: 'click', selector: '#link' },
  { kind: 'scroll', mode: 'absolute', x: 100, y: 500 },
];

// ─── Script readers ────────────────────────────────────────────────

/** Replay statements of a generated script, in order, without the settle waits. */
function replayLines(script: string, indent: string): string[] {
  const prefix = `${indent}await `;
  return script
    .split('\n')
    .filter((line) => line.startsWith(`${prefix}page.`) && !line.startsWith(`${prefix}page.waitForTimeout`))
    .map((line) => line.trim());
}

/** Every `xb …` invocation of a generated bash script, in order. */
function bashCommands(script: string): string[] {
  return script.split('\n').filter((line) => line.startsWith('xb '));
}

describe('convert', () => {
  describe('normalizeToReplaySteps — current recording format (actions)', () => {
    it('turns a CLI-driven recording into ordered replay steps', () => {
      expect(normalizeToReplaySteps(modernRecording(modernActions))).toEqual([
        { kind: 'fill', selector: '#name', value: 'Alice' },
        { kind: 'click', selector: '#submit' },
        { kind: 'scroll', mode: 'relative', direction: 'down', distance: 600 },
        { kind: 'goto', url: RESULTS_URL },
      ]);
    });

    it('covers scroll, hover, fill and key presses of a human-driven recording', () => {
      expect(normalizeToReplaySteps(modernRecording(humanActions))).toEqual([
        { kind: 'scroll', mode: 'absolute', x: 120, y: 900 },
        { kind: 'hover', selector: '#menu' },
        { kind: 'fill', selector: '#search', value: 'playwright' },
        { kind: 'press', key: 'Enter', selector: '#search' },
        { kind: 'press', key: 'Enter', selector: '#search' },
        { kind: 'press', key: 'Control+a', selector: '#notes' },
        { kind: 'scroll', mode: 'relative', direction: 'up', distance: 300, selector: '#list' },
      ]);
    });

    it('sends a key press without its own target to the field filled last', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        navigation(START_URL, T0),
        action({ type: 'input', timestamp: T0 + 1000, element: on('#email'), value: 'a@b.c' }),
        action({ type: 'keydown', timestamp: T0 + 2000, key: 'Enter' }),
      ]));
      expect(steps).toEqual([
        { kind: 'fill', selector: '#email', value: 'a@b.c' },
        { kind: 'press', key: 'Enter', selector: '#email' },
      ]);
    });

    it('leaves a key press untargeted when no field was filled before it', () => {
      expect(normalizeToReplaySteps(modernRecording([action({ type: 'keydown', timestamp: T0, key: 'Escape' })])))
        .toEqual([{ kind: 'press', key: 'Escape' }]);
    });

    it('treats the initial page load as the start URL even when the trailing slash differs', () => {
      const steps = normalizeToReplaySteps(modernRecording([navigation(START_URL, T0)], 'https://example.com'));
      expect(steps).toEqual([]);
    });

    it('emits a later navigation back to the start URL', () => {
      // Far enough from the click not to be its result.
      const steps = normalizeToReplaySteps(modernRecording([
        navigation(START_URL, T0),
        clickAction('#next', T0 + 1000),
        navigation(START_URL, T0 + 10000),
      ]));
      expect(steps).toEqual([
        { kind: 'click', selector: '#next' },
        { kind: 'goto', url: START_URL },
      ]);
    });

    it('collapses what one CLI interaction logs several times (shape of a real recording)', () => {
      // `fill` click-focuses its field twice before typing; the page load caused by a
      // submit click is logged BEFORE the command, whose timestamp is taken when it returns;
      // a CLI `scroll` is preceded by the page's own scroll signal.
      const steps = normalizeToReplaySteps(modernRecording([
        navigation(START_URL, T0),
        clickAction('#name', T0 + 4408),
        clickAction('#name', T0 + 4857),
        action({ type: 'input', timestamp: T0 + 6795, element: on('#name'), value: 'Alice ' }),
        action({ type: 'cdp-fill', timestamp: T0 + 9534, element: on('#name'), value: "Alice O'Neil" }),
        clickAction('#email', T0 + 11346),
        clickAction('#email', T0 + 11885),
        action({ type: 'cdp-fill', timestamp: T0 + 19048, element: on('#email'), value: 'a@b.c' }),
        action({ type: 'input', timestamp: T0 + 18859, element: on('#email'), value: 'a@b.c' }),
        action({ type: 'navigation', timestamp: T0 + 24356, url: 'https://example.com/done.html' }),
        action({ type: 'cdp-click', timestamp: T0 + 24486, element: on('#submit') }),
        navigation(RESULTS_URL, T0 + 29727),
        action({ type: 'goto', timestamp: T0 + 29894, url: RESULTS_URL }),
        action({ type: 'scroll', timestamp: T0 + 31266, scrollX: 0, scrollY: 178 }),
        action({ type: 'scroll', timestamp: T0 + 31843, value: 'down:600' }),
      ]));
      expect(steps).toEqual([
        { kind: 'fill', selector: '#name', value: "Alice O'Neil" },
        { kind: 'fill', selector: '#email', value: 'a@b.c' },
        { kind: 'click', selector: '#submit' },
        { kind: 'goto', url: RESULTS_URL },
        { kind: 'scroll', mode: 'relative', direction: 'down', distance: 600 },
      ]);
    });

    it('drops only the focus clicks directly before the fill and keeps other clicks', () => {
      // The first click on the field has another click after it, so it is not a trailing focus click.
      expect(normalizeToReplaySteps(modernRecording([
        clickAction('#name', T0),
        clickAction('#help', T0 + 500),
        clickAction('#name', T0 + 900),
        action({ type: 'input', timestamp: T0 + 1000, element: on('#name'), value: 'x' }),
      ]))).toEqual([
        { kind: 'click', selector: '#name' },
        { kind: 'click', selector: '#help' },
        { kind: 'fill', selector: '#name', value: 'x' },
      ]);
    });

    it('keeps a page load that no click or key press caused, and the page scroll signal of a human scroll', () => {
      expect(normalizeToReplaySteps(modernRecording([
        clickAction('#next', T0),
        navigation(RESULTS_URL, T0 + 10000),
        action({ type: 'scroll', timestamp: T0 + 20000, scrollX: 0, scrollY: 300 }),
      ]))).toEqual([
        { kind: 'click', selector: '#next' },
        { kind: 'goto', url: RESULTS_URL },
        { kind: 'scroll', mode: 'absolute', x: 0, y: 300 },
      ]);
    });

    it('logs a CLI goto once (navigation signal + goto command) but keeps a real second load', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        clickAction('#next', T0),
        navigation(RESULTS_URL, T0 + 1000),
        action({ type: 'goto', timestamp: T0 + 1100, url: RESULTS_URL }),
        clickAction('#back', T0 + 2000),
        action({ type: 'goto', timestamp: T0 + 3000, url: RESULTS_URL }),
        navigation(RESULTS_URL, T0 + 3100),
      ]));
      expect(steps).toEqual([
        { kind: 'click', selector: '#next' },
        { kind: 'goto', url: RESULTS_URL },
        { kind: 'click', selector: '#back' },
        { kind: 'goto', url: RESULTS_URL },
      ]);
    });

    it('collapses a cdp-click and its click echo into one click, whichever is logged first', () => {
      const echoFirst = normalizeToReplaySteps(modernRecording([
        clickAction('#submit', T0),
        clickAction('#submit', T0 + 300, true),
      ]));
      expect(echoFirst).toEqual([{ kind: 'click', selector: '#submit' }]);
    });

    it('keeps two real clicks on the same selector', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        clickAction('#add', T0),
        clickAction('#add', T0 + 300),
      ]));
      expect(steps).toEqual([{ kind: 'click', selector: '#add' }, { kind: 'click', selector: '#add' }]);
    });

    it('keeps a click that follows a cdp-click by more than the twin window', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        clickAction('#submit', T0, true),
        clickAction('#submit', T0 + 6000),
      ]));
      expect(steps).toEqual([{ kind: 'click', selector: '#submit' }, { kind: 'click', selector: '#submit' }]);
    });

    it('collapses consecutive input on the same field into one fill with the final value', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        action({ type: 'input', timestamp: T0, element: on('#search'), value: 'he' }),
        action({ type: 'input', timestamp: T0 + 1000, element: on('#search'), value: 'hel' }),
        action({ type: 'input', timestamp: T0 + 2000, element: on('#search'), value: 'hello' }),
      ]));
      expect(steps).toEqual([{ kind: 'fill', selector: '#search', value: 'hello' }]);
    });

    it('keeps fills on different fields', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        action({ type: 'input', timestamp: T0, element: on('#a'), value: 'x' }),
        action({ type: 'input', timestamp: T0 + 100, element: on('#b'), value: 'y' }),
      ]));
      expect(steps).toEqual([
        { kind: 'fill', selector: '#a', value: 'x' },
        { kind: 'fill', selector: '#b', value: 'y' },
      ]);
    });

    it('collapses a cdp-fill and its input echo, also when other actions sit between them', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        action({ type: 'cdp-fill', timestamp: T0, element: on('#name'), value: 'Alice' }),
        action({ type: 'cdp-click', timestamp: T0 + 100, element: on('#submit') }),
        action({ type: 'submit', timestamp: T0 + 150 }),
        action({ type: 'input', timestamp: T0 + 300, element: on('#name'), value: 'Alice' }),
      ]));
      expect(steps).toEqual([
        { kind: 'fill', selector: '#name', value: 'Alice' },
        { kind: 'click', selector: '#submit' },
      ]);
    });

    it('skips a scroll it cannot decode', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        action({ type: 'scroll', timestamp: T0 }),
        action({ type: 'scroll', timestamp: T0 + 10, value: 'sideways:600' }),
      ]));
      expect(steps).toEqual([]);
    });

    it('decodes every CLI scroll direction, with decimal distances and stray whitespace', () => {
      expect(normalizeToReplaySteps(modernRecording([
        action({ type: 'scroll', timestamp: T0, value: 'up:300' }),
        action({ type: 'scroll', timestamp: T0 + 10, value: 'left: 120.5' }),
        action({ type: 'scroll', timestamp: T0 + 20, value: 'right:0' }),
      ]))).toEqual([
        { kind: 'scroll', mode: 'relative', direction: 'up', distance: 300 },
        { kind: 'scroll', mode: 'relative', direction: 'left', distance: 120.5 },
        { kind: 'scroll', mode: 'relative', direction: 'right', distance: 0 },
      ]);
    });

    it('reads the target of an older goto action from its value', () => {
      expect(normalizeToReplaySteps(modernRecording([
        action({ type: 'goto', timestamp: T0, url: '', value: RESULTS_URL }),
      ]))).toEqual([{ kind: 'goto', url: RESULTS_URL }]);
    });

    it('keeps a fill that changes the value of a recently CLI-filled field', () => {
      expect(normalizeToReplaySteps(modernRecording([
        action({ type: 'cdp-fill', timestamp: T0, element: on('#name'), value: 'Alice' }),
        clickAction('#other', T0 + 100),
        action({ type: 'input', timestamp: T0 + 300, element: on('#name'), value: 'Bob' }),
      ]))).toEqual([
        { kind: 'fill', selector: '#name', value: 'Alice' },
        { kind: 'click', selector: '#other' },
        { kind: 'fill', selector: '#name', value: 'Bob' },
      ]);
    });

    it('falls back to list adjacency when an action has no timestamp', () => {
      const undated = (a: UserAction): UserAction => ({ ...a, timestamp: undefined as unknown as number });

      expect(normalizeToReplaySteps(modernRecording([
        undated(clickAction('#submit', T0, true)),
        undated(action({ type: 'submit', timestamp: T0 })),
        undated(clickAction('#submit', T0)),
      ]))).toEqual([{ kind: 'click', selector: '#submit' }]);

      expect(normalizeToReplaySteps(modernRecording([
        undated(clickAction('#submit', T0, true)),
        undated(clickAction('#other', T0)),
        undated(clickAction('#submit', T0)),
      ]))).toEqual([
        { kind: 'click', selector: '#submit' },
        { kind: 'click', selector: '#other' },
        { kind: 'click', selector: '#submit' },
      ]);
    });

    it('collapses a cdp-fill and its input echo, whichever is logged first', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        action({ type: 'input', timestamp: T0, element: on('#name'), value: 'Alice' }),
        action({ type: 'cdp-fill', timestamp: T0 + 300, element: on('#name'), value: 'Alice' }),
      ]));
      expect(steps).toEqual([{ kind: 'fill', selector: '#name', value: 'Alice' }]);
    });

    it('skips clicks and fills that have no usable target', () => {
      const steps = normalizeToReplaySteps(modernRecording([
        action({ type: 'click', timestamp: T0, element: on('body'), x: 10, y: 10 }),
        action({ type: 'click', timestamp: T0 + 10, x: 10, y: 10 }),
        action({ type: 'input', timestamp: T0 + 20, value: 'orphan' }),
        action({ type: 'hover', timestamp: T0 + 30 }),
      ]));
      expect(steps).toEqual([]);
    });

    it('skips action types with no replay meaning instead of crashing', () => {
      const noise = [
        'popup_appear', 'cdp-eval', 'filechooser', 'drag', 'dblclick', 'contextmenu', 'resize',
        'clipboard', 'touch', 'focus', 'visibility', 'drop', 'change', 'submit', 'discovered_filters',
        'something-new',
      ];
      const steps = normalizeToReplaySteps(modernRecording([
        ...noise.map((type, i) => action({ type: type as UserAction['type'], timestamp: T0 + i })),
        null as unknown as UserAction,
        'garbage' as unknown as UserAction,
        clickAction('#btn', T0 + 1000),
      ]));
      expect(steps).toEqual([{ kind: 'click', selector: '#btn' }]);
    });

    it('prefers the events list when a file carries both formats', () => {
      const recording = { ...modernRecording(modernActions), events: [{ type: 'click', selector: '#legacy' }] };
      expect(normalizeToReplaySteps(recording)).toEqual([{ kind: 'click', selector: '#legacy' }]);
    });
  });

  describe('normalizeToReplaySteps — legacy events', () => {
    it('converts a legacy recording into the same steps as before', () => {
      expect(normalizeToReplaySteps(legacyRecording)).toEqual(legacySteps);
    });

    it('keeps the legacy fallbacks (body / input) for missing selectors', () => {
      expect(normalizeToReplaySteps({ startUrl: 'https://example.com', events: [
        { type: 'click' },
        { type: 'input', data: { value: 'x' } },
      ] })).toEqual([
        { kind: 'click', selector: 'body' },
        { kind: 'fill', selector: 'input', value: 'x' },
      ]);
    });
  });

  describe('generateJSScript', () => {
    it('should generate a valid JS script with shebang', () => {
      const script = generateJSScript(baseRecording);
      expect(script).toContain('#!/usr/bin/env node');
      // A dynamic import keeps the file valid as an ES module and as CommonJS.
      expect(script).toContain("const { chromium } = await import('playwright');");
      expect(script).not.toContain('import { chromium }');
      expect(script).not.toContain('@xbrowser/cli');
    });

    it('should include start URL in script', () => {
      const script = generateJSScript(baseRecording);
      expect(script).toContain('https://example.com');
    });

    it('launches chromium through Playwright with an optional local binary', () => {
      const script = generateJSScript(baseRecording);
      expect(script).toContain(
        'chromium.launch({ headless: true, ...(process.env.XBROWSER_CHROMIUM_PATH ? { executablePath: process.env.XBROWSER_CHROMIUM_PATH } : {}) })',
      );
      expect(script).toContain('npm install playwright && npx playwright install chromium');
      expect(script).toContain('XBROWSER_CHROMIUM_PATH');
    });

    it('should generate click events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: '#btn' }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("page.click('#btn')");
    });

    it('should generate input/type events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'type', selector: '#input', data: { value: 'hello' } }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("page.fill('#input', 'hello')");
    });

    it('should generate Enter keypress events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keydown', data: { key: 'Enter' } }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("keyboard.press('Enter')");
    });

    it('should skip non-Enter keypress events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keydown', data: { key: 'Tab' } }],
      };
      const script = generateJSScript(rec);
      expect(script).not.toContain('keyboard.press');
    });

    it('should generate scroll events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'scroll', data: { x: 100, y: 200 } }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain('scrollTo(100, 200)');
    });

    it('should escape special characters in selectors', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: "#btn[data-id='test']" }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("\\'");
    });

    it('should skip navigate/page_load events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'navigate' }, { type: 'page_load' }],
      };
      const script = generateJSScript(rec);
      expect(script).not.toContain('Runtime.evaluate');
    });

    it('should handle empty events', () => {
      const script = generateJSScript(baseRecording);
      expect(script).toContain('Replay completed');
      expect(script).toContain('browser.close');
    });

    it('replays a legacy recording with the same statements as before', () => {
      expect(replayLines(generateJSScript(legacyRecording), '  ')).toEqual([
        "await page.goto(START_URL, { waitUntil: 'domcontentloaded' });",
        "await page.click('#btn');",
        "await page.fill('#search', 'he');",
        "await page.keyboard.press('Enter');",
        "await page.click('#link');",
        'await page.evaluate(() => window.scrollTo(100, 500));',
      ]);
    });

    it('replays a CLI-driven current-format recording step by step', () => {
      expect(replayLines(generateJSScript(modernRecording(modernActions)), '  ')).toEqual([
        "await page.goto(START_URL, { waitUntil: 'domcontentloaded' });",
        "await page.fill('#name', 'Alice');",
        "await page.click('#submit');",
        'await page.evaluate(() => window.scrollBy(0, 600));',
        "await page.goto('https://example.com/results?q=alice', { waitUntil: 'domcontentloaded' });",
      ]);
    });

    it('clears a field with an empty fill', () => {
      const recording = modernRecording([action({ type: 'input', timestamp: T0, element: on('#note'), value: '' })]);
      expect(replayLines(generateJSScript(recording), '  ')).toContain("await page.fill('#note', '');");
    });

    it('replays scroll, hover, fill and key presses of a human-driven recording', () => {
      expect(replayLines(generateJSScript(modernRecording(humanActions)), '  ')).toEqual([
        "await page.goto(START_URL, { waitUntil: 'domcontentloaded' });",
        'await page.evaluate(() => window.scrollTo(120, 900));',
        "await page.hover('#menu');",
        "await page.fill('#search', 'playwright');",
        "await page.keyboard.press('Enter');",
        "await page.keyboard.press('Enter');",
        "await page.keyboard.press('Control+a');",
        "await page.locator('#list').evaluate((el, delta) => { el.scrollLeft += delta.x; el.scrollTop += delta.y; }, { x: 0, y: -300 });",
      ]);
    });
  });

  describe('generatePythonScript', () => {
    it('should generate a valid Python script with shebang', () => {
      const script = generatePythonScript(baseRecording);
      expect(script).toContain('#!/usr/bin/env python3');
      expect(script).toContain('from playwright.async_api import async_playwright');
    });

    it('launches chromium through Playwright with an optional local binary', () => {
      const script = generatePythonScript(baseRecording);
      expect(script).toContain('executable_path=os.environ.get("XBROWSER_CHROMIUM_PATH") or None');
      expect(script).toContain('pip install playwright && playwright install chromium');
    });

    it('should generate click events in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: '.btn' }],
      };
      const script = generatePythonScript(rec);
      expect(script).toContain("page.click('.btn')");
    });

    it('should generate input events in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'input', selector: '#field', data: { value: 'test' } }],
      };
      const script = generatePythonScript(rec);
      expect(script).toContain("page.fill('#field', 'test')");
    });

    it('should generate Enter keypress in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keypress', data: { key: 'Enter' } }],
      };
      const script = generatePythonScript(rec);
      expect(script).toContain("keyboard.press('Enter')");
    });

    it('should skip non-Enter keypress in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keypress', data: { key: 'Escape' } }],
      };
      const script = generatePythonScript(rec);
      expect(script).not.toContain('keyboard.press');
    });

    it('replays a legacy recording with the same steps as the JS script', () => {
      expect(replayLines(generatePythonScript(legacyRecording), '        ')).toEqual([
        'await page.goto(START_URL)',
        "await page.click('#btn')",
        "await page.fill('#search', 'he')",
        "await page.keyboard.press('Enter')",
        "await page.click('#link')",
        'await page.evaluate("() => window.scrollTo(100, 500)")',
      ]);
    });

    it('replays a CLI-driven current-format recording step by step', () => {
      expect(replayLines(generatePythonScript(modernRecording(modernActions)), '        ')).toEqual([
        'await page.goto(START_URL)',
        "await page.fill('#name', 'Alice')",
        "await page.click('#submit')",
        'await page.evaluate("() => window.scrollBy(0, 600)")',
        "await page.goto('https://example.com/results?q=alice')",
      ]);
    });

    it('clears a field with an empty fill', () => {
      const recording = modernRecording([action({ type: 'input', timestamp: T0, element: on('#note'), value: '' })]);
      expect(replayLines(generatePythonScript(recording), '        ')).toContain("await page.fill('#note', '')");
    });

    it('replays scroll, hover, fill and key presses of a human-driven recording', () => {
      expect(replayLines(generatePythonScript(modernRecording(humanActions)), '        ')).toEqual([
        'await page.goto(START_URL)',
        'await page.evaluate("() => window.scrollTo(120, 900)")',
        "await page.hover('#menu')",
        "await page.fill('#search', 'playwright')",
        "await page.keyboard.press('Enter')",
        "await page.keyboard.press('Enter')",
        "await page.keyboard.press('Control+a')",
        "await page.locator('#list').evaluate(\"el => { el.scrollLeft += 0; el.scrollTop += -300; }\")",
      ]);
    });
  });

  describe('generateBashScript', () => {
    it('should generate a valid Bash script with shebang', () => {
      const script = generateBashScript(baseRecording);
      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('xb() { xbrowser --session "$SESSION" "$@"; }');
    });

    it('should replay clicks through the xbrowser CLI', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: '#btn' }],
      };
      expect(bashCommands(generateBashScript(rec))).toEqual([
        "xb goto 'https://example.com'",
        "xb click '#btn'",
        'xb session close',
      ]);
    });

    it('should replay input through the xbrowser CLI', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'input', selector: '#field', data: { value: 'hello' } }],
      };
      expect(bashCommands(generateBashScript(rec))).toEqual([
        "xb goto 'https://example.com'",
        "xb fill '#field' 'hello'",
        'xb session close',
      ]);
    });

    it('should handle empty events', () => {
      const script = generateBashScript(baseRecording);
      expect(script).toContain('Replay completed');
    });

    it('replays a legacy recording through the xbrowser CLI', () => {
      expect(bashCommands(generateBashScript(legacyRecording))).toEqual([
        "xb goto 'https://example.com'",
        "xb click '#btn'",
        "xb fill '#search' 'he'",
        "xb press '#search' 'Enter'",
        "xb click '#link'",
        "xb eval 'window.scrollTo(100, 500)'",
        'xb session close',
      ]);
    });

    it('replays a CLI-driven current-format recording through ONE xbrowser session', () => {
      const script = generateBashScript(modernRecording(modernActions));
      expect(bashCommands(script)).toEqual([
        "xb goto 'https://example.com/'",
        "xb fill '#name' 'Alice'",
        "xb click '#submit'",
        'xb scroll down --distance 600',
        "xb goto 'https://example.com/results?q=alice'",
        'xb session close',
      ]);
      expect(script).toContain('SESSION="replay-demo-flow"');
      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('set -e');
      // closed exactly once on every path: the trap closes after a failed step, the last line after success
      expect(script).toMatch(/^trap 'close_session' EXIT$/m);
      expect(script).toContain('if [ "$SESSION_OPEN" = "1" ]; then SESSION_OPEN=0; xb session close; fi');
      expect(script.trimEnd().endsWith('xb session close')).toBe(true);
      expect(script).not.toContain('curl');
      expect(script).not.toContain('json/execute');
      expect(script).not.toContain('CDP_URL');
      // one session, defined once, used by every step
      expect(script.match(/^xb\(\) /gm)).toHaveLength(1);
      expect(script.match(/^xbrowser /gm)).toBeNull();
    });

    it('replays scroll, hover, fill and key presses of a human-driven recording', () => {
      const script = generateBashScript(modernRecording(humanActions));
      expect(bashCommands(script)).toEqual([
        "xb goto 'https://example.com/'",
        "xb eval 'window.scrollTo(120, 900)'",
        "xb hover '#menu'",
        "xb fill '#search' 'playwright'",
        "xb press '#search' 'Enter'",
        "xb press '#search' 'Enter'",
        "xb scroll up --distance 300 --selector '#list'",
        'xb session close',
      ]);
      // modifier combos have no CLI equivalent — flagged instead of silently mangled
      expect(script).toContain("# NOTE: skipped key combo 'Control+a'");
    });

    it('passes what the CLI cannot take positionally without breaking the run', () => {
      const script = generateBashScript(modernRecording([
        action({ type: 'cdp-fill', timestamp: T0, element: on('#temp'), value: '-5' }),
        action({ type: 'input', timestamp: T0 + 1000, element: on('#note'), value: '' }),
      ]));
      expect(script).toContain("xb fill --selector='#temp' --value='-5'");
      expect(script).toContain("# NOTE: skipped clearing '#note'");
      expect(bashCommands(script)).toEqual([
        "xb goto 'https://example.com/'",
        "xb fill --selector='#temp' --value='-5'",
        'xb session close',
      ]);
    });

    it('names the session after the start URL when the recording has no session name', () => {
      const script = generateBashScript({ startUrl: 'https://example.com/Search Results?q=a b', actions: [] });
      expect(script).toContain('SESSION="replay-example.com-search-results-q-a-b"');
    });
  });

  describe('aggregateEvents', () => {
    it('should aggregate consecutive input events into fill', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [
          { type: 'input', selector: '#f', data: { value: 'a' } },
          { type: 'input', selector: '#f', data: { value: 'ab' } },
        ],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("page.fill('#f', 'ab')");
    });
  });

  describe('string escaping', () => {
    /** Single quote, double quote, newline, backslash, tab, line separator. */
    const hostileValue = 'O\'Brien said "hi"\n\\path\tend\u2028!';
    const hostileSelector = `[data-name='q']`;
    const recording: Recording = modernRecording([
      action({ type: 'cdp-fill', timestamp: T0, element: { tag: 'input', selector: hostileSelector, text: '' }, value: hostileValue }),
      navigation('https://example.com/next?a=1&b=\'two\'', T0 + 1000),
    ], 'https://example.com/?q=\'x\'\n// injected');

    it('escapes single quotes and other special characters in JS', () => {
      const script = generateJSScript(recording);
      expect(script).toContain(
        "await page.fill('[data-name=\\'q\\']', 'O\\'Brien said \\\"hi\\\"\\n\\\\path\\tend\\u2028!');",
      );
      expect(script).toContain("await page.goto('https://example.com/next?a=1&b=\\'two\\'', { waitUntil: 'domcontentloaded' });");
      expect(script).toContain("const START_URL = 'https://example.com/?q=\\'x\\'\\n// injected';");
      // a comment must never be broken out of
      expect(script).toContain('// Start URL: https://example.com/?q=\'x\' // injected');
    });

    it('escapes single quotes and other special characters in Python', () => {
      const script = generatePythonScript(recording);
      expect(script).toContain(
        "await page.fill('[data-name=\\'q\\']', 'O\\'Brien said \\\"hi\\\"\\n\\\\path\\tend\\u2028!')",
      );
      expect(script).toContain("await page.goto('https://example.com/next?a=1&b=\\'two\\'')");
      expect(script).toContain('START_URL = "https://example.com/?q=\\\'x\\\'\\n// injected"');
      expect(script).toContain('# Start URL: https://example.com/?q=\'x\' // injected');
    });

    it("escapes single quotes the shell way ( '\\'' ) in Bash", () => {
      const script = generateBashScript(recording);
      expect(script).toContain(
        "xb fill '[data-name='\\''q'\\'']' 'O'\\''Brien said \"hi\"\n\\path\tend\u2028!'",
      );
      expect(script).toContain("xb goto 'https://example.com/next?a=1&b='\\''two'\\'''");
      expect(script).toContain('# Start URL: https://example.com/?q=\'x\' // injected');
      // the URL itself keeps its line break — it travels inside quotes
      expect(script).toContain("xb goto 'https://example.com/?q='\\''x'\\''\n// injected'");
    });
  });
});
