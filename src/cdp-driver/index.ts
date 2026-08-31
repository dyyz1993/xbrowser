/**
 * XBrowser CDP Driver — Public API
 *
 * Zero-dependency Chrome DevTools Protocol driver for browser automation.
 * Replaces Playwright as the browser automation engine.
 *
 * @example
 * ```typescript
 * import { launch } from './cdp-driver/index.js';
 *
 * const { browser } = await launch({ headless: true });
 * const context = await browser.newContext();
 * const page = await context.newPage();
 * await page.goto('https://example.com');
 * await page.click('button.submit');
 * await browser.close();
 * ```
 */

// ── Types ──────────────────────────────────────────────────────

export type {
  XBBrowser, XBContext, XBPage, XBLocator, XBElementHandle,
  XBMouse, XBKeyboard, XBFrame, XBCDPSession,
  XBContextOptions, XBLaunchOptions,
  XBClickOptions, XBFillOptions, XBScreenshotOptions, XBPdfOptions,
  WaitUntilState, XBConsoleMessage, XBDIALOG,
  XBRequest, XBResponse, XBNavigationResponse,
} from './types.js';

// ── Implementations ────────────────────────────────────────────

export { XBBrowserImpl } from './browser.js';
export { XBContextImpl } from './context.js';
export { XBPageImpl } from './page.js';
export { XBLocatorImpl } from './locator.js';
export { XBMouseImpl } from './mouse.js';
export { XBKeyboardImpl } from './keyboard.js';
export { XBElementHandleImpl } from './element-handle.js';
export { XBCDPSessionImpl } from './cdp-session.js';
export { CDPConnection, CDPProtocolError } from './connection.js';

// ── Launch helpers ─────────────────────────────────────────────

export {
  launchChrome,
  connectToCDP,
  findChrome,
  killChrome,
  getCDPTargets,
} from './launcher.js';
export type { LaunchResult, ChromeLaunchOptions, CDPTargetInfo } from './launcher.js';

// ── Utilities ──────────────────────────────────────────────────

export { waitForActionable, checkActionable, scrollIntoView } from './actionability.js';
export { waitForNetworkIdle } from './wait.js';

// ── Convenience: launch + connect in one call ──────────────────

import type { XBLaunchOptions, XBBrowser } from './types.js';
import { launchChrome, connectToCDP } from './launcher.js';
import { CDPConnection } from './connection.js';
import { XBBrowserImpl } from './browser.js';

export interface LaunchResultFull {
  browser: XBBrowser;
  wsEndpoint: string;
}

/**
 * Launch a new browser or connect to existing CDP endpoint.
 *
 * If `cdpEndpoint` is provided, connects to that endpoint.
 * Otherwise, launches a new Chrome process.
 */
export async function launch(options: XBLaunchOptions = {}): Promise<LaunchResultFull> {
  let wsEndpoint: string;
  let childProcess: import('node:child_process').ChildProcess | undefined;
  let tmpDir: string | undefined;

  if (options.cdpEndpoint) {
    wsEndpoint = await connectToCDP(options.cdpEndpoint);
  } else {
    const result = await launchChrome({
      executablePath: options.executablePath,
      headless: options.headless,
      args: options.args,
      userDataDir: options.userDataDir,
      timeout: options.timeout,
      env: options.env,
    });
    wsEndpoint = result.wsEndpoint;
    childProcess = result.process;
    tmpDir = result.tmpDir;
  }

  const conn = new CDPConnection(wsEndpoint);
  await conn.ready();

  // Pass the ORIGINAL (HTTP) endpoint to the browser so discoverContexts()
  // can fall back to HTTP /json/list when Target.getTargets doesn't return
  // page-type targets (e.g. cdp-tunnel proxies).
  const httpEndpoint = options.cdpEndpoint && !options.cdpEndpoint.startsWith('ws')
    ? options.cdpEndpoint
    : undefined;
  const browser = new XBBrowserImpl(conn, childProcess, tmpDir, httpEndpoint,
    options.stealthConfig ? { stealthConfig: options.stealthConfig } : undefined);

  return { browser, wsEndpoint };
}
