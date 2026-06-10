import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const dribbble = xcli.createSite({
    name: 'dribbble',
    url: 'https://dribbble.com',
    description: 'Dribbble Design Shot Search',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  dribbble.command('search-image', {
    description: 'Search images on Dribbble',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://dribbble.com/search/${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await scrollPage(page, 2, 1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<Record<string, unknown>> = [];

          const imgs = document.querySelectorAll(
            'img[src*="dribbble"], .shot-thumbnail img, .shot-img img'
          );
          imgs.forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.width < 50 || el.height < 50) return;

            const src = el.src;
            const originalUrl = src.replace(/_1x\./, '_2x.');
            const anchor = el.closest('a');

            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: anchor?.href || '',
              originalUrl,
              width: el.naturalWidth || el.width,
              height: el.naturalHeight || el.height,
              format: src.split('.').pop()?.split('?')[0] || 'png',
              sourceSite: 'dribbble',
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return buildResult(params.query, 'dribbble', results);
      } catch (error) {
        return buildFail(error, 'dribbble');
      }
    },
  });
}
