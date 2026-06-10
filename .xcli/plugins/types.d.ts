/**
 * Plugin type helpers — CDP Driver types under Playwright-compatible names.
 *
 * Import like:  import type { Page, Response } from '../types.js';
 */

import type {
  XBPage,
  XBBrowser,
  XBContext,
  XBLocator,
  XBElementHandle,
  XBFrame,
  XBResponse,
  XBRequest,
  XBCDPSession,
} from '../../src/cdp-driver/types.js';

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
};

export type { XBLocator as FrameLocator };

/**
 * Extended types for plugin use — adds methods that exist at runtime
 * in XBPageImpl but aren't in the core XBPage interface yet.
 * These are NOT module augmentations (which would affect src/ too);
 * they are local interfaces only visible to plugin code.
 */
export interface PluginPage extends XBPage {
  evaluateHandle<R = unknown>(pageFunction: (...args: unknown[]) => R, ...args: unknown[]): Promise<XBElementHandle>;
  frameLocator(selector: string): XBFrame;
  request(): XBRequest;
  waitForNavigation(options?: { waitUntil?: string; timeout?: number }): Promise<XBResponse | null>;
}

export interface PluginRoute extends XBRoute {
  fetch(): Promise<XBResponse>;
}

export interface PluginLocator extends XBLocator {
  locator(selector: string): XBLocator;
}

export interface PluginElementHandle extends XBElementHandle {
  asElement(): XBElementHandle | null;
}

export interface PluginFrame extends XBFrame {
  click(selector: string, opts?: Record<string, unknown>): Promise<void>;
  locator(selector: string): XBLocator;
}

/**
 * Extend xcli-core's CommandContext with browser automation fields.
 *
 * xbrowser's router injects page, browser, browserContext, sessionId,
 * cdpEndpoint, and waitForHuman into ctx at runtime. This declaration
 * merging makes them available to plugins without any type casting.
 *
 * Usage in plugins:
 *   handler: async (params, ctx) => {
 *     const page = ctx.page;       // Page | null — no cast needed
 *     const browser = ctx.browser; // Browser | null
 *     if (!page) throw new Error('需要浏览器页面');
 *   }
 */
declare module '@dyyz1993/xcli-core' {
  interface CommandContext {
    /** Active browser page (injected by xbrowser router when scope >= 'page') */
    page?: import('../../src/cdp-driver/types.js').XBPage | null;
    /** Browser instance (injected when scope >= 'browser') */
    browser?: import('../../src/cdp-driver/types.js').XBBrowser | null;
    /** Browser context (injected when scope >= 'browser') */
    browserContext?: import('../../src/cdp-driver/types.js').XBContext | null;
    /** Current session ID */
    sessionId?: string;
    /** CDP WebSocket endpoint */
    cdpEndpoint?: string;
    /** Wait for human interaction (CAPTCHA, login, etc.) */
    waitForHuman?: (options?: Record<string, unknown>) => Promise<{ solved: boolean; timedOut: boolean }>;
  }

  /**
   * Relax SiteInstance.command() handler return type.
   *
   * xcli-core declares handler returns `Promise<z.infer<R>>`, but `ok()`/`fail()`
   * return `CommandResult<T>`. The framework router handles both at runtime
   * (it checks `isCommandResult()` and unwraps). This merge makes the types
   * match reality so plugins don't need `as unknown as z.infer<...>` casts.
   */
  interface SiteInstance {
    command<P extends ZodSchema = ZodSchema, R extends ZodSchema = ZodSchema>(name: string, config: {
      description: string;
      scope?: CommandScope;
      override?: boolean;
      parameters?: P;
      result?: R;
      requiresLogin?: boolean;
      loginRequired?: string;
      examples?: Array<{ cmd: string; description: string }>;
      tips?: string[];
      handler: (params: z.infer<P>, ctx: CommandContext) => Promise<z.infer<R> | CommandResult<z.infer<R>>>;
    }): SiteInstance;
    /** Check if the user is logged in for this site. */
    isLoggedIn(ctx?: CommandContext): Promise<boolean>;
  }
}
