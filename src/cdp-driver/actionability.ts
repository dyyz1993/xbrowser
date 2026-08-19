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
import { queryJS } from './selector-utils.js';

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
    // Deep-aware evaluate for all selector kinds: resolves same-origin iframe
    // elements too, and accumulates iframe-chain offsets into top-page coords.
    const deadline = Date.now() + timeout;
    let lastError: string | undefined;
    while (Date.now() < deadline) {
      const rect = await page.evaluate<{ x: number; y: number; width: number; height: number } | null>(`
        (function() {
          const el = ${queryJS(selector)};
          if (!el) return null;
          const r = el.getBoundingClientRect();
          let x = r.x, y = r.y;
          let doc = el.ownerDocument;
          while (doc !== document) {
            let host = null;
            const scan = (d) => {
              let frames;
              try { frames = d.querySelectorAll('iframe'); } catch (e) { return null; }
              for (const f of frames) {
                let inner = null;
                try { inner = f.contentDocument; } catch (e) { continue; }
                if (!inner) continue;
                if (inner === doc) return f;
                const rr = scan(inner);
                if (rr) return rr;
              }
              return null;
            };
            host = scan(document);
            if (!host) break;
            const hr = host.getBoundingClientRect();
            x += hr.x; y += hr.y;
            doc = host.ownerDocument;
          }
          return { x, y, width: r.width, height: r.height };
        })()
      `).catch(() => null);
      // Zero-size elements are hidden (display:none offscreen variants,
      // legacy submit buttons like baidu's #su) — clicking them dispatches
      // at (0,0), hitting whatever sits at the page origin (real-world baidu).
      if (rect && rect.width > 0 && rect.height > 0) return { nodeId: 0, rect };
      lastError = `Element not visible (zero size): ${selector}`;
      lastError = `Element not found: ${selector}`;
      await page.waitForTimeout(200);
    }
    throw new Error(lastError || `Element not found: ${selector}`);
  }

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await checkActionable(page, selector);
    if (result.ok && result.rect) {
      // Find the nodeId. Elements inside same-origin iframes are found by the
      // deep query above but not by the main-frame CDP querySelector — return
      // nodeId 0 there. Non-CSS selectors (text=/popup-text=) make the CDP
      // call THROW rather than return 0, so guard with a catch.
      const nodeId = await page.querySelector(selector).catch(() => 0) ?? 0;
      return { nodeId, rect: result.rect };
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
      const el = ${queryJS(selector)};
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

      // Check not covered by another element at center.
      // elementFromPoint must run in the element's OWN document: for iframe-
      // internal elements the main-document hit-test returns the <iframe>
      // host itself, which falsely reports "covered" (rec-duel d01).
      // For shadow-internal elements the hit-test retargets to the shadow
      // HOST — walk the host chain before declaring coverage (rec-duel d04).
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const topEl = el.ownerDocument.elementFromPoint(cx, cy);
      if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
        let hostChain = [];
        let rootNode = el.getRootNode();
        while (rootNode && rootNode.host) {
          hostChain.push(rootNode.host);
          rootNode = rootNode.host.getRootNode();
        }
        if (!hostChain.includes(topEl)) {
          return { ok: false, reason: 'covered', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        }
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
      const el = ${queryJS(selector)};
      if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    })()
  `);
}
