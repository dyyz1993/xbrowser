/**
 * Browser Type Shim — Playwright-compatible type names backed by CDP Driver
 *
 * Re-exports XB* types under the names used throughout the codebase
 * (Page, Browser, BrowserContext, etc.) so that existing code continues
 * to compile after the Playwright → CDP Driver migration.
 *
 * Migration path:
 *   Before:  import type { Page } from 'playwright';
 *   After:   import type { Page } from './browser-shim.js';
 */

export type {
  XBBrowser as Browser,
  XBContext as BrowserContext,
  XBPage as Page,
  XBLocator as Locator,
  XBElementHandle as ElementHandle,
  XBMouse as Mouse,
  XBKeyboard as Keyboard,
  XBFrame as Frame,
  XBCDPSession as CDPSession,
  XBContextOptions as BrowserContextOptions,
  XBClickOptions as ClickOptions,
  XBFillOptions as FillOptions,
  XBScreenshotOptions as ScreenshotOptions,
  XBPdfOptions as PdfOptions,
  XBLaunchOptions as LaunchOptions,
  XBConsoleMessage as ConsoleMessage,
  XBRequest as Request,
  XBResponse as Response,
  XBNavigationResponse as NavigationResponse,
  XBDIALOG as Dialog,
  XBCookie as Cookie,
} from './cdp-driver/types.js';

// Re-export runtime functions for convenience
export { launch } from './cdp-driver/index.js';
