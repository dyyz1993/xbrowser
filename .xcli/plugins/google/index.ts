import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const google = xcli.createSite({
    name: 'google',
    url: 'https://www.google.com',
    description: 'Google Search & Images',
    requiresLogin: false,
  });

  google.command('search-image', {
    description: 'Google Images search - extract image URLs, sizes, and metadata',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(20),
      size: z.enum(['any', 'large', 'medium', 'small', 'icon']).optional().default('any'),
      color: z.string().optional(),
      type: z.enum(['photo', 'clipart', 'lineart', 'animated', 'vector']).optional(),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        let url = `https://www.google.com/search?q=${encodeURIComponent(params.query)}&tbm=isch`;

        const sizeMap: Record<string, string> = { large: '&tbs=isz:l', medium: '&tbs=isz:m', icon: '&tbs=isz:i' };
        if (params.size && params.size !== 'any') url += sizeMap[params.size] || '';

        const colorMap: Record<string, string> = { red: '&tbs=ic:specific,isc:red', blue: '&tbs=ic:specific,isc:blue', green: '&tbs=ic:specific,isc:green', black: '&tbs=ic:specific,isc:black', white: '&tbs=ic:specific,isc:white', transparent: '&tbs=ic:trans' };
        if (params.color && colorMap[params.color]) url += colorMap[params.color];

        const typeMap: Record<string, string> = { photo: '&tbs=itp:photo', clipart: '&tbs=itp:clipart', lineart: '&tbs=itp:lineart', animated: '&tbs=itp:animated', vector: '&tbs=itp:vector' };
        if (params.type && typeMap[params.type]) url += typeMap[params.type];

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(2000);

        const scrolls = Math.ceil(params.limit / 20);
        for (let i = 0; i < scrolls; i++) {
          await page.evaluate(() => window.scrollBy(0, 800));
          await page.waitForTimeout(500);
        }

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            originalUrl: string; width: number; height: number; format: string;
          }> = [];

          const items = document.querySelectorAll('[data-src], .isv-r, div.ivg-i, .rg_i');

          if (items.length === 0) {
            const allImgs = document.querySelectorAll('img[src^="http"]');
            allImgs.forEach((img, idx) => {
              if (idx >= limit) return;
              const el = img as HTMLImageElement;
              if (el.width < 50 || el.height < 50) return;
              images.push({
                title: el.alt || '', thumbnailUrl: el.src, sourceUrl: '',
                originalUrl: el.src, width: el.naturalWidth || el.width,
                height: el.naturalHeight || el.height, format: 'jpg',
              });
            });
            return images.slice(0, limit);
          }

          items.forEach((item, idx) => {
            if (idx >= limit) return;
            const el = item as HTMLElement;
            const img = (el.tagName === 'IMG' ? el : el.querySelector('img')) as HTMLImageElement;
            if (!img) return;
            images.push({
              title: img.alt || '', thumbnailUrl: img.src || el.getAttribute('data-src') || '',
              sourceUrl: el.getAttribute('data-ref') || '',
              originalUrl: el.getAttribute('data-src') || img.src,
              width: parseInt(el.getAttribute('data-w') || '0', 10) || img.naturalWidth,
              height: parseInt(el.getAttribute('data-h') || '0', 10) || img.naturalHeight,
              format: 'jpg',
            });
          });
          return images.slice(0, limit);
        }, params.limit);

        return {
          data: {
            query: params.query, engine: 'google-images',
            results: results.map(r => ({ ...r, sourceSite: 'google', originalUrl: r.originalUrl || r.thumbnailUrl })),
            total: results.length, timestamp: Date.now(),
          },
          tips: [`Google Images "${params.query}"，共 ${results.length} 张`],
        };
      } catch (error) {
        return { data: null, message: error instanceof Error ? error.message : '未知错误' };
      }
    },
  });
}
