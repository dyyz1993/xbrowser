import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const mouseCommand = registerCommand({
  name: 'mouse',
  description: 'Control the mouse (move, click, etc.)',
  scope: 'page',
  parameters: z.object({
    action: z.enum(['move', 'down', 'up', 'click', 'dblclick']),
    x: z.number(),
    y: z.number(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    steps: z.number().optional(),
  }),
  result: z.object({
    action: z.enum(['move', 'down', 'up', 'click', 'dblclick']),
    x: z.number(),
    y: z.number(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const button = p.button || 'left';
    switch (p.action) {
      case 'move':
        await ctx.page.mouse.move(p.x, p.y, { steps: p.steps || 1 });
        break;
      case 'down':
        await ctx.page.mouse.down({ button });
        break;
      case 'up':
        await ctx.page.mouse.up({ button });
        break;
      case 'click':
        await ctx.page.mouse.click(p.x, p.y, { button });
        break;
      case 'dblclick':
        await ctx.page.mouse.dblclick(p.x, p.y, { button });
        break;
    }
    return ok({ action: p.action, x: p.x, y: p.y });
  },
});
