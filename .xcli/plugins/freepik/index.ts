import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const freepik = xcli.createSite({
    name: 'freepik',
    url: 'https://www.freepik.com',
    description: 'Freepik - Free vectors, photos and PSD downloads',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  freepik.command('search-image', {
    description: 'Freepik image search',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(10),
      timeout: z.number().optional().default(20000),
    }),
    result: z.object({
      query: z.string(),
      engine: z.string(),
      results: z.array(z.object({
        title: z.string(),
        thumbnailUrl: z.string(),
        sourceUrl: z.string(),
        originalUrl: z.string().optional(),
        width: z.number(),
        height: z.number(),
        format: z.string().optional(),
        sourceSite: z.string(),
        fileSize: z.string().optional(),
      }).passthrough()),
      total: z.number().optional(),
      timestamp: z.union([z.string(), z.number()]).optional(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = (params.page as import('../types').Page)
        || (ctx as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.freepik.com/search?format=search&query=${encodeURIComponent(params.query)}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);

        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(800);
        }

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          const items = document.querySelectorAll('img[src*="freepik"], .resource-img img');
          items.forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.naturalWidth < 50) return;

            const container = el.closest('a, .resource-img, figure');
            images.push({
              title: el.alt || '',
              thumbnailUrl: el.src,
              sourceUrl: (container as HTMLAnchorElement)?.href || '',
              width: el.naturalWidth || 0,
              height: el.naturalHeight || 0,
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return ok({
            query: params.query,
            engine: 'freepik',
            results: results.map(r => ({ ...r, sourceSite: 'freepik' })),
            }, [`Freepik "${params.query}"，共 ${results.length} 张`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
