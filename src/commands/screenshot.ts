import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import { writeFileSync } from 'fs';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const screenshotCommand = registerCommand({
  name: 'screenshot',
  description: 'Take a screenshot of the page or element',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string().optional(),
    type: z.enum(['png', 'jpeg']).optional(),
    fullPage: z.boolean().optional(),
    output: z.string().optional(),
  }),
  result: z.union([
    z.object({
      data: z.string(),
      format: z.string(),
      size: z.number(),
    }),
    z.object({
      output: z.string(),
      format: z.string(),
      size: z.number(),
    }),
  ]),
  handler: async (p, ctx: BrowserCommandContext) => {
    const options: Record<string, unknown> = {
      type: p.type || 'png',
      fullPage: p.fullPage || false,
    };
    let buffer: Buffer;
    if (p.selector) {
      buffer = await ctx.page.locator(p.selector).first().screenshot(options);
    } else {
      buffer = await ctx.page.screenshot(options);
    }
    if (p.output) {
      writeFileSync(p.output, buffer);
      return ok({
        output: p.output,
        format: p.type || 'png',
        size: buffer.length,
      });
    }
    return ok({
      data: buffer.toString('base64'),
      format: p.type || 'png',
      size: buffer.length,
    });
  },
});
