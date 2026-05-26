import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const scrollCommand = registerCommand({
  name: 'scroll',
  description: 'Scroll the page or an element',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    direction: z.enum(['up', 'down', 'left', 'right']),
    distance: z.number().optional(),
    selector: z.string().optional(),
  }),
  result: z.object({
    direction: z.enum(['up', 'down', 'left', 'right']),
    distance: z.number(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const distance = p.distance ?? 500;
    const deltas: Record<string, [number, number]> = {
      down: [0, distance],
      up: [0, -distance],
      right: [distance, 0],
      left: [-distance, 0],
    };
    const [dx, dy] = deltas[p.direction];

    if (p.selector) {
      const element = ctx.page.locator(p.selector).first();
      await element.evaluate((el, args) => {
        const [dxx, dyy] = args as [number, number];
        el.scrollBy(dxx, dyy);
      }, [dx, dy] as [number, number]);
    } else {
      await ctx.page.mouse.wheel(dx, dy);
    }
    return ok({ direction: p.direction, distance });
  },
});
