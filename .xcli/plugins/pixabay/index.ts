import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pixabay', url: 'https://pixabay.com',
    description: 'Pixabay - Free images, royalty free stock photos', requiresLogin: false,
  });

  site.command('search-image', {
    description: 'Search Pixabay photos with metadata',
    scope: 'browser',
    parameters: z.object({
      query: z.string(), limit: z.number().optional().default(20),
      color: z.string().optional(), page: z.any().optional(), timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page) || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        let url = `https://pixabay.com/images/search/${encodeURIComponent(params.query)}/`;
        if (params.color) url += `?colors=${params.color}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        for (let i = 0; i < Math.ceil(params.limit / 10); i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(800);
        }
        const results = await page.evaluate((limit: number) => {
          const images: any[] = [];
          const items = document.querySelectorAll('.item img, img[src*="pixabay.com"]');
          items.forEach((item) => {
            if (images.length >= limit) return;
            const img = item as HTMLImageElement;
            const src = img.src || '';
            const lazy = img.getAttribute('data-lazy') || '';
            const srcset = img.getAttribute('srcset') || '';
            let originalUrl = lazy;
            if (!originalUrl && srcset) {
              const entries = srcset.split(',').map((s) => s.trim().split(' '));
              const largest = entries.sort((a, b) => (parseInt(b[1] || '0', 10) || 0) - (parseInt(a[1] || '0', 10) || 0))[0];
              originalUrl = largest?.[0] || src;
            }
            if (!originalUrl) originalUrl = src;
            images.push({
              title: img.alt || '', thumbnailUrl: src,
              sourceUrl: img.closest('a')?.href || '', originalUrl,
              width: parseInt(img.getAttribute('width') || '0', 10),
              height: parseInt(img.getAttribute('height') || '0', 10),
              format: 'jpg', sourceSite: 'pixabay',
            });
          });
          return images.slice(0, limit);
        }, params.limit);
        return { data: { query: params.query, engine: 'pixabay', results, total: results.length, timestamp: Date.now() }, tips: [`Pixabay "${params.query}"，共 ${results.length} 张`] };
      } catch (error) { return { data: null, message: error instanceof Error ? error.message : '未知错误' }; }
    },
  });
}
