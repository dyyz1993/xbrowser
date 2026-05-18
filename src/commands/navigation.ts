import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { detectSsr } from '../utils/ssr-detect.js';

export const gotoCommand = registerCommand({
  name: 'goto',
  description: 'Navigate to URL',
  scope: 'page',
  parameters: z.object({
    url: z.string(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  }),
  result: z.object({
    url: z.string(),
    status: z.number().optional(),
    ssr: z.boolean().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    // Auto-prefix https:// if missing
    let url = p.url;
    if (!/^https?:\/\//i.test(url) && !/^wss?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    const response = await ctx.page.goto(url, {
      waitUntil: p.waitUntil || 'domcontentloaded',
    });

    const ssr = await detectSsr(ctx.page);

    return ok({ url, status: response?.status(), ...(ssr ? { ssr } : {}) });
  },
});

/** 'open' is an alias for 'goto' */
export const openCommand = registerCommand({
  name: 'open',
  description: 'Open URL (alias for goto)',
  scope: 'page',
  parameters: z.object({
    url: z.string(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  }),
  result: z.object({
    url: z.string(),
    status: z.number().optional(),
    ssr: z.boolean().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    // Delegate to goto handler — p.url and p.waitUntil are used inside
    const { url, waitUntil, ...rest } = p;
    void rest;
    return gotoCommand.handler({ url, waitUntil }, ctx);
  },
});

export const backCommand = registerCommand({
  name: 'back',
  description: 'Go back in browser history',
  scope: 'page',
  result: z.object({ url: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goBack();
    return ok({ url: ctx.page.url() });
  },
});

export const forwardCommand = registerCommand({
  name: 'forward',
  description: 'Go forward in browser history',
  scope: 'page',
  result: z.object({ url: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goForward();
    return ok({ url: ctx.page.url() });
  },
});

export const refreshCommand = registerCommand({
  name: 'refresh',
  description: 'Refresh current page',
  scope: 'page',
  result: z.object({ url: z.string() }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.reload();
    return ok({ url: ctx.page.url() });
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
    return ok({ url: ctx.page.url() });
  },
});
