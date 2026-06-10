import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const gag = xcli.createSite({
    name: '9gag',
    url: 'https://9gag.com',
    description: '9GAG 图片搜索',
    requiresLogin: false,
  });

  gag.command('search-image', {
    description: '9GAG 图片搜索 - 搜索 9GAG 上的搞笑图片和梗图',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx);
      try {
        const url = `https://9gag.com/search?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          const selectors = 'img[src*="9gag"], .post-container img';
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
        }, params.limit) as Array<{ title: string; thumbnailUrl: string; sourceUrl: string; width: number; height: number }>;

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, '9gag', results.map(r => ({ ...r, sourceSite: '9gag' }))) as unknown as z.infer<typeof searchImageResultSchema>;
      } catch (error) {
        return buildFail(error, '9gag') as unknown as z.infer<typeof searchImageResultSchema>;
      }
    },
  });
}
