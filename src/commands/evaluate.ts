import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const evaluateCommand = registerCommand({
  name: 'eval',
  description: 'Evaluate JavaScript expression in the browser',
  scope: 'page',
  parameters: z.object({
    expression: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const result = await ctx.page.evaluate(p.expression);
    return ok({ result });
  },
});

export const evaluateFnCommand = registerCommand({
  name: 'evaluate-fn',
  aliases: ['evaluateFn'],
  description: 'Evaluate a function with arguments in the browser',
  scope: 'page',
  parameters: z.object({
    fn: z.string(),
    args: z.array(z.unknown()).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const result = await ctx.page.evaluate(
      (args: { fnBody: string; fnArgs: unknown[] }) => {
        const fn = new Function('...args', args.fnBody);
        return fn(...args.fnArgs);
      },
      { fnBody: p.fn, fnArgs: p.args || [] }
    );
    return ok({ result });
  },
});
