import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const framesCommand = registerCommand({
  name: 'frames',
  description: 'List all frames in the current page',
  scope: 'page',
  result: z.object({
    frames: z.array(z.object({
      index: z.number(),
      name: z.string().nullable(),
      url: z.string(),
    })),
  }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    const discover = ctx.page.discoverFrames;
    const rawFrames = discover ? await discover.call(ctx.page) : ctx.page.frames();
    const frameList = rawFrames.map((frame, index) => ({
      index,
      name: frame.name(),
      url: frame.url(),
    }));
    return ok({ frames: frameList });
  },
});

export const frameCommand = registerCommand({
  name: 'frame',
  description: 'Get frame info by index or name',
  scope: 'page',
  parameters: z.object({
    index: z.number().int().min(0).optional(),
    name: z.string().optional(),
  }),
  result: z.object({
    name: z.string().nullable(),
    url: z.string(),
    error: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const discover = ctx.page.discoverFrames;
    const rawFrames = discover ? await discover.call(ctx.page) : ctx.page.frames();
    let targetFrame;

    if (p.index !== undefined) {
      targetFrame = rawFrames[p.index];
    } else if (p.name !== undefined) {
      targetFrame = rawFrames.find((f) => f.name() === p.name);
    } else {
      return fail('Must provide index or name');
    }

    if (!targetFrame) {
      return fail('Frame not found');
    }

    return ok({
      name: targetFrame.name(),
      url: targetFrame.url(),
    });
  },
});
