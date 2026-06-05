import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const deviantart = xcli.createSite({
    name: 'deviantart',
    url: 'https://www.deviantart.com',
    description: 'DeviantArt Art Search',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  deviantart.command('search-image', {
    description: 'Search images on DeviantArt',
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
      const browserPage = (params.page as import('../types').Page)
        || (ctx as Record<string, unknown>).page as import('../types').Page;
      if (!browserPage) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.deviantart.com/search?q=${encodeURIComponent(params.query)}`;
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
            'img[src*="deviantart"], [data-hook="deviation_link"] img, ._2SlAD img'
          );
          imgs.forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.width < 50 || el.height < 50) return;

            const src = el.src;
            const originalUrl = src.replace(/\/v1\/fit\/w_\d+/, '/v1/fit/w_1024');
            const anchor = el.closest('a') || el.closest('[data-hook="deviation_link"]');

            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: anchor instanceof HTMLAnchorElement ? anchor.href : '',
              originalUrl,
              width: el.naturalWidth || el.width,
              height: el.naturalHeight || el.height,
              format: src.split('.').pop()?.split('?')[0] || 'jpg',
              sourceSite: 'deviantart',
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return ok({
            query: params.query,
            engine: 'deviantart',
            results,
            total: results.length,
            timestamp: Date.now(),
          }, [`DeviantArt "${params.query}"，共 ${results.length} 张`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
