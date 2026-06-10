import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const p500px = xcli.createSite({
    name: 'p500px',
    url: 'https://500px.com',
    description: '500px Photography Search',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  p500px.command('search-image', {
    description: 'Search images on 500px',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://500px.com/search?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(8000);
        await scrollPage(page, 6, 1500);

        const results = await page.evaluate((limit: number) => {
          const images: Array<Record<string, unknown>> = [];

          let imgs = document.querySelectorAll(
            'img[src*="500px"], img[src*="pcdn"], img[src*="500px.org"], .photo-card img, .PhotoCard img'
          );
          if (imgs.length === 0) {
            imgs = document.querySelectorAll('img');
          }
          imgs.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 30 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar')) return;

            const originalUrl = src.replace(/\/\d+\//, '/2048/');
            const anchor = el.closest('a');

            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: anchor?.href || '',
              originalUrl,
              width: el.naturalWidth || el.width,
              height: el.naturalHeight || el.height,
              format: src.split('.').pop()?.split('?')[0] || 'jpg',
              sourceSite: '500px',
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return buildResult(params.query, '500px', results);
      } catch (error) {
        return buildFail(error, '500px');
      }
    },
  });
}
