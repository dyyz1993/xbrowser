/**
 * Shared plugin type surface (AGENTS.md §10.4 canonical location).
 *
 * 17+ plugins import Page/Locator/Response from '../types.js' — this file is
 * the plugin-layer contract for the host CDP-driver page. Signatures are
 * deliberately permissive (wide option bags, Promise<unknown> returns) so
 * plugins type-check against call sites, not against driver internals.
 * When xcli-core ships an official Page type, re-export it here in one place.
 */

export interface Response {
  status(): number;
  url(): string;
  headers(): Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
  body(): Promise<unknown>;
  ok(): boolean;
}

export interface ElementHandleLike {
  click(options?: Record<string, unknown>): Promise<void>;
  fill(value: string, options?: Record<string, unknown>): Promise<void>;
  type(text: string, options?: Record<string, unknown>): Promise<void>;
  focus(): Promise<void>;
  press(key: string, options?: Record<string, unknown>): Promise<void>;
  hover(options?: Record<string, unknown>): Promise<void>;
  textContent(): Promise<string | null>;
  innerText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number; top: number; left: number };
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  isVisible(): Promise<boolean>;
  waitFor(options?: Record<string, unknown>): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
  screenshot(options?: Record<string, unknown>): Promise<unknown>;
  dispatchEvent(event: string, detail?: unknown): Promise<void>;
  evaluate<T = unknown, Arg = unknown>(fn: (element: never, arg: Arg) => T, arg: Arg): Promise<T>;
  evaluate<T = unknown, Arg = unknown[]>(fn: string | ((arg: Arg, ...rest: never[]) => T), arg?: Arg): Promise<T>;
  asElement(): ElementHandleLike | null;
}

export interface Locator extends ElementHandleLike {
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  count(): Promise<number>;
  all(): Promise<ElementHandleLike[]>;
  filter(selector: string | Record<string, unknown>): Locator;
  locator(selector: string, options?: Record<string, unknown>): Locator;
  selectOption(value: string | string[] | Record<string, string> | number, options?: Record<string, unknown>): Promise<string[]>;
  pressSequentially(text: string, options?: Record<string, unknown>): Promise<void>;
  isEnabled(): Promise<boolean>;
  isHidden(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  innerText(): Promise<string>;
}

export interface RouteLike {
  request(): { url(): string; method(): string; headers(): Record<string, string>; postData(): string | null };
  continue(options?: Record<string, unknown>): Promise<void>;
  abort(): Promise<void>;
  fulfill(response: { status?: number; headers?: Record<string, string>; body?: string; contentType?: string }): Promise<void>;
  fetch(): Promise<Response>;
}

export interface MouseLike {
  click(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
  dblclick(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
  move(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
  wheel(dx: number, dy: number): Promise<void>;
  down(options?: Record<string, unknown>): Promise<void>;
  up(options?: Record<string, unknown>): Promise<void>;
}

export interface KeyboardLike {
  press(key: string, options?: Record<string, unknown>): Promise<void>;
  type(text: string, options?: Record<string, unknown>): Promise<void>;
  insertText(text: string): Promise<void>;
  down(key: string): Promise<void>;
  up(key: string): Promise<void>;
}

export interface Page {
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  reload(options?: Record<string, unknown>): Promise<unknown>;
  close(options?: Record<string, unknown>): Promise<void>;
  evaluate<T = unknown, Arg = unknown[]>(fn: string | ((arg: Arg, ...rest: never[]) => T), arg?: Arg): Promise<T>;
  evaluate<T = unknown>(fn: string): Promise<T>;
  evaluateHandle<T = unknown>(fn: string | ((...args: never[]) => unknown), ...args: unknown[]): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<ElementHandleLike | null>;
  waitForLoadState(state?: string, options?: Record<string, unknown> | number): Promise<void>;
  waitForFunction(fn: string | ((...args: never[]) => unknown), options?: Record<string, unknown>, ...args: unknown[]): Promise<unknown>;
  waitForResponse(urlOrPredicate: string | RegExp | ((r: Response) => boolean), options?: Record<string, unknown>): Promise<Response>;
  on(event: 'request', handler: (req: { url(): string; method(): string; postData(): string | null; headers(): Record<string, string> }) => unknown): Promise<void> | void;
  on(event: 'response', handler: (res: Response) => unknown): Promise<void> | void;
  on(event: string, handler: (...args: never[]) => unknown): Promise<void> | void;
  off(event: string, handler: (...args: never[]) => unknown): Promise<void> | void;
  once(event: string, handler: (...args: never[]) => unknown): Promise<void> | void;
  locator(selector: string, options?: Record<string, unknown>): Locator;
  $$(selector: string): Promise<ElementHandleLike[]>;
  $(selector: string): Promise<ElementHandleLike | null>;
  frames(): PluginFrame[];
  fill(selector: string, value: string, options?: Record<string, unknown>): Promise<void>;
  hover(selector: string, options?: Record<string, unknown>): Promise<void>;
  press(selector: string, key: string, options?: Record<string, unknown>): Promise<void>;
  textContent(selector: string, options?: Record<string, unknown>): Promise<string | null>;
  screenshot(options?: Record<string, unknown>): Promise<unknown>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  setInputFiles(selector: string, files: unknown, options?: Record<string, unknown>): Promise<void>;
  addInitScript(script: string | ((...args: never[]) => unknown)): Promise<void>;
  route(pattern: string | RegExp, handler: (route: RouteLike) => Promise<void> | void): Promise<void>;
  unroute(pattern: string | RegExp, handler?: (route: RouteLike) => Promise<void> | void): Promise<void>;
  mouse: MouseLike;
  keyboard: KeyboardLike;
  viewportSize(): { width: number; height: number };
  waitForNavigation(options?: Record<string, unknown>): Promise<unknown>;
  mainFrame(): PluginFrame;
  frameLocator(selector: string): PluginFrame;
  context(): { addCookies(cookies: unknown[]): Promise<void>; cookies(): Promise<unknown[]>; newPage(): Promise<Page>; pages(): Page[] };
}

/** Alias used by some plugins for the same page surface. */
export type PluginPage = Page;
export type ElementHandle = ElementHandleLike;
export type Frame = {
  url(): string;
  name?: string;
  evaluate<T = unknown>(fn: string | ((...args: never[]) => unknown)): Promise<T>;
  locator(selector: string, options?: Record<string, unknown>): Locator;
  $(selector: string): Promise<ElementHandleLike | null>;
  $$(selector: string): Promise<ElementHandleLike[]>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  count(): Promise<number>;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<ElementHandleLike | null>;
} & Record<string, unknown>;
export type PluginFrame = Frame;
export type PluginLocator = Locator;
export type Request = { url(): string; method(): string; headers(): Record<string, string>; postData(): string | null; responseType(): Promise<string> } & Record<string, unknown>;

/** Loose browser/context shapes used by some plugins. */
export interface BrowserContext {
  pages(): Page[];
  newPage(): Promise<Page>;
  addCookies(cookies: unknown[]): Promise<void>;
  cookies(): Promise<unknown[]>;
  [key: string]: unknown;
}
export interface Browser {
  contexts(): BrowserContext[];
  newContext(options?: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
  [key: string]: unknown;
}
export type PluginElementHandle = ElementHandleLike;
export type PluginRoute = RouteLike;

/**
 * Module augmentation (#55 分层约定): the runtime injects page/waitForHuman/
 * cdpEndpoint/sessionId into every command context. Generic members ship in
 * xcli-core ≥0.19.1; `page` is a host-domain object and stays declared here
 * (the only declaration, so no merge conflict) with the plugin Page shape.
 */
declare module '@dyyz1993/xcli-core' {
  // Tolerant login/logout overloads (method merge = overload append; ctx-only
  // params carry no params-inference collapse risk). Handlers returning
  // Promise<unknown> instead of Promise<void|boolean> fall through here.
  interface SiteInstance {
    login(handler: (ctx: CommandContext) => Promise<unknown>): SiteInstance;
    isLoggedIn(ctx: CommandContext): Promise<boolean>;
    logout(handler: (ctx: CommandContext) => Promise<unknown>): SiteInstance;
  }
  interface CommandContext {
    page?: Page;
    waitForHuman?(options: { reason: string; timeout?: number } & Record<string, unknown>): Promise<{ solved: boolean }>;
    detectAntiBot?(page?: Page): Promise<{ detected: boolean; type?: string } & Record<string, unknown>>;
  }
}
