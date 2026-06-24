import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { detectSsr } from '../utils/ssr-detect.js';

export const gotoCommand = registerCommand({
  name: 'goto',
  description: 'Navigate to URL',
  scope: 'page',
  parameters: z.object({
    url: z.string(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
    timeout: z.number().optional(),
  }),
  result: z.object({
    url: z.string(),
    status: z.number().optional(),
    ssr: z.boolean().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    // Auto-prefix https:// if missing — but don't touch special schemes
    let url = p.url;
    const hasScheme = /^(https?|wss?|file|about|data|chrome|blob):/i.test(url);
    if (!hasScheme) {
      // Check if it looks like a domain (contains a dot or is localhost)
      if (/^[\w-]+(\.[\w-]+)+/.test(url) || url.startsWith('localhost')) {
        url = 'https://' + url;
      } else {
        return fail(`Invalid URL: "${url}". Expected http(s)://, file://, about:, data:, or a domain name.`);
      }
    }

    // Wrap navigation in try/catch so || chains can fallback on failure
    let response;
    try {
      response = await ctx.page.goto(url, {
        waitUntil: p.waitUntil || 'domcontentloaded',
        ...(p.timeout ? { timeout: p.timeout } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Navigation failed: ${msg}`);
    }

    const ssr = await detectSsr(ctx.page);

    return ok({ url, status: response?.status(), ...(ssr ? { ssr } : {}) });
  },
});

export const backCommand = registerCommand({
  name: 'back',
  description: 'Go back in browser history',
  scope: 'page',
  result: z.object({ url: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goBack();
    // Read live URL after navigation completes
    const url = await ctx.page.evaluate<string>('location.href').catch(() => ctx.page.url());
    return ok({ url });
  },
});

export const forwardCommand = registerCommand({
  name: 'forward',
  description: 'Go forward in browser history',
  scope: 'page',
  result: z.object({ url: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goForward();
    const url = await ctx.page.evaluate<string>('location.href').catch(() => ctx.page.url());
    return ok({ url });
  },
});

export const refreshCommand = registerCommand({
  name: 'refresh',
  description: 'Refresh current page',
  scope: 'page',
  result: z.object({ url: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    try {
      await ctx.page.reload();
    } catch (err) {
      return fail(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const url = await ctx.page.evaluate<string>('location.href').catch(() => ctx.page.url());
    return ok({ url });
  },
});

export const titleCommand = registerCommand({
  name: 'title',
  description: 'Get page title',
  scope: 'page',
  result: z.object({ title: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    const title = await ctx.page.title();
    return ok({ title });
  },
});

export const urlCommand = registerCommand({
  name: 'url',
  description: 'Get current page URL',
  scope: 'page',
  result: z.object({ url: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    // Always read live URL via evaluate — cached _url may be stale after navigation
    const url = await ctx.page.evaluate<string>('location.href').catch(() => ctx.page.url() || 'about:blank');
    return ok({ url });
  },
});

// `open` is an alias for `goto`
registerCommand({
  name: 'open',
  description: 'Navigate to URL (alias for goto)',
  scope: 'page',
  parameters: gotoCommand.parameters,
  result: gotoCommand.result,
  handler: gotoCommand.handler as (...args: unknown[]) => Promise<unknown>,
});
