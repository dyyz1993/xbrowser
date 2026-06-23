/**
 * XBLocator — Element selector + interaction
 *
 * Provides a fluent API for finding and interacting with elements.
 * Delegates to actionability checks before performing actions.
 *
 * Supported selector syntaxes:
 *   - CSS:           "div > button.primary"
 *   - text:          "text=Submit" (case-insensitive substring)
 *   - text-exact:    "text=\"Submit\"" (exact match)
 *   - xpath:         "xpath=//div[@id='foo']"
 *   - role:          "role=button[name='Submit']"
 *   - chain:         "css=div >> text=Submit" (Playwright-compatible chain)
 */

import type {
  XBLocator, XBClickOptions, XBFillOptions, XBScreenshotOptions,
} from './types.js';
import type { XBPageImpl } from './page.js';
import { waitForActionable, scrollIntoView } from './actionability.js';
import { queryJS, queryAllJS } from './selector-utils.js';

export class XBLocatorImpl implements XBLocator {
  protected page: XBPageImpl;
  protected selector: string;

  constructor(page: XBPageImpl, selector: string) {
    this.page = page;
    this.selector = selector;
  }

  /** Resolve selector to a JS expression that finds a single element (CSS or xpath). */
  protected _q(sel: string): string { return queryJS(sel); }

  /** Resolve selector to a JS expression that finds all matching elements (CSS or xpath). */
  protected _qa(sel: string): string { return queryAllJS(sel); }

  // ── Actions ─────────────────────────────────────────────────

  async click(opts: XBClickOptions = {}): Promise<void> {
    const { rect } = await waitForActionable(this.page, this.selector, opts);

    // Scroll into view if needed
    await scrollIntoView(this.page, this.selector);

    // Re-check position after scroll
    const updatedRect = await this.page.evaluate<{ x: number; y: number; width: number; height: number }>(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);

    const finalRect = updatedRect ?? rect;
    const cx = finalRect.x + finalRect.width / 2;
    const cy = finalRect.y + finalRect.height / 2;

    // Execute click via mouse
    await this.page.mouse.click(cx, cy, {
      button: opts.button ?? 'left',
      clickCount: opts.clickCount ?? 1,
      delay: opts.delay,
    });
  }

  async fill(value: string, opts: XBFillOptions = {}): Promise<void> {
    await waitForActionable(this.page, this.selector, opts);
    await scrollIntoView(this.page, this.selector);

    // Focus the element, clear existing content, then use insertText
    await this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el) throw new Error('Element not found: ${this.selector.replace(/'/g, "\\'")}');
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    // Use insertText for fast, reliable text input
    await this.page.keyboard.insertText(value);

    // Dispatch change event for React/Vue compatibility
    await this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
  }

  async press(key: string, opts: { timeout?: number } = {}): Promise<void> {
    await waitForActionable(this.page, this.selector, { timeout: opts.timeout });
    await scrollIntoView(this.page, this.selector);

    // Focus
    await this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (el) el.focus();
      })()
    `);

    await this.page.keyboard.press(key);
  }

  async pressSequentially(text: string, opts: { delay?: number; timeout?: number } = {}): Promise<void> {
    await waitForActionable(this.page, this.selector, { timeout: opts.timeout });
    await scrollIntoView(this.page, this.selector);

    // Focus
    await this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (el) el.focus();
      })()
    `);

    await this.page.keyboard.type(text, { delay: opts.delay });
  }

  async hover(opts: { timeout?: number; force?: boolean } = {}): Promise<void> {
    if (!opts.force) {
      const { rect } = await waitForActionable(this.page, this.selector, { timeout: opts.timeout });
      await scrollIntoView(this.page, this.selector);
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      await this.page.mouse.move(cx, cy);
    } else {
      // force: skip actionability check, just scroll + hover
      await scrollIntoView(this.page, this.selector);
      const rect = await this.page.evaluate<{ x: number; y: number; width: number; height: number }>(`
        (function() {
          const el = ${this._q(this.selector)};
          if (!el) return { x: 0, y: 0, width: 0, height: 0 };
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()
      `);
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      await this.page.mouse.move(cx, cy);
    }
  }

  async type(text: string, opts: { delay?: number; timeout?: number } = {}): Promise<void> {
    await this.pressSequentially(text, opts);
  }

  async check(opts: { timeout?: number } = {}): Promise<void> {
    await waitForActionable(this.page, this.selector, { timeout: opts.timeout });
    const isChecked = await this.page.evaluate<boolean>(`
      (function() {
        const el = ${this._q(this.selector)};
        return el?.checked === true;
      })()
    `);
    if (!isChecked) {
      await this.click({ timeout: opts.timeout });
    }
  }

  async uncheck(opts: { timeout?: number } = {}): Promise<void> {
    await waitForActionable(this.page, this.selector, { timeout: opts.timeout });
    const isChecked = await this.page.evaluate<boolean>(`
      (function() {
        const el = ${this._q(this.selector)};
        return el?.checked === true;
      })()
    `);
    if (isChecked) {
      await this.click({ timeout: opts.timeout });
    }
  }

  async selectOption(
    value: string | string[] | { label?: string; value?: string; index?: number },
  ): Promise<string[]> {
    await waitForActionable(this.page, this.selector);

    const values = Array.isArray(value) ? value : [value];

    // Use evaluate to set the select value
    const selected = await this.page.evaluate<string[]>(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el || el.tagName !== 'SELECT') throw new Error('Not a select element');

        const values = ${JSON.stringify(values)};
        const selectedValues = [];

        for (const opt of el.options) {
          for (const v of values) {
            if (typeof v === 'object') {
              if (v.label && opt.label === v.label) { opt.selected = true; selectedValues.push(opt.value); }
              else if (v.value && opt.value === v.value) { opt.selected = true; selectedValues.push(opt.value); }
              else if (v.index !== undefined && opt.index === v.index) { opt.selected = true; selectedValues.push(opt.value); }
            } else if (opt.value === v || opt.label === v) {
              opt.selected = true;
              selectedValues.push(opt.value);
            }
          }
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return selectedValues;
      })()
    `);

    return selected;
  }

  async screenshot(opts: XBScreenshotOptions = {}): Promise<Buffer> {
    await waitForActionable(this.page, this.selector);

    // Get element's bounding box via evaluate (supports both CSS and xpath)
    const box = await this.page.evaluate<{ x: number; y: number; width: number; height: number } | null>(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);
    if (!box) throw new Error(`Element not found: ${this.selector}`);

    return this.page.screenshot({
      ...opts,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  }

  // ── State checks ────────────────────────────────────────────

  async waitFor(opts: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number } = {}): Promise<void> {
    await this.page.waitForSelector(this.selector, opts);
  }

  async count(): Promise<number> {
    return this.page.evaluate<number>(`
      ${this._qa(this.selector)}.length
    `);
  }

  async isVisible(): Promise<boolean> {
    try {
      const result = await this.page.evaluate(`
        (function() {
          const el = ${this._q(this.selector)};
          if (!el) return false;
          if (!el.isConnected) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })()
      `);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  async isHidden(): Promise<boolean> {
    return !(await this.isVisible());
  }

  async isEnabled(): Promise<boolean> {
    return this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el) return false;
        return !el.disabled;
      })()
    `);
  }

  async isDisabled(): Promise<boolean> {
    return !(await this.isEnabled());
  }

  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);
  }

  // ── Text/HTML ───────────────────────────────────────────────

  async textContent(): Promise<string | null> {
    return this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        return el?.textContent ?? null;
      })()
    `);
  }

  async innerText(): Promise<string> {
    return this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el) throw new Error('Element not found');
        return el.innerText;
      })()
    `);
  }

  async innerHTML(): Promise<string> {
    return this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (!el) throw new Error('Element not found');
        return el.innerHTML;
      })()
    `);
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        return el?.getAttribute(${JSON.stringify(name)}) ?? null;
      })()
    `);
  }

  // ── Evaluate ────────────────────────────────────────────────

  async evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R> {
    const fnBody = typeof fn === 'function' ? fn.toString() : fn;
    const sel = JSON.stringify(this.selector);
    const xpathPrefix = this.selector.startsWith('xpath=') ? JSON.stringify(this.selector.slice(6)) : 'null';
    return this.page.evaluate<R>(
      `(function(sel, xpathExpr, fnStr, ...evalArgs) {
        const el = xpathExpr
          ? document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
          : document.querySelector(sel);
        if (!el) throw new Error('No element found for selector: ' + sel);
        const fn = new Function('return ' + fnStr)();
        return fn(el, ...evalArgs);
      })(${sel}, ${xpathPrefix}, ${JSON.stringify(fnBody)}${args.length > 0 ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''})`,
    );
  }

  async ariaSnapshot(): Promise<string> {
    const result = await this.page._cdpSend<{ nodes: Array<{ role: { value: string }; name?: { value: string } }> }>(
      'Accessibility.getFullAXTree',
    );
    return result.nodes
      .map((n) => `${n.role?.value}: ${n.name?.value ?? ''}`)
      .join('\n');
  }

  // ── Filtering ───────────────────────────────────────────────

  first(): XBLocator {
    return new FilteredLocator(this.page, this.selector, 0);
  }

  last(): XBLocator {
    return new FilteredLocator(this.page, this.selector, -1);
  }

  nth(index: number): XBLocator {
    return new FilteredLocator(this.page, this.selector, index);
  }

  filter(opts: { visible?: boolean }): XBLocator {
    if (opts.visible) {
      return new VisibleFilteredLocator(this.page, this.selector);
    }
    return new XBLocatorImpl(this.page, this.selector);
  }

  async all(): Promise<XBLocator[]> {
    const n = await this.page.evaluate<number>(`
      ${this._qa(this.selector)}.length
    `);
    const locators: XBLocator[] = [];
    for (let i = 0; i < n; i++) {
      locators.push(new FilteredLocator(this.page, this.selector, i));
    }
    return locators;
  }

  async focus(): Promise<void> {
    await this.page.evaluate(`
      (function() {
        const el = ${this._q(this.selector)};
        if (el) el.focus();
      })()
    `);
  }
}

/**
 * Locator with index filter — for .first(), .last(), .nth()
 *
 * For CSS selectors, uses `:last-of-type` / `:nth-of-type()` pseudo-classes.
 * For xpath selectors, uses document.evaluate + snapshot indexing since
 * CSS pseudo-classes don't work with xpath.
 */
class FilteredLocator extends XBLocatorImpl {
  protected index: number;

  constructor(page: XBPageImpl, selector: string, index: number) {
    // For CSS selectors, append pseudo-class; for xpath keep original (handled in _q/_qa)
    const indexedSelector = selector.startsWith('xpath=')
      ? selector
      : index === -1
        ? `${selector}:last-of-type`
        : `${selector}:nth-of-type(${index + 1})`;
    super(page, indexedSelector);
    this.index = index;
    this._rawSelector = selector;
  }

  /** Original selector before index filtering */
  private _rawSelector: string;

  /** For xpath selectors, override _q to return the nth element from evaluate results */
  protected override _q(sel: string): string {
    if (!sel.startsWith('xpath=')) return super._q(sel);
    const xpath = JSON.stringify(this._rawSelector.slice(6));
    return `(() => { const it = document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); return ${this.index === -1 ? 'it.snapshotItem(it.snapshotLength - 1)' : `it.snapshotItem(${this.index})`}; })()`;
  }

  /** For xpath selectors, override _qa to return all matching elements from evaluate */
  protected override _qa(sel: string): string {
    if (!sel.startsWith('xpath=')) return super._qa(sel);
    const xpath = JSON.stringify(this._rawSelector.slice(6));
    return `(() => { const it = document.evaluate(${xpath}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const r=[]; for(let i=0;i<it.snapshotLength;i++) r.push(it.snapshotItem(i)); return r; })()`;
  }
}

/**
 * Locator that only matches visible elements — for .filter({ visible: true })
 *
 * Overrides action methods to resolve to the first visible matching element
 * before performing the action.
 */
class VisibleFilteredLocator extends XBLocatorImpl {
  private async _withVisibleTag<T>(fn: (tagSelector: string) => Promise<T>): Promise<T> {
    const tag = `data-xb-vt-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const found = await this.page.evaluate<boolean>(`
      (function() {
        const els = ${this._qa(this.selector)};
        for (const el of els) {
          if (!el.isConnected) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          el.setAttribute(${JSON.stringify(tag)}, '');
          return true;
        }
        return false;
      })()
    `);
    if (!found) throw new Error(`No visible element found for: ${this.selector}`);
    try {
      return await fn(`[${tag}]`);
    } finally {
      await this.page.evaluate(`
        ${this._qa(`[${tag}]`)}.forEach(el => el.removeAttribute(${JSON.stringify(tag)}))
      `);
    }
  }

  override async click(opts?: XBClickOptions): Promise<void> {
    return this._withVisibleTag(tagSel => new XBLocatorImpl(this.page, tagSel).click(opts));
  }

  override async fill(value: string, opts?: XBFillOptions): Promise<void> {
    return this._withVisibleTag(tagSel => new XBLocatorImpl(this.page, tagSel).fill(value, opts));
  }

  override async press(key: string, opts?: { timeout?: number }): Promise<void> {
    return this._withVisibleTag(tagSel => new XBLocatorImpl(this.page, tagSel).press(key, opts));
  }

  override async hover(opts?: { timeout?: number; force?: boolean }): Promise<void> {
    return this._withVisibleTag(tagSel => new XBLocatorImpl(this.page, tagSel).hover(opts));
  }

  override async count(): Promise<number> {
    return this.page.evaluate<number>(`
      (function() {
        let count = 0;
        const els = ${this._qa(this.selector)};
        for (const el of els) {
          if (!el.isConnected) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          count++;
        }
        return count;
      })()
    `);
  }

  override async isVisible(): Promise<boolean> {
    try {
      const result = await this.page.evaluate<boolean>(`
        (function() {
          const els = ${this._qa(this.selector)};
          for (const el of els) {
            if (!el.isConnected) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return true;
          }
          return false;
        })()
      `);
      return result;
    } catch {
      return false;
    }
  }

  override async textContent(): Promise<string | null> {
    return this._withVisibleTag(tagSel => new XBLocatorImpl(this.page, tagSel).textContent());
  }

  override async innerText(): Promise<string> {
    return this._withVisibleTag(tagSel => new XBLocatorImpl(this.page, tagSel).innerText());
  }

  override async waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void> {
    const deadline = Date.now() + (opts?.timeout ?? 30_000);
    while (Date.now() < deadline) {
      if (await this.isVisible()) return;
      await this.page.waitForTimeout(50);
    }
    throw new Error(`Timeout waiting for visible element: ${this.selector}`);
  }
}
