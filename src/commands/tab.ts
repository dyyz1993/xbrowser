import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { getSessionById, setActivePage } from '../browser.js';
import type { Page } from '../browser-shim.js';

const TabParams = z.object({
  subcommand: z.enum(['list', 'new', 'close', 'switch']),
  url: z.string().optional(),
  index: z.number().int().min(0).optional(),
});

type TabParamsType = z.infer<typeof TabParams>;

export const tabCommand = registerCommand({
  name: 'tab',
  description: 'Manage browser tabs: list, new, close, switch',
  scope: 'page',
  parameters: TabParams,
  result: z.object({
    success: z.boolean(),
    data: z.unknown(),
  }),
  handler: async (p: TabParamsType, ctx: BrowserCommandContext): Promise<unknown> => {
    const pages = ctx.browserContext.pages();

    switch (p.subcommand) {
      case 'list':
        return handleList(pages, ctx);

      case 'new':
        return handleNew(p, pages, ctx);

      case 'close':
        return handleClose(p, pages, ctx);

      case 'switch':
        return handleSwitch(p, pages, ctx);

      default:
        return fail(`Unknown subcommand: ${p.subcommand as string}`);
    }
  },
});

function handleList(
  pages: Page[],
  ctx: BrowserCommandContext,
): unknown {
  const currentIndex = pages.indexOf(ctx.page);
  const tabs = pages.map((page, i) => {
    const url = page.url();
    let title = '';
    try {
      const t = page.title();
      if (t instanceof Promise) {
        void t.then((v: string) => { title = v; });
      }
    } catch {
      title = '';
    }
    return {
      index: i,
      url,
      title,
      active: i === currentIndex,
    };
  });

  return ok({ tabs, total: tabs.length, activeIndex: currentIndex });
}

async function handleNew(
  p: TabParamsType,
  _pages: Page[],
  ctx: BrowserCommandContext,
): Promise<unknown> {
  const newPage = await ctx.browserContext.newPage();

  if (p.url) {
    let url = p.url;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  }

  await newPage.waitForLoadState('domcontentloaded').catch(() => {});

  const session = ctx.sessionId ? getSessionById(ctx.sessionId) : undefined;
  if (session) {
    setActivePage(session, newPage);
  }
  ctx.page = newPage;

  const title = await newPage.title().catch(() => '');
  const allPages = ctx.browserContext.pages();
  const newIndex = allPages.indexOf(newPage);

  return ok({
    index: newIndex >= 0 ? newIndex : allPages.length - 1,
    url: newPage.url(),
    title,
    total: allPages.length,
  });
}

async function handleClose(
  p: TabParamsType,
  pages: Page[],
  ctx: BrowserCommandContext,
): Promise<unknown> {
  if (pages.length <= 1) {
    return fail('Cannot close the last remaining tab');
  }

  const closeIndex = p.index ?? pages.indexOf(ctx.page);
  if (closeIndex < 0 || closeIndex >= pages.length) {
    return fail(`Invalid tab index: ${closeIndex}. Valid range: 0-${pages.length - 1}`);
  }

  const pageToClose = pages[closeIndex];
  const isActivePage = pageToClose === ctx.page;

  await pageToClose.close();

  const remainingPages = ctx.browserContext.pages();
  if (isActivePage && remainingPages.length > 0) {
    const switchIndex = closeIndex < remainingPages.length ? closeIndex : remainingPages.length - 1;
    const newActivePage = remainingPages[switchIndex];

    const session = ctx.sessionId ? getSessionById(ctx.sessionId) : undefined;
    if (session) {
      setActivePage(session, newActivePage);
    }
    ctx.page = newActivePage;
  }

  return ok({
    closedIndex: closeIndex,
    total: remainingPages.length,
    activeIndex: isActivePage
      ? (closeIndex < remainingPages.length ? closeIndex : remainingPages.length - 1)
      : pages.indexOf(ctx.page),
  });
}

async function handleSwitch(
  p: TabParamsType,
  pages: Page[],
  ctx: BrowserCommandContext,
): Promise<unknown> {
  if (p.index === undefined) {
    return fail('Parameter --index is required for switch subcommand');
  }

  if (p.index < 0 || p.index >= pages.length) {
    return fail(`Invalid tab index: ${p.index}. Valid range: 0-${pages.length - 1}`);
  }

  const targetPage = pages[p.index];
  await targetPage.bringToFront().catch(() => {});

  const session = ctx.sessionId ? getSessionById(ctx.sessionId) : undefined;
  if (session) {
    setActivePage(session, targetPage);
  }
  ctx.page = targetPage;

  const title = await targetPage.title().catch(() => '');

  return ok({
    index: p.index,
    url: targetPage.url(),
    title,
    total: pages.length,
  });
}
