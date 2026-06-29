import type { CommandContext, CommandScope } from '@dyyz1993/xcli-core';
import type { Page, Browser, BrowserContext } from './browser-shim.js';
import type { WaitForHumanOptions, WaitForHumanResult } from './human-interaction.js';
import type { DetectionConfig, DetectionResult } from './lib/anti-bot.js';
import type { WSServer } from './websocket-server.js';

/**
 * Extended command context for browser automation commands.
 *
 * Provides Playwright Page, Browser, and BrowserContext instances,
 * along with optional `waitForHuman` (CAPTCHA handling) and
 * `detectAntiBot` (anti-bot detection) capabilities.
 */
export interface BrowserCommandContext extends CommandContext {
  page: Page;
  browser: Browser;
  browserContext: BrowserContext;
  sessionId?: string;
  cdpEndpoint?: string;
  waitForHuman?: (options?: WaitForHumanOptions) => Promise<WaitForHumanResult>;
  detectAntiBot?: (page: Page, config?: DetectionConfig) => Promise<DetectionResult>;
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
      return ctx.browser ? null : '需要浏览器实例，请使用 --session 选项';
    case 'page':
      return ctx.page ? null : '需要活跃的页面，请使用 --session 选项';
    case 'element':
      return ctx.page ? null : '需要活跃的页面，请使用 --session 选项';
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
    throw new Error('需要活跃的页面，请使用 --session 选项');
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
 * Attach a `detectAntiBot` function to the browser command context.
 *
 * Lazily imports the anti-bot detection module and exposes it as a
 * context capability so plugins can call `ctx.detectAntiBot(page)`
 * without importing from `src/` (which would break global/npm installs).
 *
 * Two overloads: one for the strictly-typed {@link BrowserCommandContext}
 * (executor), one for loosely-typed context literals with an index
 * signature (router).
 *
 * @param ctx - The context object to augment.
 */
export function attachDetectAntiBot(ctx: BrowserCommandContext): void;
export function attachDetectAntiBot(ctx: { detectAntiBot?: (page: Page, config?: DetectionConfig) => Promise<DetectionResult>; [key: string]: unknown }): void;
export function attachDetectAntiBot(ctx: { detectAntiBot?: (page: Page, config?: DetectionConfig) => Promise<DetectionResult> }): void {
  ctx.detectAntiBot = async (page: Page, config?: DetectionConfig): Promise<DetectionResult> => {
    const { detectAntiBot } = await import('./lib/anti-bot.js');
    return detectAntiBot(page, config);
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
