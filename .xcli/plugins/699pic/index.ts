import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const pic699 = xcli.createSite({
    name: '699pic',
    url: 'https://www.699pic.com',
    description: '摄图网 - 正版高清图片素材库',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  pic699.command('search-image', {
    description: '摄图网图片搜索',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://www.699pic.com/search/?kw=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await scrollPage(page, 2, 800);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          const items = document.querySelectorAll('img[src*="699pic"], .search-list img');
          items.forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.naturalWidth < 50) return;

            const container = el.closest('a, .search-list-item, figure');
            images.push({
              title: el.alt || '',
              thumbnailUrl: el.src,
              sourceUrl: (container as HTMLAnchorElement)?.href || '',
              width: el.naturalWidth || 0,
              height: el.naturalHeight || 0,
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return buildResult(params.query, '699pic', results.map(r => ({ ...r, sourceSite: '699pic' })));
      } catch (error) {
        return buildFail(error, '699pic');
      }
    },
  });
}
