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
  result: z.object({
    selector: z.string(),
    newTab: z.object({ url: z.string(), title: z.string() }).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    // 用 Promise 监听新 Tab 打开事件（target="_blank" 链接等）
    let detectedNewPage: import('playwright').Page | undefined;
    let cleanup: (() => void) | undefined;

    if (ctx.browserContext?.on) {
      const pagePromise = new Promise<import('playwright').Page | undefined>((resolve) => {
        const timer = setTimeout(() => {
          ctx.browserContext.off('page', handler);
          resolve(undefined);
        }, 3000);
        const handler = (page: import('playwright').Page) => {
          clearTimeout(timer);
          ctx.browserContext.off('page', handler);
          resolve(page);
        };
        ctx.browserContext.on('page', handler);
      });
      cleanup = () => {
        // Force resolve to clean up timer if click throws
      };
      await ctx.page.click(p.selector, {
        button: p.button,
        clickCount: p.clickCount,
        delay: p.delay,
      });
      detectedNewPage = await pagePromise;
    } else {
      await ctx.page.click(p.selector, {
        button: p.button,
        clickCount: p.clickCount,
        delay: p.delay,
      });
    }

    void cleanup;

    if (detectedNewPage) {
      const np = detectedNewPage;
      await np.waitForLoadState('domcontentloaded').catch(() => {});
      const newUrl = np.url();
      const newTitle = (await np.title().catch(() => '')) as string;
      const result = ok({
        selector: p.selector,
        newTab: { url: newUrl, title: newTitle },
      });
      result.tips = [`新 Tab 已打开: ${newTitle ? newTitle + ' — ' : ''}${newUrl}`];
      return result;
    }

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
  result: z.object({
    selector: z.string(),
    value: z.string(),
    cleared: z.boolean(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    if (p.clear) {
      await ctx.page.fill(p.selector, '');
    }
    await ctx.page.fill(p.selector, p.value);
    return ok({ selector: p.selector, value: p.value, cleared: p.clear || false });
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
  result: z.object({
    selector: z.string(),
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
  result: z.object({
    key: z.string(),
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
  result: z.object({
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
  result: z.object({
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
  result: z.object({
    selector: z.string(),
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
  result: z.object({
    selector: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.dblclick(p.selector, {
      button: p.button,
      delay: p.delay,
    });
    return ok({ selector: p.selector });
  },
});
