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
    if (!ctx.browserContext) {
      return fail('No browser context available. Use --cdp to connect to a browser first.');
    }

    // Refresh pages snapshot right before each operation so concurrent tab
    // changes don't cause stale-index bugs (e.g. closing the wrong tab).
    const pages = ctx.browserContext.pages();

    switch (p.subcommand) {
      case 'list':
        return handleList(pages, ctx);

      case 'new':
        return handleNew(p, pages, ctx);

      case 'close':
        return handleClose(p, ctx);

      case 'switch':
        return handleSwitch(p, pages, ctx);

      default:
        return fail(`Unknown subcommand: ${p.subcommand as string}`);
    }
  },
});

async function handleList(
  pages: Page[],
  ctx: BrowserCommandContext,
): Promise<unknown> {
  const tabs: Array<{ index: number; url: string; title: string; active: boolean }> = [];
  let activeIndex = -1;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const url = page.url();
    const title = await page.title().catch(() => '');
    const isActive = page === ctx.page;
    if (isActive) activeIndex = i;
    tabs.push({ index: i, url, title, active: isActive });
  }

  return ok({ tabs, total: tabs.length, activeIndex });
}

async function handleNew(
  p: TabParamsType,
  _pages: Page[],
  ctx: BrowserCommandContext,
): Promise<unknown> {
  const newPage = await ctx.browserContext.newPage();
  const warnings: string[] = [];

  if (p.url) {
    let url = p.url;
    // Only prepend https:// when there is no scheme at all
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
      url = 'https://' + url;
    }
    try {
      await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (err) {
      warnings.push(`Navigation to "${url}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    await newPage.waitForLoadState('domcontentloaded');
  } catch {
    // non-blocking wait can time out if page is still blank — not a hard failure
  }

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
    ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
  });
}

async function handleClose(
  p: TabParamsType,
  ctx: BrowserCommandContext,
): Promise<unknown> {
  // Refresh pages right before close so concurrent tab changes don't cause
  // closing the wrong tab (stale index from the handler-entry snapshot).
  const currentPages = ctx.browserContext.pages();
  if (currentPages.length <= 1) {
    return fail('Cannot close the last remaining tab');
  }

  const closeIndex = p.index ?? currentPages.findIndex(pg => pg === ctx.page);
  if (closeIndex < 0 || closeIndex >= currentPages.length) {
    return fail(`Invalid tab index: ${closeIndex}. Valid range: 0-${currentPages.length - 1}`);
  }

  const pageToClose = currentPages[closeIndex];
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
      : remainingPages.findIndex(pg => pg === ctx.page),
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
  // Warm up the wrapper before rebinding the session: freshly-created tabs
  // (target=_blank) can transiently fail evaluate, and a failed liveness
  // probe on the next command would rebuild the session onto the OLD tab (d07).
  for (let i = 0; i < 5; i++) {
    const okProbe = await targetPage.evaluate('1').then(() => true, () => false);
    if (okProbe) break;
    await new Promise(r => setTimeout(r, 300));
  }
  // R106/d07 第六层：evaluate 走 Runtime domain 秒过，但 Input domain 的首个
  // dispatchMouseEvent 慢至 6-7s（新 tab 的 Input agent 未激活）—— stealth 轨迹
  // 10+ 事件累计 70s。预热：派发一个轻量 mouseMoved 激活 Input 管道。
  try {
    const mouse = (targetPage as unknown as { mouse?: { move: (x: number, y: number) => Promise<void> } }).mouse;
    if (mouse) await mouse.move(1, 1).catch(() => {});
  } catch { /* best-effort */ }

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
