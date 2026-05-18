import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const p500px = xcli.createSite({
    name: 'p500px',
    url: 'https://500px.com',
    description: '500px Photography Search',
    requiresLogin: false,
  });

  p500px.command('search-image', {
    description: 'Search images on 500px',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const browserPage = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!browserPage) throw new Error('需要浏览器页面');

      try {
        const url = `https://500px.com/search?q=${encodeURIComponent(params.query)}`;
        await browserPage.goto(url, { waitUntil: 'networkidle', timeout: params.timeout });
        await browserPage.waitForTimeout(8000);

        for (let i = 0; i < 6; i++) {
          await browserPage.evaluate(() => window.scrollBy(0, window.innerHeight));
          await browserPage.waitForTimeout(1500);
        }

        const results = await browserPage.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            originalUrl: string; width: number; height: number;
            format: string; sourceSite: string;
          }> = [];

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

        return {
          data: {
            query: params.query,
            engine: '500px',
            results,
            total: results.length,
            timestamp: Date.now(),
          },
          tips: [`500px "${params.query}"，共 ${results.length} 张`],
        };
      } catch (error) {
        return { data: null, message: error instanceof Error ? error.message : '未知错误' };
      }
    },
  });
}
