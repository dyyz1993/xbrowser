import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const clickCommand = registerCommand({
  name: 'click',
  description: 'Click on element',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    clickCount: z.number().optional(),
    delay: z.number().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.click(p.selector, {
      button: p.button,
      clickCount: p.clickCount,
      delay: p.delay,
    });
    return ok({ selector: p.selector });
  },
});

export const fillCommand = registerCommand({
  name: 'fill',
  description: 'Fill input field',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
    value: z.string(),
    clear: z.boolean().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.fill(p.selector, p.value);
    return ok({ selector: p.selector, value: p.value });
  },
});

export const typeCommand = registerCommand({
  name: 'type',
  description: 'Type text into element',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
    text: z.string(),
    delay: z.number().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.type(p.selector, p.text, { delay: p.delay });
    return ok({ selector: p.selector });
  },
});

export const pressCommand = registerCommand({
  name: 'press',
  description: 'Press a key',
  scope: 'element',
  parameters: z.object({
    selector: z.string().optional(),
    key: z.string(),
    delay: z.number().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.press(p.selector || 'body', p.key, { delay: p.delay });
    return ok({ key: p.key });
  },
});

export const selectCommand = registerCommand({
  name: 'select',
  description: 'Select option in dropdown',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const values = typeof p.value === 'string' ? [p.value] : p.value;
    await ctx.page.selectOption(p.selector, values);
    return ok({ selector: p.selector, value: p.value });
  },
});

export const checkCommand = registerCommand({
  name: 'check',
  description: 'Check checkbox or radio',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.check(p.selector);
    return ok({ selector: p.selector });
  },
});

export const hoverCommand = registerCommand({
  name: 'hover',
  description: 'Hover over element',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
    modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.hover(p.selector, { modifiers: p.modifiers });
    return ok({ selector: p.selector });
  },
});

export const dblclickCommand = registerCommand({
  name: 'dblclick',
  description: 'Double click on element',
  scope: 'element',
  parameters: z.object({
    selector: z.string(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    delay: z.number().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.dblclick(p.selector, {
      button: p.button,
      delay: p.delay,
    });
    return ok({ selector: p.selector });
  },
});
