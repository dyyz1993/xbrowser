import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const shutterstock = xcli.createSite({
    name: 'shutterstock',
    url: 'https://www.shutterstock.com',
    description: 'Shutterstock - Stock Photos, Images & Vectors',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  shutterstock.command('search-image', {
    description: 'Shutterstock image search',
    loginRequired: 'none',
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
        const url = `https://www.shutterstock.com/search/${encodeURIComponent(params.query)}`;

        await page.goto(url, { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(6000);

        for (let i = 0; i < 6; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1500);
        }

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let items = document.querySelectorAll('img[src*="shutterstock"], .search-results-grid img, img[src*="shutter"]');
          if (items.length === 0) {
            items = document.querySelectorAll('img');
          }
          items.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 30 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar')) return;

            const container = el.closest('a, [data-testid], .search-results-grid-item');
            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: (container as HTMLAnchorElement)?.href || '',
              width: el.naturalWidth || el.width || 0,
              height: el.naturalHeight || el.height || 0,
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return ok({
            query: params.query,
            engine: 'shutterstock',
            results: results.map(r => ({ ...r, sourceSite: 'shutterstock' })),
            }, [`Shutterstock "${params.query}"，共 ${results.length} 张`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
