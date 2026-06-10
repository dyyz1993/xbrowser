import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const pic58 = xcli.createSite({
    name: '58pic',
    url: 'https://www.58pic.com',
    description: '58pic - 千图网 免费设计素材',
    requiresLogin: false,
  });

  pic58.command('search-image', {
    description: '千图网图片搜索',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx);
      try {
        const url = `https://www.58pic.com/search/0/${encodeURIComponent(params.query)}.html`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(5000);
        await scrollPage(page, 3, 1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let items = document.querySelectorAll('img[src*="58pic"], .list-box img, img[src*="pic.58pic"]');
          if (items.length === 0) {
            items = document.querySelectorAll('img');
          }
          items.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 50 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar')) return;

            const container = el.closest('a, .list-box-item, figure');
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

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, '58pic', results.map(r => ({ ...r, sourceSite: '58pic' }))) as unknown as z.infer<typeof searchImageResultSchema>;
      } catch (error) {
        return buildFail(error, '58pic') as unknown as z.infer<typeof searchImageResultSchema>;
      }
    },
  });
}
