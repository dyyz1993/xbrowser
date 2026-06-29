import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const getCookiesCommand = registerCommand({
  name: 'get-cookies',

  description: 'Get all cookies for the current page',
  scope: 'page',
  result: z.object({
    cookies: z.array(z.record(z.unknown())),
  }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    const cookies = await ctx.browserContext.cookies();
    return ok({ cookies });
  },
});

export const setCookieCommand = registerCommand({
  name: 'set-cookie',

  description: 'Set a cookie',
  scope: 'page',
  parameters: z.object({
    name: z.coerce.string(),
    value: z.coerce.string(),
    domain: z.coerce.string().optional(),
    path: z.coerce.string().optional(),
    url: z.string().optional().describe('Cookie URL (alternative to domain)'),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  }),
  result: z.object({ name: z.string() }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const cookie = { ...p } as typeof p;
    // Resolve domain: explicit --domain > --url > current page URL
    if (!cookie.domain && !cookie.url) {
      const pageUrl = ctx.page.url();
      if (pageUrl && pageUrl !== 'about:blank') {
        try {
          const u = new URL(pageUrl);
          cookie.domain = u.hostname;
          if (!cookie.path) cookie.path = '/';
        } catch {
          // URL parse failed — fall through to validation below
        }
      }
    }
    // CDP requires either domain or url; without it the cookie is silently
    // rejected. Fail explicitly so the user knows it didn't work.
    if (!cookie.domain && !cookie.url) {
      return fail('set-cookie requires --domain or --url, or a non-blank page URL to infer from');
    }
    await ctx.browserContext.addCookies([cookie]);
    return ok({ name: p.name });
  },
});

export const clearCookiesCommand = registerCommand({
  name: 'clear-cookies',

  description: 'Clear all cookies',
  scope: 'page',
  result: z.object({ cleared: z.boolean() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.browserContext.clearCookies();
    return ok({ cleared: true });
  },
});

export const getLocalStorageCommand = registerCommand({
  name: 'get-local-storage',

  description: 'Get localStorage entries',
  scope: 'page',
  parameters: z.object({
    key: z.string().optional(),
  }),
  result: z.union([
    z.object({ key: z.string(), value: z.string().nullable() }),
    z.object({ data: z.record(z.string()) }),
  ]),
  handler: async (p, ctx: BrowserCommandContext) => {
    try {
      if (p.key) {
        const value = await ctx.page.evaluate<string | null>((k: string) => localStorage.getItem(k), p.key);
        return ok({ key: p.key, value });
      }
      const data = await ctx.page.evaluate<Record<string, string>>(() => {
        const entries: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) entries[key] = localStorage.getItem(key) ?? '';
        }
        return entries;
      });
      return ok({ data });
    } catch (e) {
      return fail(`localStorage not accessible on this page: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

export const setLocalStorageCommand = registerCommand({
  name: 'set-local-storage',

  description: 'Set a localStorage entry',
  scope: 'page',
  parameters: z.object({
    key: z.string(),
    value: z.string(),
  }),
  result: z.object({ key: z.string() }),
  handler: async (p, ctx: BrowserCommandContext) => {
    try {
      await ctx.page.evaluate(
        (args: { key: string; value: string }) => {
          localStorage.setItem(args.key, args.value);
        },
        { key: p.key, value: p.value }
      );
      return ok({ key: p.key });
    } catch (e) {
      return fail(`localStorage not accessible on this page: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

export const clearLocalStorageCommand = registerCommand({
  name: 'clear-local-storage',

  description: 'Clear all localStorage entries',
  scope: 'page',
  result: z.object({ cleared: z.boolean() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    try {
      await ctx.page.evaluate(() => localStorage.clear());
      return ok({ cleared: true });
    } catch (e) {
      return fail(`localStorage not accessible on this page: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});
