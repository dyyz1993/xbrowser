import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const mouseCommand = registerCommand({
  name: 'mouse',
  description: 'Control the mouse (move, click, etc.)',
  scope: 'page',
  parameters: z.object({
    action: z.enum(['move', 'down', 'up', 'click', 'dblclick', 'drag']),
    x: z.coerce.number(),
    y: z.coerce.number(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    steps: z.coerce.number().optional(),
  }),
  result: z.object({
    action: z.enum(['move', 'down', 'up', 'click', 'dblclick', 'drag']),
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
        // A real press happens AT the coordinates — move first, otherwise the
        // dispatch goes to the stale internal position (0,0) and misses the
        // target entirely (rec-duel d08: slider grab at pointerdown 0,0).
        await ctx.page.mouse.move(p.x, p.y);
        await ctx.page.mouse.down({ button });
        break;
      case 'up':
        await ctx.page.mouse.move(p.x, p.y);
        await ctx.page.mouse.up({ button });
        break;
      case 'click':
        await ctx.page.mouse.click(p.x, p.y, { button });
        break;
      case 'dblclick':
        await ctx.page.mouse.dblclick(p.x, p.y, { button });
        break;
      case 'drag':
        // 从当前鼠标位置拖到 (x,y) —— 驱动真实 HTML5 DnD 管线（d59 实测：
        // dragstart→dragover…→drop→dragend 全 trusted）
        await ctx.page.mouse.drag(p.x, p.y, p.steps ? { steps: p.steps } : {});
        break;
    }
    return ok({ action: p.action, x: p.x, y: p.y });
  },
});
