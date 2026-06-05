/**
 * XBElementHandle — Direct element reference via CDP DOM nodeId
 *
 * Represents a specific DOM element, allowing direct interaction
 * without re-querying the selector.
 */

import type {
  XBElementHandle, XBClickOptions, XBFillOptions, XBScreenshotOptions,
} from './types.js';
import type { XBPageImpl } from './page.js';

export class XBElementHandleImpl implements XBElementHandle {
  private page: XBPageImpl;
  private nodeId: number;
  private disposed = false;

  constructor(page: XBPageImpl, nodeId: number) {
    this.page = page;
    this.nodeId = nodeId;
  }

  get _nodeId(): number {
    return this.nodeId;
  }

  async click(opts: XBClickOptions = {}): Promise<void> {
    if (this.disposed) throw new Error('Element handle disposed');

    const box = await this.boundingBox();
    if (!box) throw new Error('Element has no box');

    // Scroll into view
    await this.scrollIntoViewIfNeeded();

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await this.page.mouse.click(cx, cy, {
      button: opts.button ?? 'left',
      clickCount: opts.clickCount ?? 1,
      delay: opts.delay,
    });
  }

  async fill(value: string, _opts: XBFillOptions = {}): Promise<void> {
    if (this.disposed) throw new Error('Element handle disposed');

    const objectId = await this.page.resolveNode(this.nodeId);
    await this.page.callFunctionOn(
      objectId,
      `function(value) {
        this.focus();
        this.value = '';
        this.dispatchEvent(new Event('input', { bubbles: true }));
      }`,
      [value],
    );

    await this.page.keyboard.insertText(value);

    await this.page.callFunctionOn(
      objectId,
      `function() {
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
    );
  }

  async hover(): Promise<void> {
    const box = await this.boundingBox();
    if (!box) throw new Error('Element has no box');
    await this.scrollIntoViewIfNeeded();
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }

  async press(key: string): Promise<void> {
    const objectId = await this.page.resolveNode(this.nodeId);
    await this.page.callFunctionOn(objectId, 'function() { this.focus(); }');
    await this.page.keyboard.press(key);
  }

  async screenshot(opts: XBScreenshotOptions = {}): Promise<Buffer> {
    const box = await this.boundingBox();
    if (!box) throw new Error('Element has no box');

    return this.page.screenshot({
      ...opts,
      clip: box,
    });
  }

  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.page.getBoxModel(this.nodeId);
  }

  async isVisible(): Promise<boolean> {
    try {
      const objectId = await this.page.resolveNode(this.nodeId);
      const result = await this.page.callFunctionOn<boolean>(
        objectId,
        `function() {
          if (!this.isConnected) return false;
          const style = window.getComputedStyle(this);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = this.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }`,
      );
      return Boolean(result);
    } catch {
      return false;
    }
  }

  async isEnabled(): Promise<boolean> {
    const objectId = await this.page.resolveNode(this.nodeId);
    return this.page.callFunctionOn(objectId, 'function() { return !this.disabled; }');
  }

  async textContent(): Promise<string | null> {
    const objectId = await this.page.resolveNode(this.nodeId);
    return this.page.callFunctionOn(objectId, 'function() { return this.textContent; }');
  }

  async innerText(): Promise<string> {
    const objectId = await this.page.resolveNode(this.nodeId);
    return this.page.callFunctionOn(objectId, 'function() { return this.innerText; }');
  }

  async innerHTML(): Promise<string> {
    const objectId = await this.page.resolveNode(this.nodeId);
    return this.page.callFunctionOn(objectId, 'function() { return this.innerHTML; }');
  }

  async getAttribute(name: string): Promise<string | null> {
    const objectId = await this.page.resolveNode(this.nodeId);
    return this.page.callFunctionOn(objectId, `function() { return this.getAttribute(${JSON.stringify(name)}); }`);
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    if (this.disposed) return;
    const objectId = await this.page.resolveNode(this.nodeId);
    await this.page.callFunctionOn(
      objectId,
      'function() { this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); }',
    );
  }

  dispose(): void {
    this.disposed = true;
  }
}
