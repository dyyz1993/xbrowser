import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';
import { createSession, destroyBrowser } from '../browser.js';

export const scrapeCommand = registerCommand({
  name: 'scrape',
  description: 'Scrape a page and convert to Markdown (with JS rendering)',
  scope: 'project',
  parameters: z.object({
    url: z.string(),
    selector: z.string().optional(),
    timeout: z.number().default(15000),
    format: z.enum(['markdown', 'html', 'text']).default('markdown'),
    onlyMainContent: z.boolean().default(true),
  }),
  handler: async (p, _ctx: BrowserCommandContext) => {
    const sessionName = `scrape-${Date.now()}`;

    try {
      const session = await createSession(sessionName, p.url, { headless: true });
      const page = session.page;

      await page.waitForLoadState('networkidle', { timeout: p.timeout });

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
    } finally {
      await destroyBrowser().catch(() => {});
    }
  },
});
