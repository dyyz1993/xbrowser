import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'unsplash', url: 'https://unsplash.com',
    description: 'Unsplash - Free high-resolution photos', requiresLogin: false,
  });

  site.command('search-image', {
    description: 'Search Unsplash photos with metadata',
    scope: 'browser',
    parameters: z.object({
      ...baseSearchParams,
      color: z.string().optional(),
    }),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        let url = `https://unsplash.com/s/photos/${encodeURIComponent(params.query)}`;
        if (params.color) url += `?color=${params.color}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await scrollPage(page, Math.ceil(params.limit / 10));

        const results = await page.evaluate((limit: number) => {
          const images: Record<string, unknown>[] = [];
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
        }, params.limit) as Array<Record<string, unknown>>;

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'unsplash', results);
      } catch (error) {
        return buildFail(error, 'unsplash');
      }
    },
  });
}
