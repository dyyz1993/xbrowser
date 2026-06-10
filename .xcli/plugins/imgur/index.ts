import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const imgur = xcli.createSite({
    name: 'imgur',
    url: 'https://imgur.com',
    description: 'Imgur 图片搜索',
    requiresLogin: false,
  });

  imgur.command('search-image', {
    description: 'Imgur 图片搜索 - 搜索 Imgur 上的图片',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        const url = `https://imgur.com/search?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          document.querySelectorAll('img[src*="imgur"]').forEach((img, idx) => {
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

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'imgur', results.map(r => ({ ...r, sourceSite: 'imgur' })));
      } catch (error) {
        return buildFail(error, 'imgur');
      }
    },
  });
}
