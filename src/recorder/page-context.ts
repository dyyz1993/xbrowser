import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '../browser-shim.js';
import type { ClickContext, UserAction } from './recording-types.js';

export const SNAPSHOT_TYPES = new Set([
'click', 'dblclick', 'navigation', 'goto', 'submit',
'cdp-click', 'cdp-fill', 'input', 'change', 'filechooser',
'popup_appear',
]);

export type SnapshotThrottle = Map<string, number>;

/**
 * Capture a screenshot of the target element for key action types.
 * Returns a base64-encoded PNG string, or undefined if the element has no
 * selector or the screenshot fails (non-critical — never blocks recording).
 *
 * Only captures for: click, input, change, dblclick, and their CDP counterparts.
 *
 * Retry strategy (3 attempts, 3s each):
 *   1. element screenshot via locator
 *   2. retry element screenshot (element may have been animating/detached)
 *   3. fallback to viewport screenshot (so we always get *something*)
 */
export async function captureElementScreenshot(
  page: Page,
  action: { type: string; element?: { selector?: string } }
): Promise<string | undefined> {
  const keyTypes = ['click', 'input', 'change', 'dblclick', 'cdp-click', 'cdp-fill', 'filechooser'];
  if (!keyTypes.includes(action.type)) return;
  if (!action.element?.selector) return;

  const selector = action.element.selector;

  // Attempt 1: element screenshot
  try {
    const buffer = await page.locator(selector).first().screenshot({
      type: 'png',
      timeout: 3000,
    });
    return buffer.toString('base64');
  } catch {
    // element not found / not visible / timed out — retry below
  }

  // Attempt 2: wait for element to be visible, then screenshot
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 2000 });
    const buffer = await page.locator(selector).first().screenshot({
      type: 'png',
      timeout: 3000,
    });
    return buffer.toString('base64');
  } catch {
    // still failing — fall through to viewport fallback
  }

  // Attempt 3: viewport screenshot as fallback (always succeeds if page is alive)
  try {
    const buffer = await page.screenshot({ type: 'png', timeout: 3000 });
    return buffer.toString('base64');
  } catch {
    return; // page may be closed — give up gracefully
  }
}

/**
 * Action types that trigger auto-snapshot capture.
 * Hover is excluded — it's too noisy and rarely changes the page visually.
 * Popup_appear captures the popup state (after only).
 */

/**
 * Throttle key for snapshot capture to avoid too many during rapid inputs.
 * Returns true if this action should be throttled (skip snapshot).
 */
export function isSnapshotThrottled(
  type: string,
  selector: string | undefined,
  snapshotThrottle: SnapshotThrottle,
): boolean {
  // For input/change on the same element, throttle to 1 snapshot per 2 seconds
  if (type === 'input' || type === 'change' || type === 'cdp-fill') {
    const key = `${type}|${selector || ''}`;
    const last = snapshotThrottle.get(key);
    const now = Date.now();
    if (last && now - last < 2000) return true;
    snapshotThrottle.set(key, now);
  }
  return false;
}

/**
 * Capture a viewport screenshot + compact accessibility tree for a key action.
 * - PNG stored in .tmp/snapshots/ (temporary, easy to clean up)
 * - aria tree stored inline as compact text on the action (searchable via grep)
 *
 * Non-blocking (errors silently caught). Throttled for rapid inputs.
 */
export async function captureAutoSnapshot(
  page: Page,
action: UserAction,
suffix: 'after' | 'before' = 'after',
snapshotsDir: string,
snapshotThrottle: SnapshotThrottle,
): Promise<void> {
  if (!SNAPSHOT_TYPES.has(action.type)) return;
  if (isSnapshotThrottled(action.type, action.element?.selector, snapshotThrottle)) return;

  // Ensure .tmp/snapshots directory exists
  const snapDir = snapshotsDir;
  mkdirSync(snapDir, { recursive: true });

  const stepId = String(action.id).padStart(3, '0');
  const snapshot: NonNullable<UserAction['snapshots']> = {};

  // Capture viewport screenshot (PNG → .tmp/snapshots/)
  try {
    const pngPath = join(snapDir, `step-${stepId}-${suffix}.png`);
    const buffer = await page.screenshot({ type: 'png', timeout: 5000 });
    writeFileSync(pngPath, buffer);
    snapshot.png = `.tmp/snapshots/step-${stepId}-${suffix}.png`;
  } catch {
    // Non-critical
  }

  // Capture compact accessibility tree (inline text, no extra file)
  try {
    snapshot.aria = await page.evaluate<string>(`
      (function() {
        try {
          var parts = [];
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
          var node;
          while (node = walker.nextNode()) {
            var tag = node.tagName.toLowerCase();
            var role = node.getAttribute('role') || '';
            var text = (node.textContent || '').trim().substring(0, 60);
            var ariaLabel = node.getAttribute('aria-label') || '';
            if (role || tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea') {
              parts.push((role || tag) + ': ' + (ariaLabel || text).substring(0, 40));
            }
          }
          return parts.slice(0, 100).join(' | ');
        } catch(e) { return ''; }
      })()
    `);
  } catch {
    // Non-critical
  }

  if (snapshot.png || snapshot.aria) {
    action.snapshots = snapshot;
  }
}

/**
 * After a click, wait 300ms then scan for popover/dropdown/menu elements
 * near the click position. This runs server-side to avoid race conditions
 * with the client-side poll interval.
 */
export async function captureClickContext(page: Page, cx: number, cy: number): Promise<ClickContext | undefined> {
  // Wait for animations/transitions to settle
  await new Promise(r => setTimeout(r, 300));

  try {
    const ctx = await page.evaluate<ClickContext>(`
      (function() {
        var cx = ${cx}, cy = ${cy};
        var POPOVER_SELECTORS = [
          '[role="menu"]','[role="listbox"]','[role="dialog"]','[role="tooltip"]','[role="popover"]',
          '[role="combobox"]','[role="tree"]','[role="grid"]',
          '.popover','.popup','.dropdown','.menu','.modal','.tooltip','.panel',
          '[class*="popover"]','[class*="popup"]','[class*="dropdown"]','[class*="menu"]',
          '[class*="tooltip"]','[class*="modal"]','[class*="panel"]','[class*="overlay"]','[class*="sheet"]',
          '[data-popup]','[data-dropdown]','[data-menu]','[data-popover"]',
          '.semi-dropdown','.semi-popover','.semi-modal',
          '.ant-dropdown','.ant-popover','.ant-modal',
          '.el-dropdown','.el-popover','.el-dialog',
          '.t-dropdown','.t-popup','.t-dialog'
        ];

        function isNear(el, x, y, range) {
          try {
            var r = el.getBoundingClientRect();
            if (!r || r.width === 0 || r.height === 0) return false;
            return !(r.left > x + range || r.right < x - range || r.top > y + range || r.bottom < y - range);
          } catch(e) { return false; }
        }

        var result = { appeared: [], disappeared: [], stateChanges: [] };
        var seenElements = new Set();

        for (var si = 0; si < POPOVER_SELECTORS.length; si++) {
          try {
            var els = document.querySelectorAll(POPOVER_SELECTORS[si]);
            for (var j = 0; j < els.length; j++) {
              var el = els[j];
              if (seenElements.has(el)) continue;
              if (!isNear(el, cx, cy, 300)) continue;
              var rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              seenElements.add(el);

              var items = [];
              var children = el.querySelectorAll('a,button,[role="menuitem"],[role="option"],[role="treeitem"],li,div[class*="item"]');
              var seenItemTexts = new Set();
              for (var k = 0; k < Math.min(children.length, 30); k++) {
                var child = children[k];
                var childText = (child.textContent || '').trim().substring(0, 60);
                if (!childText || seenItemTexts.has(childText)) continue;
                seenItemTexts.add(childText);
                var ci = { text: childText };
                try { if (child.disabled || child.getAttribute('aria-disabled') === 'true') ci.disabled = true; } catch(e) {}
                try { if (child.tagName) ci.tag = child.tagName.toLowerCase(); } catch(e) {}
                try { if (child.href) ci.href = child.href.substring(0, 80); } catch(e) {}
                items.push(ci);
              }

              result.appeared.push({
                tag: el.tagName.toLowerCase(),
                selector: el.id ? '#' + el.id : undefined,
                role: el.getAttribute('role'),
                text: (el.textContent || '').trim().substring(0, 100),
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                items: items
              });
            }
          } catch(e) { /* skip invalid selectors */ }
        }

        var allInteractive = document.querySelectorAll('[aria-expanded],[disabled],[aria-disabled],[aria-selected],[data-state]');
        for (var i = 0; i < allInteractive.length; i++) {
          var el2 = allInteractive[i];
          if (!isNear(el2, cx, cy, 200)) continue;
          var info = { tag: el2.tagName.toLowerCase(), text: (el2.textContent || '').trim().substring(0, 60) };
          try { if (el2.id) info.id = el2.id; } catch(e) {}
          try { if (el2.getAttribute('aria-expanded')) info.ariaExpanded = el2.getAttribute('aria-expanded'); } catch(e) {}
          try { if (el2.disabled || el2.getAttribute('aria-disabled') === 'true') info.disabled = true; } catch(e) {}
          try { if (el2.getAttribute('aria-selected')) info.ariaSelected = el2.getAttribute('aria-selected'); } catch(e) {}
          try { if (el2.getAttribute('data-state')) info.dataState = el2.getAttribute('data-state'); } catch(e) {}
          result.stateChanges.push(info);
        }

        return result;
      })()
    `) as ClickContext;

    if (ctx.appeared.length > 0 || ctx.stateChanges.length > 0) {
      return ctx;
    }
  } catch {
    // page may have navigated
  }
  return undefined;
}
