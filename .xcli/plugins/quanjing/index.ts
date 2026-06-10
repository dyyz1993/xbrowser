import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const quanjing = xcli.createSite({
    name: 'quanjing',
    url: 'https://www.quanjing.com',
    description: '全景创意图片搜索',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  quanjing.command('search-image', {
    description: '全景网图片搜索 - 搜索创意素材图片',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://www.quanjing.com/search?kw=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          document.querySelectorAll('img[src*="quanjing"]').forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.naturalWidth < 80) return;
            images.push({
              title: el.alt || '',
              thumbnailUrl: el.src,
              sourceUrl: el.closest('a')?.getAttribute('href') || '',
              width: el.naturalWidth,
              height: el.naturalHeight,
            });
          });

          return images;
        }, params.limit);

        return buildResult(params.query, 'quanjing', results.map(r => ({ ...r, sourceSite: 'quanjing' })));
      } catch (error) {
        return buildFail(error, 'quanjing');
      }
    },
  });
}
