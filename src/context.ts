import type { CommandContext, CommandScope } from '@dyyz1993/xcli-core';
import type { Page, Browser, BrowserContext } from 'playwright';
import type { WaitForHumanOptions, WaitForHumanResult } from './human-interaction.js';
import type { WSServer } from './websocket-server.js';

export interface BrowserCommandContext extends CommandContext {
  page: Page;
  browser: Browser;
  browserContext: BrowserContext;
  sessionId?: string;
  waitForHuman?: (options?: WaitForHumanOptions) => Promise<WaitForHumanResult>;
}

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

export function assertPageScope(ctx: BrowserCommandContext): asserts ctx is BrowserCommandContext & { page: Page } {
  if (!ctx.page) {
    throw new Error('需要活跃的页面，请先执行 xbrowser session open <url>');
  }
}

const wsServerCache = new WeakMap<BrowserContext, WSServer>();

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

export function getWSServerFromCache(browserContext: BrowserContext): WSServer | undefined {
  return wsServerCache.get(browserContext);
}

export function setWSServerCache(browserContext: BrowserContext, server: WSServer): void {
  wsServerCache.set(browserContext, server);
}
