import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pinterest', url: 'https://www.pinterest.com',
    description: 'Pinterest - Image sharing platform', requiresLogin: true,
  });

  site.command('search-image', {
    description: 'Pinterest image search (requires login via --cdp)',
    scope: 'browser',
    parameters: z.object({
      query: z.string(), limit: z.number().optional().default(20),
      page: z.any().optional(), timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page) || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        await page.goto(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(params.query)}`, { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/signup')) {
          return fail('Pinterest 需要登录。请使用 --cdp http://localhost:9221 连接带登录态的浏览器');
        }

        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(1000);
        }

        const results = await page.evaluate((limit: number) => {
          const images: any[] = [];
          const items = document.querySelectorAll('[data-test-id="pin"], [data-test-pin-id], .GrowthUnauthPin_image');
          items.forEach((item, idx) => {
            if (idx >= limit) return;
            const el = item as HTMLElement;
            const img = el.querySelector('img') as HTMLImageElement;
            if (!img) return;
            const linkEl = el.querySelector('a[href*="/pin/"]') || el.closest('a');
            images.push({
              title: img.alt || '', thumbnailUrl: img.src,
              sourceUrl: linkEl?.href || '', originalUrl: img.src,
              width: img.naturalWidth || 0, height: img.naturalHeight || 0,
              format: 'jpg', sourceSite: 'pinterest',
            });
          });
          return images.slice(0, limit);
        }, params.limit);

        return ok({ query: params.query, engine: 'pinterest', results, total: results.length, timestamp: Date.now() }, [`Pinterest "${params.query}"，共 ${results.length} 张`]);
      } catch (error) { return fail(error instanceof Error ? error.message : '未知错误'); }
    },
  });
}
