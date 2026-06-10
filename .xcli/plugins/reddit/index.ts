import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const reddit = xcli.createSite({
    name: 'reddit',
    url: 'https://www.reddit.com',
    description: 'Reddit 图片搜索',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  reddit.command('search-image', {
    description: 'Reddit 图片搜索 - 搜索 Reddit 中的图片帖子',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://www.reddit.com/search/?q=${encodeURIComponent(params.query)}&type=image`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          const selectors = 'img[src*="reddit"], img[src*="redd.it"]';
          document.querySelectorAll(selectors).forEach((img, idx) => {
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

        return buildResult(params.query, 'reddit', results.map(r => ({ ...r, sourceSite: 'reddit' })));
      } catch (error) {
        return buildFail(error, 'reddit');
      }
    },
  });
}
