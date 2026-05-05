import type { CommandContext, CommandScope } from '@dyyz1993/xcli-core';
import type { Page, Browser, BrowserContext } from 'playwright';

export interface BrowserCommandContext extends CommandContext {
  page: Page;
  browser: Browser;
  browserContext: BrowserContext;
  sessionId?: string;
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
  }
}

export function assertPageScope(ctx: BrowserCommandContext): asserts ctx is BrowserCommandContext & { page: Page } {
  if (!ctx.page) {
    throw new Error('需要活跃的页面，请先执行 xbrowser session open <url>');
  }
}
