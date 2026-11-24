import type { Recording, RecordingEvent } from './definitions.js';
import type { UserAction } from '../recorder/recording-types.js';

// ─── Canonical replay steps ───────────────────────────────────────

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

type RelativeScrollStep = { kind: 'scroll'; mode: 'relative'; direction: ScrollDirection; distance: number; selector?: string };

/**
 * One replayable step. The generators below never look at a recording
 * directly — `normalizeToReplaySteps` reduces either recording format to
 * this list first, so all three scripts replay exactly the same steps.
 */
export type ReplayStep =
  | { kind: 'goto'; url: string }
  | { kind: 'fill'; selector: string; value: string }
  | { kind: 'click'; selector: string }
  | { kind: 'press'; key: string; selector?: string }
  | { kind: 'scroll'; mode: 'absolute'; x: number; y: number }
  | RelativeScrollStep
  | { kind: 'hover'; selector: string };

/** One interaction can be logged twice: as the injected CLI command (`cdp-click` / `cdp-fill`) and as the page's real-event signal (`click` / `input`). Entries further apart than this are separate interactions. */
const TWIN_WINDOW_MS = 5000;

/** How the recorder encodes a CLI `scroll` command, e.g. `down:600`. */
const SCROLL_COMMAND = /^(up|down|left|right):\s*(\d+(?:\.\d+)?)$/;

/** A click that resolves to the whole document has no target worth replaying. */
const UNTARGETED_SELECTORS = new Set(['html', 'body']);

/**
 * One interaction leaves several log entries: the CLI `fill` click-focuses its
 * field before typing, a click or key press that submits a form or follows a
 * link is accompanied by the page load, and a CLI `scroll` is preceded by the
 * page's own scroll signal. Entries this close together are one interaction.
 */
const ECHO_WINDOW_MS = 3000;

/** Bookkeeping for a kept step: when it happened and how many steps existed right after it. */
interface KeptTrack {
  timestamp?: number;
  stepCount: number;
}

/** A kept step that may have a twin in the other encoding (CLI command ↔ page signal). */
interface KeptInteraction extends KeptTrack {
  fromCommand: boolean;
}

/**
 * Typing into a field emits a run of cumulative `input` snapshots — and, for
 * a CLI fill, its `cdp-fill` twin. A run is replayed as one fill with the
 * latest value.
 */
interface FillGroup {
  selector: string;
  value: string;
  fromCommand: boolean;
  timestamp?: number;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** URL identity for navigations — a trailing slash is not significant. */
function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/**
 * Whether a later action is the second log entry of the interaction behind
 * `kept`: inside the twin window — or, without timestamps, as long as no
 * other step was emitted in between.
 */
function isTwinEcho(timestamp: number | undefined, kept: KeptTrack, stepCount: number): boolean {
  if (typeof timestamp === 'number' && typeof kept.timestamp === 'number') {
    return Math.abs(timestamp - kept.timestamp) <= TWIN_WINDOW_MS;
  }
  return kept.stepCount === stepCount;
}

/**
 * Reduce a recording — the current `actions` format or the legacy `events`
 * format — to the steps a replay has to perform. The start URL is not among
 * them: every generated script opens it first.
 */
export function normalizeToReplaySteps(recording: Recording): ReplayStep[] {
  if (Array.isArray(recording.events)) return stepsFromLegacyEvents(recording.events);
  if (Array.isArray(recording.actions)) return stepsFromActions(recording.actions, asString(recording.startUrl));
  return [];
}

/**
 * Legacy `events` format: selector at the top level, values under `data`.
 * The mapping is the original one — consecutive input events collapse into
 * one fill (the last one wins), only Enter is pressed, navigations are dropped.
 */
function stepsFromLegacyEvents(events: RecordingEvent[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let pendingFill: ReplayStep | null = null;
  const flushFill = (): void => {
    if (pendingFill) steps.push(pendingFill);
    pendingFill = null;
  };

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const data = event.data;
    switch (event.type) {
      case 'type':
      case 'input':
        pendingFill = { kind: 'fill', selector: event.selector || 'input', value: data?.value || '' };
        break;

      case 'keydown':
      case 'keypress':
        flushFill();
        if (data?.key === 'Enter') steps.push({ kind: 'press', key: 'Enter', ...(event.selector ? { selector: event.selector } : {}) });
        break;

      case 'click':
        flushFill();
        steps.push({ kind: 'click', selector: event.selector || 'body' });
        break;

      case 'scroll':
        flushFill();
        steps.push({ kind: 'scroll', mode: 'absolute', x: asNumber(data?.x), y: asNumber(data?.y) });
        break;

      default:
        flushFill();
    }
  }
  flushFill();

  return steps;
}

/**
 * Current recorder format: the selector lives under `element`; the value,
 * key and scroll position sit at the top level of each action.
 */
function stepsFromActions(actions: UserAction[], startUrl: string): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let fillGroup: FillGroup | null = null;
  let firstNavigation = true;
  let lastNavigation: (KeptTrack & { url: string }) | null = null;
  let lastClick = new Map<string, KeptInteraction>();
  let lastFill = new Map<string, KeptInteraction>();
  // A key press without its own target goes to the focused element, which is the field filled last.
  let lastFilledSelector: string | undefined;
  const isEcho = (timestamp: number | undefined, kept: KeptTrack): boolean =>
    isTwinEcho(timestamp, kept, steps.length);

  const flushFill = (): void => {
    if (!fillGroup) return;
    steps.push({ kind: 'fill', selector: fillGroup.selector, value: fillGroup.value });
    lastFilledSelector = fillGroup.selector;
    lastFill.set(`${fillGroup.selector}\n${fillGroup.value}`, {
      timestamp: fillGroup.timestamp,
      stepCount: steps.length,
      fromCommand: fillGroup.fromCommand,
    });
    fillGroup = null;
  };

  const addFill = (selector: string, value: string, fromCommand: boolean, timestamp: number | undefined): void => {
    // The page's echo of a CLI fill, logged once more when the recorder's own dedup missed it.
    const twin = lastFill.get(`${selector}\n${value}`);
    const sameField = fillGroup?.selector === selector;
    if (!sameField && twin && twin.fromCommand !== fromCommand && isEcho(timestamp, twin)) return;
    if (sameField && fillGroup) {
      fillGroup.value = value;
      fillGroup.fromCommand = fillGroup.fromCommand || fromCommand;
      fillGroup.timestamp = timestamp ?? fillGroup.timestamp;
      return;
    }
    flushFill();
    // Clicks on the field right before it is typed into only gave it focus (the
    // CLI `fill` click-focuses twice before typing) — the fill focuses it itself.
    while (steps.length > 0) {
      const last = steps[steps.length - 1];
      if (last.kind !== 'click' || last.selector !== selector) break;
      steps.pop();
    }
    lastClick.delete(selector);
    fillGroup = { selector, value, fromCommand, timestamp };
  };

  const timestampOf = (candidate: UserAction | undefined): number | undefined =>
    typeof candidate?.timestamp === 'number' ? candidate.timestamp : undefined;

  /** Whether both timestamps are known and less than `ECHO_WINDOW_MS` apart. */
  const withinEchoWindow = (a: number | undefined, b: number | undefined): boolean =>
    typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= ECHO_WINDOW_MS;

  /** Whether `other` is a click or key press logged right next to `timestamp`. */
  const isInteractionNear = (other: UserAction | undefined, timestamp: number | undefined): boolean => {
    const type = other?.type;
    if (type !== 'click' && type !== 'cdp-click' && type !== 'keydown') return false;
    return withinEchoWindow(timestampOf(other), timestamp);
  };

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (!action || typeof action !== 'object') continue;
    const selector = asString(action.element?.selector);
    const timestamp = timestampOf(action);
    const next = actions[index + 1];

    switch (action.type) {
      case 'cdp-fill':
      case 'input':
        if (selector) addFill(selector, asString(action.value), action.type === 'cdp-fill', timestamp);
        break;

      case 'navigation':
      case 'goto': {
        // CLI `goto` actions carry the target in `url`; older recordings kept it in `value`.
        const url = asString(action.url) || (action.type === 'goto' ? asString(action.value) : '');
        if (!url) break;
        // A page load right next to a click or key press is that interaction's
        // result (a submitted form, a followed link): replaying the interaction
        // produces it, and an explicit goto would only reload the page without
        // its form data. The CLI command is logged after it ran, so the load can
        // precede the click in the file.
        if (!firstNavigation && (isInteractionNear(actions[index - 1], timestamp) || isInteractionNear(next, timestamp))) break;
        const isFirst = firstNavigation;
        firstNavigation = false;
        flushFill();
        // One page load is logged twice: as the navigation signal and as the CLI `goto` command.
        if (lastNavigation && lastNavigation.url === url.replace(/\/+$/, '') && lastNavigation.stepCount === steps.length) break;
        // The first navigation is the initial page load, which the start URL already covers.
        if (!(isFirst && sameUrl(url, startUrl))) steps.push({ kind: 'goto', url });
        lastNavigation = { url: url.replace(/\/+$/, ''), stepCount: steps.length };
        break;
      }

      case 'click':
      case 'cdp-click': {
        flushFill();
        if (!selector || UNTARGETED_SELECTORS.has(selector)) break;
        const fromCommand = action.type === 'cdp-click';
        const twin = lastClick.get(selector);
        if (twin && twin.fromCommand !== fromCommand && isEcho(timestamp, twin)) break;
        steps.push({ kind: 'click', selector });
        lastClick.set(selector, { timestamp, stepCount: steps.length, fromCommand });
        break;
      }

      case 'keydown': {
        flushFill();
        // Playwright names the modifier "Control"; the recorder writes "Ctrl".
        const key = asString(action.key).replace(/^Ctrl\+/, 'Control+');
        const target = selector || lastFilledSelector;
        if (key) steps.push({ kind: 'press', key, ...(target ? { selector: target } : {}) });
        break;
      }

      case 'scroll': {
        flushFill();
        const command = SCROLL_COMMAND.exec(asString(action.value));
        if (command) {
          steps.push({
            kind: 'scroll',
            mode: 'relative',
            direction: command[1] as ScrollDirection,
            distance: Number(command[2]),
            ...(selector ? { selector } : {}),
          });
          break;
        }
        // The page's own scroll signal of a CLI `scroll` command is logged just
        // before the command; the command carries the intent.
        if (next?.type === 'scroll' && SCROLL_COMMAND.test(asString(next.value)) && withinEchoWindow(timestampOf(next), timestamp)) break;
        const x = Number(action.scrollX);
        const y = Number(action.scrollY);
        if (Number.isFinite(x) || Number.isFinite(y)) {
          steps.push({ kind: 'scroll', mode: 'absolute', x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 });
        }
        break;
      }

      case 'hover':
        flushFill();
        if (selector) steps.push({ kind: 'hover', selector });
        break;

      // submit, popup_appear, cdp-eval, filechooser, drag, … are observations
      // or side effects of the steps above — there is nothing to replay.
      default:
        break;
    }
  }
  flushFill();

  return steps;
}

// ─── Generators ───────────────────────────────────────────────────

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // Remaining control characters and the JS/Python line separators would
    // otherwise be pasted raw into the string literal.
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (char) =>
      char === '\b' ? '\\b' : char === '\f' ? '\\f' : `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Text for a generated comment — a line break would break out of the comment. */
function commentText(str: string): string {
  return str.replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/** POSIX shell single-quoting: `Alice's` becomes `'Alice'\''s'`. */
function shQuote(str: string): string {
  return `'${str.replace(/\0/g, '').replace(/'/g, `'\\''`)}'`;
}

function shDoubleQuote(str: string): string {
  return `"${str.replace(/[\\"$`]/g, '\\$&')}"`;
}

/** `replay-<session name>`, or a slug of the start URL when the recording has no session name. */
function sessionSlug(recording: Recording): string {
  const base = asString(recording.sessionName)
    || asString(recording.startUrl).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 48)
    .replace(/[.-]+$/g, '');
  return `replay-${slug || 'recording'}`;
}

/** Relative scroll as wheel deltas: up and left are negative. */
function scrollDelta(step: RelativeScrollStep): { x: number; y: number } {
  return {
    x: step.direction === 'left' ? -step.distance : step.direction === 'right' ? step.distance : 0,
    y: step.direction === 'up' ? -step.distance : step.direction === 'down' ? step.distance : 0,
  };
}

/**
 * Generate a Node.js replay script from a recording.
 *
 * @param recording - The recording session to convert.
 * @returns A self-contained Playwright script string.
 */
export function generateJSScript(recording: Recording): string {
  const steps = normalizeToReplaySteps(recording);
  const startUrl = asString(recording.startUrl);

  let script = `#!/usr/bin/env node
// Auto-generated replay script from xbrowser
// Start URL: ${commentText(startUrl)}
// Steps: ${steps.length}
//
// Requires Playwright on Node.js 20 or newer (install it next to this script):
//   npm install playwright && npx playwright install chromium
// or set XBROWSER_CHROMIUM_PATH to reuse an installed Chrome/Chromium.

const START_URL = '${escapeString(startUrl)}';

async function main() {
  // A dynamic import keeps the script valid as both an ES module and a CommonJS
  // file, so it runs the same way inside and outside a package that sets "type".
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.XBROWSER_CHROMIUM_PATH ? { executablePath: process.env.XBROWSER_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to', START_URL);
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
`;

  for (const step of steps) {
    switch (step.kind) {
      case 'goto':
        script += `
  // Navigate: ${commentText(step.url)}
  await page.goto('${escapeString(step.url)}', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
`;
        break;

      case 'fill':
        script += `
  // Fill: ${commentText(step.selector)}
  await page.fill('${escapeString(step.selector)}', '${escapeString(step.value)}');
  await page.waitForTimeout(100);
`;
        break;

      case 'click':
        script += `
  // Click: ${commentText(step.selector)}
  await page.click('${escapeString(step.selector)}');
  await page.waitForTimeout(100);
`;
        break;

      case 'press':
        script += `
  // Press: ${commentText(step.key)}
  await page.keyboard.press('${escapeString(step.key)}');
  await page.waitForTimeout(100);
`;
        break;

      case 'scroll': {
        const delta = step.mode === 'relative' ? scrollDelta(step) : { x: step.x, y: step.y };
        // A real scroll signal holds the window position (scrollTo); a CLI scroll holds a distance (scrollBy).
        const scroll = step.mode === 'absolute'
          ? `await page.evaluate(() => window.scrollTo(${delta.x}, ${delta.y}));`
          : step.selector
            ? `await page.locator('${escapeString(step.selector)}').evaluate((el, delta) => { el.scrollLeft += delta.x; el.scrollTop += delta.y; }, { x: ${delta.x}, y: ${delta.y} });`
            : `await page.evaluate(() => window.scrollBy(${delta.x}, ${delta.y}));`;
        script += `
  // ${scrollComment(step)}
  ${scroll}
  await page.waitForTimeout(50);
`;
        break;
      }

      case 'hover':
        script += `
  // Hover: ${commentText(step.selector)}
  await page.hover('${escapeString(step.selector)}');
  await page.waitForTimeout(100);
`;
        break;
    }
  }

  script += `
  console.log('Replay completed!');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
`;

  return script;
}

function scrollComment(step: Extract<ReplayStep, { kind: 'scroll' }>): string {
  if (step.mode === 'absolute') return `Scroll to (${step.x}, ${step.y})`;
  return `Scroll ${commentText(step.selector ?? 'the page')} ${step.direction} by ${step.distance}px`;
}

/**
 * Generate a Python replay script from a recording.
 *
 * @param recording - The recording session to convert.
 * @returns A self-contained Python script string using Playwright async API
 *          (requires: pip install playwright && playwright install chromium).
 */
export function generatePythonScript(recording: Recording): string {
  const steps = normalizeToReplaySteps(recording);
  const startUrl = asString(recording.startUrl);

  let script = `#!/usr/bin/env python3
# Auto-generated replay script from xbrowser
# Start URL: ${commentText(startUrl)}
# Steps: ${steps.length}
#
# Requires Playwright:
#   pip install playwright && playwright install chromium
# or set XBROWSER_CHROMIUM_PATH to reuse an installed Chrome/Chromium.

import asyncio
import os

from playwright.async_api import async_playwright

START_URL = "${escapeString(startUrl)}"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path=os.environ.get("XBROWSER_CHROMIUM_PATH") or None,
        )
        context = await browser.new_context()
        page = await context.new_page()

        print(f"Navigating to {START_URL}")
        await page.goto(START_URL)
        await asyncio.sleep(1)
`;

  for (const step of steps) {
    switch (step.kind) {
      case 'goto':
        script += `
        # Navigate: ${commentText(step.url)}
        await page.goto('${escapeString(step.url)}')
        await asyncio.sleep(1)
`;
        break;

      case 'fill':
        script += `
        # Fill: ${commentText(step.selector)}
        await page.fill('${escapeString(step.selector)}', '${escapeString(step.value)}')
        await asyncio.sleep(0.1)
`;
        break;

      case 'click':
        script += `
        # Click: ${commentText(step.selector)}
        await page.click('${escapeString(step.selector)}')
        await asyncio.sleep(0.1)
`;
        break;

      case 'press':
        script += `
        # Press: ${commentText(step.key)}
        await page.keyboard.press('${escapeString(step.key)}')
        await asyncio.sleep(0.1)
`;
        break;

      case 'scroll': {
        const delta = step.mode === 'relative' ? scrollDelta(step) : { x: step.x, y: step.y };
        const scroll = step.mode === 'absolute'
          ? `await page.evaluate("() => window.scrollTo(${delta.x}, ${delta.y})")`
          : step.selector
            ? `await page.locator('${escapeString(step.selector)}').evaluate("el => { el.scrollLeft += ${delta.x}; el.scrollTop += ${delta.y}; }")`
            : `await page.evaluate("() => window.scrollBy(${delta.x}, ${delta.y})")`;
        script += `
        # ${scrollComment(step)}
        ${scroll}
        await asyncio.sleep(0.05)
`;
        break;
      }

      case 'hover':
        script += `
        # Hover: ${commentText(step.selector)}
        await page.hover('${escapeString(step.selector)}')
        await asyncio.sleep(0.1)
`;
        break;
    }
  }

  script += `
        print("Replay completed!")
        await browser.close()


asyncio.run(main())
`;

  return script;
}

/**
 * Generate a Bash replay script from a recording.
 *
 * @param recording - The recording session to convert.
 * @returns A Bash script string that replays the steps through the xbrowser
 *          CLI in a single session.
 */
export function generateBashScript(recording: Recording): string {
  const steps = normalizeToReplaySteps(recording);
  const startUrl = asString(recording.startUrl);

  let script = `#!/bin/bash
# Auto-generated replay script from xbrowser — requires the xbrowser CLI
# Start URL: ${commentText(startUrl)}
# Steps: ${steps.length}
#
# Replays in ONE xbrowser session. It is closed on exit — also when a step fails.
# Set XBROWSER_CHROMIUM_PATH to make xbrowser use an installed Chrome/Chromium.

SESSION=${shDoubleQuote(sessionSlug(recording))}
xb() { xbrowser --session "$SESSION" "$@"; }

set -e
# The session is closed on every exit — after the last step, on a failed step, on Ctrl-C.
SESSION_OPEN=1
close_session() {
  local status=$?
  if [ "$SESSION_OPEN" = "1" ]; then SESSION_OPEN=0; xb session close; fi
  exit "$status"
}
trap 'close_session' EXIT
`;
  if (startUrl) script += `\n# Open the start page\nxb goto ${shQuote(startUrl)}\n`;

  for (const step of steps) {
    switch (step.kind) {
      case 'goto':
        script += `\n# Navigate: ${commentText(step.url)}\nxb goto ${shQuote(step.url)}\n`;
        break;

      case 'fill':
        if (step.value === '') {
          // `xbrowser fill <selector> ""` is rejected: the CLI takes the value as a positional argument.
          script += `\n# NOTE: skipped clearing ${shQuote(step.selector)} — the xbrowser CLI cannot pass an empty value\n`;
        } else if (step.value.startsWith('-')) {
          // A positional value starting with "-" would be taken for a flag.
          script += `\n# Fill: ${commentText(step.selector)}\nxb fill --selector=${shQuote(step.selector)} --value=${shQuote(step.value)}\n`;
        } else {
          script += `\n# Fill: ${commentText(step.selector)}\nxb fill ${shQuote(step.selector)} ${shQuote(step.value)}\n`;
        }
        break;

      case 'click':
        script += `\n# Click: ${commentText(step.selector)}\nxb click ${shQuote(step.selector)}\n`;
        break;

      case 'press':
        if (step.key.includes('+')) {
          // `xbrowser press` sends one key: a combo would arrive as a key literally named "Control+a".
          script += `\n# NOTE: skipped key combo ${shQuote(step.key)} — the xbrowser CLI press takes single keys only\n`;
        } else {
          script += `\n# Press: ${commentText(step.key)}\nxb press ${shQuote(step.selector || 'body')} ${shQuote(step.key)}\n`;
        }
        break;

      case 'scroll':
        // `xbrowser scroll` only scrolls by a distance, so an absolute window position goes through eval.
        script += step.mode === 'absolute'
          ? `\n# Scroll to (${step.x}, ${step.y})\nxb eval 'window.scrollTo(${step.x}, ${step.y})'\n`
          : `\n# ${scrollComment(step)}\nxb scroll ${step.direction} --distance ${step.distance}${step.selector ? ` --selector ${shQuote(step.selector)}` : ''}\n`;
        break;

      case 'hover':
        script += `\n# Hover: ${commentText(step.selector)}\nxb hover ${shQuote(step.selector)}\n`;
        break;
    }
  }

  script += `
echo "Replay completed!"
SESSION_OPEN=0
xb session close
`;

  return script;
}
