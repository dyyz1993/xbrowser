import { z } from 'zod';
import type { XCLIAPI, ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const flickr = xcli.createSite({
    name: 'flickr',
    url: 'https://www.flickr.com',
    description: 'Flickr Photo Search',
    requiresLogin: false,
  });

  flickr.command('search-image', {
    description: 'Search images on Flickr',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const browserPage = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!browserPage) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.flickr.com/search/?text=${encodeURIComponent(params.query)}`;
        await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await browserPage.waitForTimeout(3000);

        for (let i = 0; i < 3; i++) {
          await browserPage.evaluate(() => window.scrollBy(0, window.innerHeight));
          await browserPage.waitForTimeout(1000);
        }

        const results = await browserPage.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            originalUrl: string; width: number; height: number;
            format: string; sourceSite: string;
          }> = [];

          const imgs = document.querySelectorAll(
            'img[src*="flickr"], .photo-list-photo-view img, .view photo-list-photo-view img'
          );
          imgs.forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.width < 50 || el.height < 50) return;

            const src = el.src;
            const originalUrl = src.replace(/_[stmn]\./, '_b.');
            const anchor = el.closest('a');

            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: anchor?.href || '',
              originalUrl,
              width: el.naturalWidth || el.width,
              height: el.naturalHeight || el.height,
              format: src.split('.').pop()?.split('?')[0] || 'jpg',
              sourceSite: 'flickr',
            });
          });

          return images.slice(0, limit);
        }, params.limit);

    return ok({, []);
          tips: [`Flickr "${params.query}"，共 ${results.length} 张`],
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', []);
    },
  });
}
