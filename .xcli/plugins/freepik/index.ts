import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const freepik = xcli.createSite({
    name: 'freepik',
    url: 'https://www.freepik.com',
    description: 'Freepik - Free vectors, photos and PSD downloads',
    requiresLogin: false,
  });

  freepik.command('search-image', {
    description: 'Freepik image search',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx);
      try {
        const url = `https://www.freepik.com/search?format=search&query=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await scrollPage(page, 3, 800);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          const items = document.querySelectorAll('img[src*="freepik"], .resource-img img');
          items.forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.naturalWidth < 50) return;

            const container = el.closest('a, .resource-img, figure');
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

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'freepik', results.map(r => ({ ...r, sourceSite: 'freepik' }))) as unknown as z.infer<typeof searchImageResultSchema>;
      } catch (error) {
        return buildFail(error, 'freepik') as unknown as z.infer<typeof searchImageResultSchema>;
      }
    },
  });
}
