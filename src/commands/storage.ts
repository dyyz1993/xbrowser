import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const getCookiesCommand = registerCommand({
  name: 'get-cookies',
  aliases: ['getCookies'],
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
  aliases: ['setCookie'],
  description: 'Set a cookie',
  scope: 'page',
  parameters: z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  }),
  result: z.object({ name: z.string() }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.browserContext.addCookies([p]);
    return ok({ name: p.name });
  },
});

export const clearCookiesCommand = registerCommand({
  name: 'clear-cookies',
  aliases: ['clearCookies'],
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
  aliases: ['getLocalStorage'],
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
    if (p.key) {
      const value = await ctx.page.evaluate((k) => localStorage.getItem(k), p.key);
      return ok({ key: p.key, value });
    }
    const data = await ctx.page.evaluate(() => {
      const entries: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) entries[key] = localStorage.getItem(key) ?? '';
      }
      return entries;
    });
    return ok({ data });
  },
});

export const setLocalStorageCommand = registerCommand({
  name: 'set-local-storage',
  aliases: ['setLocalStorage'],
  description: 'Set a localStorage entry',
  scope: 'page',
  parameters: z.object({
    key: z.string(),
    value: z.string(),
  }),
  result: z.object({ key: z.string() }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.evaluate(
      (args) => {
        localStorage.setItem(args.key, args.value);
      },
      { key: p.key, value: p.value }
    );
    return ok({ key: p.key });
  },
});

export const clearLocalStorageCommand = registerCommand({
  name: 'clear-local-storage',
  aliases: ['clearLocalStorage'],
  description: 'Clear all localStorage entries',
  scope: 'page',
  result: z.object({ cleared: z.boolean() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.evaluate(() => localStorage.clear());
    return ok({ cleared: true });
  },
});
