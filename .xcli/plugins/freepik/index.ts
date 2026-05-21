import { z } from 'zod';
import type { XCLIAPI, ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const freepik = xcli.createSite({
    name: 'freepik',
    url: 'https://www.freepik.com',
    description: 'Freepik - Free vectors, photos and PSD downloads',
    requiresLogin: false,
  });

  freepik.command('search-image', {
    description: 'Freepik image search',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
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

    return ok({, []);
            total: results.length,
            timestamp: Date.now(),
          },
          tips: [`Freepik "${params.query}"，共 ${results.length} 张`],
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', []);
    },
  });
}
