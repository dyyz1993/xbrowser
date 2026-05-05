import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const htmlCommand = registerCommand({
  name: 'html',
  description: 'Get page HTML content',
  scope: 'page',
  parameters: z.object({
    selector: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    if (p.selector) {
      const html = await ctx.page.innerHTML(p.selector);
      return ok({ html });
    }
    const html = await ctx.page.content();
    return ok({ html });
  },
});

export const textCommand = registerCommand({
  name: 'text',
  description: 'Get text content',
  scope: 'page',
  parameters: z.object({
    selector: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    if (p.selector) {
      const text = await ctx.page.textContent(p.selector);
      return ok({ text: text || '' });
    }
    const text = await ctx.page.evaluate(() => document.body?.innerText || '');
    return ok({ text });
  },
});

export const titleQueryCommand = registerCommand({
  name: 'queryTitle',
  description: 'Get page title',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    const title = await ctx.page.title();
    return ok({ title });
  },
});

export const urlQueryCommand = registerCommand({
  name: 'queryUrl',
  description: 'Get current page URL',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    return ok({ url: ctx.page.url() });
  },
});

export const getPropertyCommand = registerCommand({
  name: 'getProperty',
  description: 'Get element property or attribute',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
    property: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const value = await ctx.page.getAttribute(p.selector, p.property);
    return ok({ property: p.property, selector: p.selector, value });
  },
});
