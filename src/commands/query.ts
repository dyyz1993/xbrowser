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
  result: z.object({ html: z.string() }),
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
  result: z.object({ text: z.string() }),
  handler: async (p, ctx: BrowserCommandContext) => {
    if (p.selector) {
      const text = await ctx.page.textContent(p.selector);
      return ok({ text: text || '' });
    }
    const text = await ctx.page.evaluate(() => document.body?.innerText || '');
    return ok({ text });
  },
});


