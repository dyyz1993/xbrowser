/**
 * Plugin type helpers — CDP Driver types under Playwright-compatible names.
 *
 * Import like:  import type { Page, Response } from '../types.js';
 * Or inline:     ctx.page as import('../types').Page
 */

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
} from '../../src/cdp-driver/types.js';

export type { XBLocator as FrameLocator } from '../../src/cdp-driver/types.js';
