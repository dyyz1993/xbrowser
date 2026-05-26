import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';
import { createEphemeralContext, closeEphemeralContext, resolveLaunchOpts } from '../browser.js';

export const scrapeCommand = registerCommand({
  name: 'scrape',
  description: 'Scrape a page and convert to Markdown (with JS rendering)',
  scope: 'project',
  selectorParams: ['selector'],
  parameters: z.object({
    url: z.string(),
    selector: z.string().optional(),
    timeout: z.number().default(30000),
    format: z.enum(['markdown', 'html', 'text']).default('markdown'),
    onlyMainContent: z.boolean().default(true),
    retries: z.number().int().min(0).max(5).optional().default(2).describe('重试次数（默认 2）'),
    waitAfterLoad: z.number().int().optional().default(0).describe('页面加载后额外等待毫秒'),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { context, page } = await createEphemeralContext(resolveLaunchOpts(ctx));
    const maxAttempts = p.retries + 1;

    try {
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: p.timeout });
          await page.waitForLoadState('networkidle', { timeout: p.timeout });

          if (p.waitAfterLoad > 0) {
            await page.waitForTimeout(p.waitAfterLoad);
          }

          if (p.selector) {
            await page.waitForSelector(p.selector, { timeout: p.timeout });
          }

          const html = await page.content();
          const title = await page.title();
          const finalUrl = page.url();

          let content: string;
          switch (p.format) {
            case 'markdown':
              content = htmlToMarkdown(html, { onlyMainContent: p.onlyMainContent });
              break;
            case 'html':
              content = html;
              break;
            case 'text':
              content = await page.innerText('body');
              break;
          }

          return ok({ content, title, url: finalUrl });
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxAttempts) {
            const backoff = attempt * 1000;
            console.error(`[scrape] Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${backoff}ms...`);
            await page.waitForTimeout(backoff);
          }
        }
      }

      return fail(`Scrape failed after ${maxAttempts} attempt(s): ${lastError?.message ?? 'unknown error'}`);
    } finally {
      await closeEphemeralContext(context);
    }
  },
  result: z.object({
    content: z.string(),
    title: z.string(),
    url: z.string(),
  }),
});
