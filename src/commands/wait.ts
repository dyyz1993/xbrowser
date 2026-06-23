import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

const waitForSelectorDef = {
  description: 'Wait for an element to appear on the page',
  scope: 'page' as const,
  parameters: z.object({
    selector: z.string(),
    state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
    timeout: z.number().optional(),
  }),
  result: z.object({
    selector: z.string(),
    found: z.boolean(),
  }),
  handler: async (p: { selector: string; state?: string; timeout?: number }, ctx: BrowserCommandContext) => {
    const timeout = p.timeout || 30000;
    const state = (p.state || 'visible') as string;
    const startTime = Date.now();

    const checkElement = async (): Promise<boolean> => {
      return ctx.page.evaluate(({ sel, st }: { sel: string; st: string }) => {
        const el = document.querySelector(sel);
        if (!el) return st === 'hidden' || st === 'detached';
        if (st === 'attached') return true;
        if (st === 'detached') return false;
        if (st === 'visible') {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        if (st === 'hidden') {
          const rect = el.getBoundingClientRect();
          return rect.width === 0 && rect.height === 0;
        }
        return true;
      }, { sel: p.selector, st: state });
    };

    while (Date.now() - startTime < timeout) {
      if (await checkElement()) {
        return ok({ selector: p.selector, found: true });
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return ok({ selector: p.selector, found: false });
  },
};

export const waitCommand = registerCommand({ name: 'wait', selectorParams: ['selector'], ...waitForSelectorDef });

export const waitForTimeoutCommand = registerCommand({
  name: 'waitForTimeout',
  description: 'Wait for a specified number of milliseconds',
  scope: 'project' as const,
  parameters: z.object({
    timeout: z.number().describe('Milliseconds to wait').default(1000),
  }),
  result: z.object({
    waited: z.number(),
  }),
  handler: async (p: { timeout: number }) => {
    await new Promise(r => setTimeout(r, p.timeout));
    return ok({ waited: p.timeout });
  },
});

