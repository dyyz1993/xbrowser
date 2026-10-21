import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const htmlCommand = registerCommand({
  name: 'html',
  description: 'Get page HTML content',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string().optional(),
  }),
  result: z.object({ html: z.string() }),
  handler: async (p, ctx: BrowserCommandContext) => {
    if (p.selector) {
      const html = await ctx.page.innerHTML(p.selector);
      return ok({ html });
    }
    const html = await ctx.page.content();
    return ok({ html });
  },
});

export const textCommand = registerCommand({
  name: 'text',
  description: 'Get text content',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string().optional(),
    frame: z.string().optional().describe('URL 含此子串的 OOPIF——在跨域 iframe 的 DOM 内读取文本'),
  }),
  result: z.object({ text: z.string(), frame: z.string().optional() }),
  handler: async (p, ctx: BrowserCommandContext) => {
    // OOPIF 路由：选择器在跨域 iframe 内解析
    const frameTarget = p.frame ?? ctx.frame;
    if (frameTarget) {
      const expr = p.selector
        ? `(() => { const el = document.querySelector(${JSON.stringify(p.selector)}); return el ? (el.textContent ?? '').trim() : null; })()`
        : `(document.body?.innerText || '').trim()`;
      const text = await ctx.page.evaluateInFrame<string | null>(frameTarget, expr);
      return ok({ text: text || '', frame: frameTarget });
    }
    if (p.selector) {
      const text = await ctx.page.textContent(p.selector);
      return ok({ text: text || '' });
    }
    const text = await ctx.page.evaluate(() => (document.body?.innerText || '').trim());
    return ok({ text });
  },
});


