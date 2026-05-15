import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const gettyimages = xcli.createSite({
    name: 'gettyimages',
    url: 'https://www.gettyimages.com',
    description: 'Getty Images - Stock Photos & Pictures',
    requiresLogin: false,
  });

  gettyimages.command('search-image', {
    description: 'Getty Images image search',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.gettyimages.com/search/2/image?phrase=${encodeURIComponent(params.query)}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(6000);

        for (let i = 0; i < 4; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1000);
        }

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

        return {
          data: {
            query: params.query,
            engine: 'gettyimages',
            results: results.map(r => ({ ...r, sourceSite: 'gettyimages' })),
            total: results.length,
            timestamp: Date.now(),
          },
          tips: [`Getty Images "${params.query}"，共 ${results.length} 张`],
        };
      } catch (error) {
        return { data: null, message: error instanceof Error ? error.message : '未知错误' };
      }
    },
  });
}
