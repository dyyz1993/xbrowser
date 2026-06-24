import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const setViewportCommand = registerCommand({
  name: 'set-viewport',

  description: 'Set the viewport size and properties',
  scope: 'browser',
  parameters: z.object({
    width: z.coerce.number(),
    height: z.coerce.number(),
    deviceScaleFactor: z.coerce.number().optional(),
    isMobile: z.boolean().optional(),
    hasTouch: z.boolean().optional(),
  }),
  result: z.object({
    width: z.number(),
    height: z.number(),
    deviceScaleFactor: z.number().optional(),
    isMobile: z.boolean().optional(),
    hasTouch: z.boolean().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const viewport = ctx.page.viewportSize();
    const width = p.width ?? viewport?.width ?? 1280;
    const height = p.height ?? viewport?.height ?? 720;
    await ctx.page.setViewportSize({
      width,
      height,
      ...(p.deviceScaleFactor !== undefined && { deviceScaleFactor: p.deviceScaleFactor }),
      ...(p.isMobile !== undefined && { isMobile: p.isMobile }),
      ...(p.hasTouch !== undefined && { hasTouch: p.hasTouch }),
    });
    return ok({
      width,
      height,
      ...(p.deviceScaleFactor !== undefined && { deviceScaleFactor: p.deviceScaleFactor }),
      ...(p.isMobile !== undefined && { isMobile: p.isMobile }),
      ...(p.hasTouch !== undefined && { hasTouch: p.hasTouch }),
    });
  },
});
