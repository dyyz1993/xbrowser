import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const gettyimages = xcli.createSite({
    name: 'gettyimages',
    url: 'https://www.gettyimages.com',
    description: 'Getty Images - Stock Photos & Pictures',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  gettyimages.command('search-image', {
    description: 'Getty Images image search',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://www.gettyimages.com/search/2/image?phrase=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(6000);
        await scrollPage(page, 4, 1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let items = document.querySelectorAll('img[src*="getty"], .gallery-item img, img[src*="gettyimages"]');
          if (items.length === 0) {
            items = document.querySelectorAll('img');
          }
          items.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 50 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar')) return;

            const container = el.closest('a, .gallery-item, figure');
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

        return buildResult(params.query, 'gettyimages', results.map(r => ({ ...r, sourceSite: 'gettyimages' })));
      } catch (error) {
        return buildFail(error, 'gettyimages');
      }
    },
  });
}
