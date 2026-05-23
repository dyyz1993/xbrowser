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
    const frameList = ctx.page.frames().map((frame, index) => ({
      index,
      name: frame.name(),
      url: frame.url(),
    }));
    return ok({ frames: frameList });
  },
});

export const frameCommand = registerCommand({
  name: 'frame',
  description: 'Switch to a frame by index or name',
  scope: 'page',
  parameters: z.object({
    index: z.number().optional(),
    name: z.string().optional(),
  }),
  result: z.object({
    name: z.string().nullable(),
    url: z.string(),
    error: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const allFrames = ctx.page.frames();
    let targetFrame;

    if (p.index !== undefined) {
      targetFrame = allFrames[p.index];
    } else if (p.name !== undefined) {
      targetFrame = allFrames.find((f) => f.name() === p.name);
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
