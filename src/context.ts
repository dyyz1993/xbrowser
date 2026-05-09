import type { CommandContext, CommandScope } from '@dyyz1993/xcli-core';
import type { Page, Browser, BrowserContext } from 'playwright';
import type { WaitForHumanOptions, WaitForHumanResult } from './human-interaction.js';
import type { WSServer } from './websocket-server.js';

/**
 * Extended command context for browser automation commands.
 *
 * Provides Playwright Page, Browser, and BrowserContext instances,
 * along with an optional `waitForHuman` function for CAPTCHA handling.
 */
export interface BrowserCommandContext extends CommandContext {
  page: Page;
  browser: Browser;
  browserContext: BrowserContext;
  sessionId?: string;
  cdpEndpoint?: string;
  waitForHuman?: (options?: WaitForHumanOptions) => Promise<WaitForHumanResult>;
}

/**
 * Validate that the required browser scope is available in the context.
 *
 * @param scope - The required command scope level.
 * @param ctx - The current browser command context.
 * @returns An error message string if the scope is not satisfied, or `null` if valid.
 */
export function checkBrowserScope(
  scope: CommandScope,
  ctx: BrowserCommandContext
): string | null {
  switch (scope) {
    case 'project':
      return null;
    case 'browser':
      return ctx.browser ? null : '需要浏览器实例，请先执行 xbrowser session open <url>';
    case 'page':
      return ctx.page ? null : '需要活跃的页面，请先执行 xbrowser session open <url>';
    case 'element':
      return ctx.page ? null : '需要活跃的页面，请先执行 xbrowser session open <url>';
    default:
      return null;
  }
}

/**
 * Assert that the context has an active page, narrowing the type.
 *
 * @param ctx - The browser command context to validate.
 * @throws If no active page is available in the context.
 */
export function assertPageScope(ctx: BrowserCommandContext): asserts ctx is BrowserCommandContext & { page: Page } {
  if (!ctx.page) {
    throw new Error('需要活跃的页面，请先执行 xbrowser session open <url>');
  }
}

const wsServerCache = new WeakMap<BrowserContext, WSServer>();

/**
 * Attach a `waitForHuman` function to the browser command context.
 *
 * Lazily imports the human interaction manager and binds it to the
 * context's page via the provided WebSocket server factory.
 *
 * @param ctx - The browser command context to augment.
 * @param getOrCreateWSServer - Factory that returns a WSServer for the given BrowserContext.
 */
export function attachWaitForHuman(
  ctx: BrowserCommandContext,
  getOrCreateWSServer: (browserContext: BrowserContext) => Promise<WSServer>
): void {
  ctx.waitForHuman = async (options?: WaitForHumanOptions): Promise<WaitForHumanResult> => {
    if (!ctx.page) {
      throw new Error('waitForHuman requires an active page');
    }

    const { HumanInteractionManager } = await import('./human-interaction.js');
    const wsServer = await getOrCreateWSServer(ctx.browserContext);
    const manager = new HumanInteractionManager(wsServer, ctx.page);
    return manager.waitForHuman(options);
  };
}

/**
 * Retrieve a cached WSServer instance for the given BrowserContext.
 *
 * @param browserContext - The Playwright BrowserContext.
 * @returns The cached WSServer, or `undefined` if none is cached.
 */
export function getWSServerFromCache(browserContext: BrowserContext): WSServer | undefined {
  return wsServerCache.get(browserContext);
}

/**
 * Cache a WSServer instance for the given BrowserContext.
 *
 * @param browserContext - The Playwright BrowserContext.
 * @param server - The WSServer to associate with this context.
 */
export function setWSServerCache(browserContext: BrowserContext, server: WSServer): void {
  wsServerCache.set(browserContext, server);
}
