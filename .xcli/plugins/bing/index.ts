import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const bing = xcli.createSite({
    name: 'bing',
    url: 'https://www.bing.com',
    description: 'Bing Search & Images',
    requiresLogin: false,
  });

  bing.command('search-image', {
    description: 'Bing Images search - extract image URLs, sizes, and metadata',
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
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        let url = `https://www.bing.com/images/search?q=${encodeURIComponent(params.query)}&first=1`;

        const sizeMap: Record<string, string> = {
          small: '&qft=+filterui:imagesize-small',
          medium: '&qft=+filterui:imagesize-medium',
          large: '&qft=+filterui:imagesize-large',
          icon: '&qft=+filterui:imagesize-square',
        };
        if (params.size && params.size !== 'any') url += sizeMap[params.size] || '';

        const typeMap: Record<string, string> = {
          photo: '&qft=+filterui:photo-photo',
          clipart: '&qft=+filterui:photo-clipart',
          lineart: '&qft=+filterui:photo-linedrawing',
          animated: '&qft=+filterui:photo-animatedgif',
          vector: '&qft=+filterui:photo-clipart',
        };
        if (params.type) url += typeMap[params.type] || '';

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(2000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            originalUrl: string; width: number; height: number;
            format: string; fileSize: string;
          }> = [];

          const items = document.querySelectorAll('.iusc, .imgpt, .dgControl_list li');
          items.forEach((item, idx) => {
            if (idx >= limit) return;
            const el = item as HTMLElement;

            // Bing stores metadata in m attribute (JSON)
            const mAttr = el.getAttribute('m');
            if (mAttr) {
              try {
                const data = JSON.parse(mAttr);
                images.push({
                  title: data.t || '', thumbnailUrl: data.turl || '',
                  sourceUrl: data.purl || '', originalUrl: data.murl || data.turl || '',
                  width: data.w || 0, height: data.h || 0,
                  format: (data.murl || '').split('.').pop()?.split('?')[0] || 'jpg',
                  fileSize: data.s || '',
                });
                return;
              } catch { /* fallback */ }
            }

            const img = el.querySelector('img') as HTMLImageElement;
            if (!img) return;
            images.push({
              title: img.alt || '', thumbnailUrl: img.src,
              sourceUrl: el.querySelector('a')?.getAttribute('href') || '',
              originalUrl: img.src, width: img.naturalWidth || 0,
              height: img.naturalHeight || 0, format: 'jpg', fileSize: '',
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return ok({
            query: params.query, engine: 'bing-images',
            results: results.map(r => ({ ...r, sourceSite: 'bing', originalUrl: r.originalUrl || r.thumbnailUrl })),
        }, [`Bing Images "${params.query}"，共 ${results.length} 张`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
