import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const waitForSelectorCommand = registerCommand({
  name: 'waitForSelector',
  description: 'Wait for an element to appear on the page',
  scope: 'page',
  parameters: z.object({
    selector: z.string(),
    state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
    timeout: z.number().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.waitForSelector(p.selector, {
      state: p.state || 'visible',
      timeout: p.timeout || 30000,
    });
    return ok({ selector: p.selector, found: true });
  },
});

export const waitForTimeoutCommand = registerCommand({
  name: 'waitForTimeout',
  description: 'Wait for a specified duration',
  scope: 'page',
  parameters: z.object({
    timeout: z.number(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.waitForTimeout(p.timeout);
    return ok({ waited: p.timeout });
  },
});
