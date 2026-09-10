/**
 * Plugin-local page shape (G2-1 of the plugin gates plan).
 *
 * Plugins receive a CDP-driver page via ctx.page but must not depend on the
 * host's internal types. This declares only the surface plugins actually
 * call (goto / waitForTimeout / evaluate / url / keyboard). When xcli-core
 * ships an official Page type, swap these imports in one place.
 */

export interface PageKeyboardLike {
  insertText(text: string): Promise<void>;
  press(key: string, options?: { delay?: number }): Promise<void>;
  type(text: string, options?: { delay?: number }): Promise<void>;
}

export interface PageLike {
  url(): string;
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  keyboard: PageKeyboardLike;
}

/** Handler ctx shape for page-scoped commands that use the loose inline form. */
export interface PageCtx {
  page?: PageLike;
}
