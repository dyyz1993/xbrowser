import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

const waitActionSchema = z.object({
  type: z.literal('wait'),
  milliseconds: z.number().positive().optional(),
  selector: z.string().optional(),
}).refine(
  (d) => (d.milliseconds !== undefined || d.selector !== undefined) &&
    !(d.milliseconds !== undefined && d.selector !== undefined),
  { message: "Either 'milliseconds' or 'selector' must be provided, but not both." },
);

const clickActionSchema = z.object({
  type: z.literal('click'),
  selector: z.string(),
  all: z.boolean().optional(),
});

const screenshotActionSchema = z.object({
  type: z.literal('screenshot'),
  fullPage: z.boolean().optional(),
  quality: z.number().min(1).max(100).optional(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
});

const writeActionSchema = z.object({
  type: z.literal('write'),
  text: z.string(),
});

const pressActionSchema = z.object({
  type: z.literal('press'),
  key: z.string(),
});

const scrollActionSchema = z.object({
  type: z.literal('scroll'),
  direction: z.enum(['up', 'down']).optional(),
  selector: z.string().optional(),
});

const scrapeActionSchema = z.object({
  type: z.literal('scrape'),
});

const executeJavascriptActionSchema = z.object({
  type: z.literal('executeJavascript'),
  script: z.string(),
});

const pdfActionSchema = z.object({
  type: z.literal('pdf'),
  landscape: z.boolean().optional(),
  scale: z.number().optional(),
  format: z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid', 'Ledger']).optional(),
});

const actionSchema = z.union([
  waitActionSchema,
  clickActionSchema,
  screenshotActionSchema,
  writeActionSchema,
  pressActionSchema,
  scrollActionSchema,
  scrapeActionSchema,
  executeJavascriptActionSchema,
  pdfActionSchema,
]);

type Action = z.infer<typeof actionSchema>;

type ActionResult =
  | { type: 'screenshot'; result: string }
  | { type: 'scrape'; result: { url: string; html: string } }
  | { type: 'executeJavascript'; result: { type: string; value: unknown } }
  | { type: 'pdf'; result: string }
  | { type: 'success' };

const MAX_ACTIONS = 50;

async function executeAction(page: BrowserCommandContext['page'], action: Action): Promise<ActionResult> {
  switch (action.type) {
    case 'wait':
      if (action.selector) {
        await page.waitForSelector(action.selector, { timeout: 30000 });
      } else if (action.milliseconds) {
        await new Promise(resolve => setTimeout(resolve, action.milliseconds));
      } else {
        throw new Error('wait action requires either milliseconds or selector');
      }
      return { type: 'success' };

    case 'click':
      if (action.all) {
        await page.$$eval(action.selector, (elements: Element[]) => {
          elements.forEach((el) => (el as HTMLElement).click());
        });
      } else {
        await page.click(action.selector);
      }
      return { type: 'success' };

    case 'screenshot': {
      const buf = await page.screenshot({
        fullPage: action.fullPage ?? false,
        type: 'jpeg',
        quality: action.quality ?? 80,
        ...(action.viewport ? { clip: { x: 0, y: 0, ...action.viewport } } : {}),
      });
      return { type: 'screenshot', result: buf.toString('base64') };
    }

    case 'write':
      await page.keyboard.type(action.text);
      return { type: 'success' };

    case 'press':
      await page.keyboard.press(action.key);
      return { type: 'success' };

    case 'scroll': {
      const dir = action.direction ?? 'down';
      const distance = dir === 'down' ? 500 : -500;
      if (action.selector) {
        await page.locator(action.selector).evaluate((el: HTMLElement, dist: number) => {
          el.scrollBy(0, dist);
        }, distance);
      } else {
        await page.evaluate((dist: number) => window.scrollBy(0, dist), distance);
      }
      return { type: 'success' };
    }

    case 'scrape': {
      const html = await page.innerHTML('body');
      return { type: 'scrape', result: { url: page.url(), html } };
    }

    case 'executeJavascript': {
      const value = await page.evaluate(action.script);
      return { type: 'executeJavascript', result: { type: typeof value, value } };
    }

    case 'pdf': {
      const buf = await page.pdf({
        landscape: action.landscape ?? false,
        scale: action.scale ?? 1,
        format: action.format ?? 'A4',
      });
      return { type: 'pdf', result: buf.toString('base64') };
    }

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export const actionsCommand = registerCommand({
  name: 'actions',
  description: '执行一系列 Actions（等待、点击、滚动、截图、填表单等）',
  scope: 'page',
  parameters: z.object({
    url: z.string().describe('起始 URL'),
    actions: z.array(actionSchema).max(MAX_ACTIONS).describe('Actions 数组（最多 50 个）'),
    output: z.enum(['text', 'json']).default('json').describe('输出格式：text 或 json'),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.goto(p.url, { waitUntil: 'domcontentloaded' });

    const results: ActionResult[] = [];
    for (const action of p.actions) {
      const result = await executeAction(ctx.page, action);
      results.push(result);
    }

    const title = await ctx.page.title();
    const finalUrl = ctx.page.url();

    if (p.output === 'text') {
      return ok({
        title,
        url: finalUrl,
        actions: results.map((r) => JSON.stringify(r)).join('\n'),
      });
    }

    return ok({
      title,
      url: finalUrl,
      results,
    });
  },
});
