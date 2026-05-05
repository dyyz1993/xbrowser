import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const structureCommand = registerCommand({
  name: 'structure',
  description: 'Get the DOM structure of the page or an element',
  scope: 'page',
  parameters: z.object({
    selector: z.string().optional(),
    depth: z.number().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const structure = await ctx.page.evaluate(
      (args) => {
        const { sel, maxDepth } = args;
        const root = sel ? document.querySelector(sel) : document.body;
        if (!root) return { tag: 'none', role: '', text: '', children: [] };

        function buildTree(el: Element, d: number) {
          if (d <= 0) {
            return {
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute('role') ?? '',
              text: '',
              children: [],
            };
          }
          const children: Array<{
            tag: string;
            role: string;
            text: string;
            children: unknown[];
          }> = [];
          for (const child of Array.from(el.children)) {
            children.push(buildTree(child, d - 1));
          }
          return {
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') ?? '',
            text: (el.textContent ?? '').substring(0, 100),
            children,
          };
        }

        return buildTree(root, maxDepth);
      },
      { sel: p.selector || 'body', maxDepth: p.depth || 5 }
    );
    return ok({ structure });
  },
});
