import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const deviantart = xcli.createSite({
    name: 'deviantart',
    url: 'https://www.deviantart.com',
    description: 'DeviantArt Art Search',
    requiresLogin: false,
  });

  deviantart.command('search-image', {
    description: 'Search images on DeviantArt',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        const url = `https://www.deviantart.com/search?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await scrollPage(page, 3, 1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<Record<string, unknown>> = [];

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
        }, params.limit) as Array<Record<string, unknown>>;

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'deviantart', results);
      } catch (error) {
        return buildFail(error, 'deviantart');
      }
    },
  });
}
