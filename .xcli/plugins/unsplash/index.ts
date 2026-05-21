import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'unsplash', url: 'https://unsplash.com',
    description: 'Unsplash - Free high-resolution photos', requiresLogin: false,
  });

  site.command('search-image', {
    description: 'Search Unsplash photos with metadata',
    scope: 'browser',
    parameters: z.object({
      query: z.string(), limit: z.number().optional().default(20),
      color: z.string().optional(), page: z.any().optional(), timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page) || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        let url = `https://unsplash.com/s/photos/${encodeURIComponent(params.query)}`;
        if (params.color) url += `?color=${params.color}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        for (let i = 0; i < Math.ceil(params.limit / 10); i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(800);
        }
        const results = await page.evaluate((limit: number) => {
          const images: any[] = [];
          const items = document.querySelectorAll('figure img, [data-testid="photo-grid-item"] img, .YEWhR img');
          items.forEach((item, idx) => {
            if (idx >= limit) return;
            const img = item as HTMLImageElement;
            const src = img.src || img.getAttribute('srcset')?.split(' ')[0] || '';
            const originalUrl = src.replace(/w=\d+/, 'w=2400') || src;
            images.push({
              title: img.alt || '', thumbnailUrl: src,
              sourceUrl: img.closest('a')?.href || '', originalUrl,
              width: parseInt(img.getAttribute('width') || '0', 10),
              height: parseInt(img.getAttribute('height') || '0', 10),
              format: 'jpg', sourceSite: 'unsplash',
            });
          });
          return images.slice(0, limit);
        }, params.limit);
        return ok({ query: params.query, engine: 'unsplash', results, total: results.length, timestamp: Date.now() }, [`Unsplash "${params.query}"，共 ${results.length} 张`]);
      } catch (error) { return { data: null, message: error instanceof Error ? error.message : '未知错误' }; }
    },
  });
}
