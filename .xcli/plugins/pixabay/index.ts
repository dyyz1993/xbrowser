import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pixabay', url: 'https://pixabay.com',
    description: 'Pixabay - Free images, royalty free stock photos', requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  site.command('search-image', {
    description: 'Search Pixabay photos with metadata',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      ...baseSearchParams,
      color: z.string().optional(),
    }),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        let url = `https://pixabay.com/images/search/${encodeURIComponent(params.query)}/`;
        if (params.color) url += `?colors=${params.color}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await scrollPage(page, Math.ceil(params.limit / 10));

        const results = await page.evaluate((limit: number) => {
          const images: Record<string, unknown>[] = [];
          const items = document.querySelectorAll('.item img, img[src*="pixabay.com"]');
          items.forEach((item) => {
            if (images.length >= limit) return;
            const img = item as HTMLImageElement;
            const src = img.src || '';
            const lazy = img.getAttribute('data-lazy') || '';
            const srcset = img.getAttribute('srcset') || '';
            let originalUrl = lazy;
            if (!originalUrl && srcset) {
              const entries = srcset.split(',').map((s) => s.trim().split(' '));
              const largest = entries.sort((a, b) => (parseInt(b[1] || '0', 10) || 0) - (parseInt(a[1] || '0', 10) || 0))[0];
              originalUrl = largest?.[0] || src;
            }
            if (!originalUrl) originalUrl = src;
            images.push({
              title: img.alt || '', thumbnailUrl: src,
              sourceUrl: img.closest('a')?.href || '', originalUrl,
              width: parseInt(img.getAttribute('width') || '0', 10),
              height: parseInt(img.getAttribute('height') || '0', 10),
              format: 'jpg', sourceSite: 'pixabay',
            });
          });
          return images.slice(0, limit);
        }, params.limit);

        return buildResult(params.query, 'pixabay', results);
      } catch (error) {
        return buildFail(error, 'pixabay');
      }
    },
  });
}
