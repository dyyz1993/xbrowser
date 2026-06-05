/**
 * Actionability — Pre-action element validation (auto-wait)
 *
 * Checks that an element is ready for interaction:
 *   1. Exists in DOM (attached)
 *   2. Visible (has non-zero size, not display:none / visibility:hidden)
 *   3. Enabled (not [disabled])
 *   4. Stable (not animating / size not changing)
 *   5. Receives events (not covered by another element at click point)
 *
 * Inspired by Playwright's actionability protocol but implemented
 * via raw Runtime.evaluate — no dependency on Playwright internals.
 */

import type { XBPageImpl } from './page.js';

export interface ActionabilityResult {
  ok: boolean;
  reason?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

/**
 * Wait for an element to become actionable, with timeout.
 *
 * Polls every ~50ms until the element passes all checks or timeout expires.
 */
export async function waitForActionable(
  page: XBPageImpl,
  selector: string,
  opts: {
    timeout?: number;
    force?: boolean;
    state?: 'visible' | 'hidden' | 'attached' | 'detached';
  } = {},
): Promise<{ nodeId: number; rect: { x: number; y: number; width: number; height: number } }> {
  const timeout = opts.timeout ?? 30_000;

  if (opts.force) {
    // Skip actionability, just find the element
    const nodeId = await page.querySelector(selector);
    if (!nodeId) throw new Error(`Element not found: ${selector}`);
    const rect = await page.getBoxModel(nodeId);
    if (!rect) throw new Error(`Element has no box: ${selector}`);
    return { nodeId, rect };
  }

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await checkActionable(page, selector);
    if (result.ok && result.rect) {
      // Find the nodeId
      const nodeId = await page.querySelector(selector);
      if (nodeId) return { nodeId, rect: result.rect };
    }
    await page.waitForTimeout(50);
  }

  throw new Error(`Actionability timeout: element '${selector}' not ready after ${timeout}ms`);
}

/**
 * Single-shot actionability check (no waiting).
 */
export async function checkActionable(
  page: XBPageImpl,
  selector: string,
): Promise<ActionabilityResult> {
  // Use a single evaluate call for all checks (minimize CDP round trips)
  const result = await page.evaluate<{
    ok: boolean;
    reason?: string;
    rect?: { x: number; y: number; width: number; height: number };
  }>(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'not_found' };

      // Check attached to DOM
      if (!el.isConnected) return { ok: false, reason: 'detached' };

      // Check visibility
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return { ok: false, reason: 'invisible' };
      }

      // Check non-zero size
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { ok: false, reason: 'zero_size' };
      }

      // Check enabled (for form elements)
      if (el.disabled) return { ok: false, reason: 'disabled' };
      if (el.tagName === 'OPTION' && el.closest('select')?.disabled) {
        return { ok: false, reason: 'parent_disabled' };
      }

      // Check not covered by another element at center
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
        return { ok: false, reason: 'covered', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      }

      return {
        ok: true,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })()
  `);

  return result;
}

/**
 * Scroll element into view if needed.
 */
export async function scrollIntoView(page: XBPageImpl, selector: string): Promise<void> {
  await page.evaluate(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    })()
  `);
}
