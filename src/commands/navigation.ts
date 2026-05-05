import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const gotoCommand = registerCommand({
  name: 'goto',
  description: 'Navigate to URL',
  scope: 'page',
  parameters: z.object({
    url: z.string(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const response = await ctx.page.goto(p.url, {
      waitUntil: p.waitUntil || 'domcontentloaded',
    });
    return ok({ url: p.url, status: response?.status() });
  },
});

export const backCommand = registerCommand({
  name: 'back',
  description: 'Go back in browser history',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goBack();
    return ok({ url: ctx.page.url() });
  },
});

export const forwardCommand = registerCommand({
  name: 'forward',
  description: 'Go forward in browser history',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goForward();
    return ok({ url: ctx.page.url() });
  },
});

export const refreshCommand = registerCommand({
  name: 'refresh',
  description: 'Refresh current page',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.reload();
    return ok({ url: ctx.page.url() });
  },
});

export const titleCommand = registerCommand({
  name: 'title',
  description: 'Get page title',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    const title = await ctx.page.title();
    return ok({ title });
  },
});

export const urlCommand = registerCommand({
  name: 'url',
  description: 'Get current page URL',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    return ok({ url: ctx.page.url() });
  },
});
