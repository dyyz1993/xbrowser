/**
 * Playwright compatibility shim — re-exports CDP Driver types under Playwright names.
 *
 * Allows 67+ marketplace plugins using `import('playwright').Page` to resolve
 * without installing Playwright as a dependency.
 *
 * Long-term: plugins should migrate to native xbrowser CDP types directly.
 */

declare module 'playwright' {
  export type {
    XBPage as Page,
    XBBrowser as Browser,
    XBContext as BrowserContext,
    XBLocator as Locator,
    XBElementHandle as ElementHandle,
    XBFrame as Frame,
    XBResponse as Response,
    XBRequest as Request,
    XBCDPSession as CDPSession,
  } from '../src/cdp-driver/types.js';
}

declare module 'playwright-core' {
  export type {
    XBPage as Page,
    XBBrowser as Browser,
    XBContext as BrowserContext,
    XBLocator as Locator,
    XBElementHandle as ElementHandle,
    XBFrame as Frame,
    XBLocator as FrameLocator,
    XBResponse as Response,
    XBRequest as Request,
    XBCDPSession as CDPSession,
  } from '../src/cdp-driver/types.js';
}
