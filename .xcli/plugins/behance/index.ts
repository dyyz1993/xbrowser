import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const behance = xcli.createSite({
    name: 'behance',
    url: 'https://www.behance.net',
    description: 'Behance Creative Portfolio Search',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  behance.command('search-image', {
    description: 'Search images on Behance',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://www.behance.net/search?search=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await scrollPage(page, 2, 1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<Record<string, unknown>> = [];

          const imgs = document.querySelectorAll(
            'img[src*="behance"], .ProjectCoverNeue img, .cover img'
          );
          imgs.forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.width < 50 || el.height < 50) return;

            const src = el.src;
            const anchor = el.closest('a');

            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: anchor?.href || '',
              originalUrl: src,
              width: el.naturalWidth || el.width,
              height: el.naturalHeight || el.height,
              format: src.split('.').pop()?.split('?')[0] || 'jpg',
              sourceSite: 'behance',
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return buildResult(params.query, 'behance', results);
      } catch (error) {
        return buildFail(error, 'behance');
      }
    },
  });
}
