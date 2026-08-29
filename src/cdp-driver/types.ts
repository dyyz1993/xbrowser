/**
 * XBrowser CDP Driver — Abstract Interface Types
 *
 * Playwright-compatible interfaces backed by raw Chrome DevTools Protocol.
 * All commands and plugins depend on these interfaces, NOT on Playwright.
 *
 * Naming convention: XB prefix (XBrowser) to avoid confusion with Playwright types.
 */

// ── Browser ────────────────────────────────────────────────────

export interface XBBrowser {
  readonly disconnected: boolean;

  close(): Promise<void>;
  newContext(opts?: XBContextOptions): Promise<XBContext>;
  contexts(): XBContext[];
  /**
   * Discover existing browser contexts and pages from the CDP browser.
   * Required when connecting via CDP tunnel (cdp-tunnel) where
   * auto-attach events are unreliable. After this call, `contexts()`
   * returns the user's actual browser contexts (with their existing
   * cookies and login state) instead of an empty list.
   */
  discoverContexts(): Promise<void>;
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
}

export interface XBContextOptions {
  viewport?: { width: number; height: number };
  userAgent?: string;
  extraHTTPHeaders?: Record<string, string>;
  ignoreHTTPSErrors?: boolean;
}

// ── Context ────────────────────────────────────────────────────

export interface XBContext {
  newPage(): Promise<XBPage>;
  pages(): XBPage[];
  close(): Promise<void>;
  browser(): XBBrowser;

  newCDPSession(page?: XBPage): Promise<XBCDPSession>;
  addInitScript(script: string): Promise<void>;

  // Cookies
  cookies(urls?: string | string[]): Promise<XBCookie[]>;
  addCookies(cookies: XBCookie[]): Promise<void>;
  clearCookies(): Promise<void>;

  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
}

export interface XBCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

// ── Page ───────────────────────────────────────────────────────

export type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export interface XBPage {
  // Navigation
  goto(url: string, opts?: { waitUntil?: WaitUntilState; timeout?: number; referer?: string }): Promise<XBNavigationResponse | null>;
  goBack(opts?: { timeout?: number; waitUntil?: WaitUntilState }): Promise<void>;
  goForward(opts?: { timeout?: number; waitUntil?: WaitUntilState }): Promise<void>;
  reload(opts?: { timeout?: number; waitUntil?: WaitUntilState }): Promise<void>;
  waitForLoadState(state?: WaitUntilState, timeout?: number): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void>;
  waitForFunction<R>(fn: string | Function, opts?: { timeout?: number; polling?: number | 'raf' }, ...args: unknown[]): Promise<R>;
  waitForURL(url: string | RegExp | ((url: string) => boolean), opts?: { timeout?: number; waitUntil?: WaitUntilState }): Promise<void>;
  waitForResponse(urlOrPredicate: string | RegExp | ((response: XBResponse) => boolean), opts?: { timeout?: number }): Promise<XBResponse>;
  waitForRequest(urlOrPredicate: string | RegExp | ((request: XBRequest) => boolean), opts?: { timeout?: number }): Promise<XBRequest>;

  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;

  // Evaluation
  evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R>;
  $eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R>;
  $$eval<R = unknown>(selector: string, fn: string | Function, ...args: unknown[]): Promise<R>;

  // Locator
  locator(selector: string): XBLocator;
  getByText(text: string, opts?: { exact?: boolean }): XBLocator;
  getByRole(role: string, opts?: { name?: string; exact?: boolean }): XBLocator;
  getByLabel(label: string, opts?: { exact?: boolean }): XBLocator;
  getByPlaceholder(text: string, opts?: { exact?: boolean }): XBLocator;
  getByTestId(id: string): XBLocator;
  getByAltText(text: string, opts?: { exact?: boolean }): XBLocator;
  getByTitle(title: string, opts?: { exact?: boolean }): XBLocator;

  // Interaction shortcuts
  click(selector: string, opts?: XBClickOptions): Promise<void>;
  dblclick(selector: string, opts?: XBClickOptions): Promise<void>;
  fill(selector: string, value: string, opts?: XBFillOptions): Promise<void>;
  press(selector: string, key: string, opts?: { timeout?: number }): Promise<void>;
  hover(selector: string, opts?: { timeout?: number; force?: boolean }): Promise<void>;
  type(selector: string, text: string, opts?: { delay?: number; timeout?: number }): Promise<void>;
  check(selector: string, opts?: { timeout?: number }): Promise<void>;
  uncheck(selector: string, opts?: { timeout?: number }): Promise<void>;
  selectOption(selector: string, value: string | string[] | { label?: string; value?: string; index?: number }): Promise<string[]>;

  // Convenience selectors
  textContent(selector: string): Promise<string | null>;
  innerText(selector: string): Promise<string>;
  innerHTML(selector: string): Promise<string>;
  getAttribute(selector: string, name: string): Promise<string | null>;

  // Input devices
  readonly mouse: XBMouse;
  readonly keyboard: XBKeyboard;

  // Query
  $(selector: string): Promise<XBElementHandle | null>;
  $$(selector: string): Promise<XBElementHandle[]>;

  // Screen
  screenshot(opts?: XBScreenshotOptions): Promise<Buffer>;
  pdf(opts?: XBPdfOptions): Promise<Buffer>;
  viewportSize(): { width: number; height: number } | null;
  setViewportSize(size: { width: number; height: number }): Promise<void>;

  // Scripts
  addInitScript(script: string): Promise<void>;

  /** 覆盖当前页会话的 User-Agent（Network.setUserAgentOverride，会话级持久） */
  setUserAgent(userAgent: string): Promise<void>;

  // Frame discovery
  discoverFrames(): Promise<XBFrame[]>;

  /**
   * 在 URL 含 urlIncludes 的 iframe 上下文中执行表达式。
   * 同进程 iframe 走 contextId；跨域 OOPIF 走 Target auto-attach。
   * 绕过页面同源策略（CDP 是调试通道）——跨域嵌入内容读写的唯一路径。
   */
  evaluateInFrame<R = unknown>(urlIncludes: string, expression: string): Promise<R>;

  // Page management
  bringToFront(): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  setOfflineMode(offline: boolean): Promise<void>;

  // Request interception
  route(url: string | RegExp, handler: (route: XBRoute) => Promise<void> | void): Promise<void>;
  unroute(url: string | RegExp, handler?: (route: XBRoute) => Promise<void> | void): Promise<void>;

  // File upload
  setInputFiles(selector: string, files: XBFilePayload | XBFilePayload[]): Promise<void>;

  // Drag and drop
  dragAndDrop(source: string, target: string): Promise<void>;

  // Dialog
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
  waitForEvent(event: string, opts?: { timeout?: number; predicate?: (...args: unknown[]) => boolean }): Promise<unknown>;

  // CDP escape hatch (internal, for advanced use)
  _cdpSend<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  _subscribe(event: string, handler: (params: unknown) => void): () => void;

  // Lifecycle
  close(): Promise<void>;
  isClosed(): boolean;
  context(): XBContext;
  browser(): XBBrowser;

  // Frames
  mainFrame(): XBFrame;
  frames(): XBFrame[];
}

/** Response from navigation (goto). Playwright-compatible subset. */
export interface XBNavigationResponse {
  status(): number;
  ok(): boolean;
  url(): string;
  headers(): Record<string, string>;
}

// ── Locator ────────────────────────────────────────────────────

export interface XBLocator {
  click(opts?: XBClickOptions): Promise<void>;
  fill(value: string, opts?: XBFillOptions): Promise<void>;
  press(key: string, opts?: { timeout?: number }): Promise<void>;
  pressSequentially(text: string, opts?: { delay?: number; timeout?: number }): Promise<void>;
  hover(opts?: { timeout?: number; force?: boolean }): Promise<void>;
  type(text: string, opts?: { delay?: number; timeout?: number }): Promise<void>;
  check(opts?: { timeout?: number }): Promise<void>;
  uncheck(opts?: { timeout?: number }): Promise<void>;
  selectOption(value: string | string[] | { label?: string; value?: string; index?: number }): Promise<string[]>;
  screenshot(opts?: XBScreenshotOptions): Promise<Buffer>;

  focus(): Promise<void>;
  waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  isHidden(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  textContent(): Promise<string | null>;
  innerText(): Promise<string>;
  innerHTML(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R>;
  ariaSnapshot(): Promise<string>;
  first(): XBLocator;
  last(): XBLocator;
  nth(index: number): XBLocator;
  filter(opts: { visible?: boolean }): XBLocator;
  all(): Promise<XBLocator[]>;
}

// ── Element Handle ─────────────────────────────────────────────

export interface XBElementHandle {
  click(opts?: XBClickOptions): Promise<void>;
  fill(value: string, opts?: XBFillOptions): Promise<void>;
  hover(): Promise<void>;
  press(key: string): Promise<void>;
  screenshot(opts?: XBScreenshotOptions): Promise<Buffer>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  textContent(): Promise<string | null>;
  innerText(): Promise<string>;
  innerHTML(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
  dispose(): void;
}

// ── Mouse ──────────────────────────────────────────────────────

export interface XBMouse {
  click(x: number, y: number, opts?: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number; stealth?: boolean }): Promise<void>;
  dblclick(x: number, y: number, opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
  down(opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
  up(opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
  move(x: number, y: number, opts?: { steps?: number }): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
}

// ── Keyboard ───────────────────────────────────────────────────

export interface XBKeyboard {
  press(key: string, opts?: { delay?: number }): Promise<void>;
  /** Navigation key with CDP 'keyDown' type (carries browser default actions) */
  pressNav(key: string): Promise<void>;
  /** Shortcut combo (modifier+key) with explicit per-event modifiers bitmask */
  pressCombo(key: string, modifier: 'Meta' | 'Control' | 'Alt' | 'Shift'): Promise<void>;
  down(key: string): Promise<void>;
  up(key: string): Promise<void>;
  type(text: string, opts?: { delay?: number; stealth?: boolean }): Promise<void>;
  insertText(text: string): Promise<void>;
}

// ── Frame ──────────────────────────────────────────────────────

export interface XBFrame {
  url(): string;
  name(): string;
  isDetached(): boolean;
  page(): XBPage;
  evaluate<R = unknown>(fn: string | Function, ...args: unknown[]): Promise<R>;
  $(selector: string): Promise<XBElementHandle | null>;
  $$(selector: string): Promise<XBElementHandle[]>;
}

// ── CDP Session ────────────────────────────────────────────────

export interface XBCDPSession {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
  detach(): Promise<void>;
}

// ── Dialog ─────────────────────────────────────────────────────

export type XBDIALOG = {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message(): string;
  defaultValue(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
};

// ── Console Message ────────────────────────────────────────────

export type XBConsoleMessage = {
  type(): 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd';
  text(): string;
  location(): { url: string; lineNumber: number; columnNumber: number };
};

// ── Options ────────────────────────────────────────────────────

export interface XBClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  timeout?: number;
  force?: boolean;
  noWaitAfter?: boolean;
  position?: { x: number; y: number };
  trial?: boolean;
}

export interface XBFillOptions {
  timeout?: number;
  force?: boolean;
  noWaitAfter?: boolean;
}

export interface XBScreenshotOptions {
  type?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  omitBackground?: boolean;
  timeout?: number;
}

export interface XBPdfOptions {
  format?: string;
  landscape?: boolean;
  printBackground?: boolean;
  scale?: number;
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  preferCSSPageSize?: boolean;
}

// ── Network ────────────────────────────────────────────────────

export interface XBResponse {
  status(): number;
  statusText(): string;
  url(): string;
  headers(): Record<string, string>;
  ok(): boolean;
  body(): Promise<Buffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  request(): XBRequest;
}

export interface XBRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  resourceType(): string;
  response(): Promise<XBResponse | null>;
}

// ── Route (request interception) ──────────────────────────────

export interface XBRoute {
  request(): XBRequest;
  abort(errorCode?: string): Promise<void>;
  continue(opts?: { url?: string; method?: string; headers?: Record<string, string>; postData?: string }): Promise<void>;
  fulfill(opts: { status?: number; headers?: Record<string, string>; body?: string | Buffer; contentType?: string }): Promise<void>;
}

// ── File Payload ──────────────────────────────────────────────

export interface XBFilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface XBFileChooser {
  /** Set files for this file input */
  setFiles(files: XBFilePayload | XBFilePayload[]): Promise<void>;
  /** Element selector of the file input */
  selector: string;
  /** Whether multiple files are accepted */
  isMultiple: boolean;
}

export interface XBRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  resourceType(): string;
  response(): Promise<XBResponse | null>;
}

// ── Launch Options ─────────────────────────────────────────────

export interface XBLaunchOptions {
  headless?: boolean;
  executablePath?: string;
  args?: string[];
  userDataDir?: string;
  devtools?: boolean;
  slowMo?: number;
  timeout?: number;
  env?: Record<string, string>;
  cdpEndpoint?: string;
}
