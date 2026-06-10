import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { fail } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const duitang = xcli.createSite({
    name: 'duitang',
    url: 'https://www.duitang.com',
    description: '堆糖 - 美好生活研究所',
    requiresLogin: false,
  });

  duitang.command('search-image', {
    description: '堆糖图片搜索',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx);
      try {
        const url = `https://www.duitang.com/search/?kw=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout }).catch(() => {});
        await page.waitForTimeout(5000);

        try {
          const currentUrl = page.url();
          if (!currentUrl.includes('duitang.com')) {
            return fail('堆糖页面被重定向，请检查网络或使用 --cdp 连接已登录浏览器', ['建议使用 CDP 9221 连接浏览器']) as unknown as z.infer<typeof searchImageResultSchema>;
          }
        } catch { /* page may have closed */ }

        await scrollPage(page, 3, 1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let items = document.querySelectorAll('img[data-src], .mbph img');
          if (items.length === 0) {
            items = document.querySelectorAll('img');
          }
          items.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const rawSrc = el.getAttribute('data-src') || el.src || '';
            const thumbnailUrl = rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc;
            if (!thumbnailUrl.startsWith('http')) return;
            if (el.width < 50) return;
            if (thumbnailUrl.includes('logo') || thumbnailUrl.includes('icon') || thumbnailUrl.includes('avatar')) return;

            const container = el.closest('a, .mbph, .woo');
            images.push({
              title: el.alt || '',
              thumbnailUrl,
              sourceUrl: (container as HTMLAnchorElement)?.href || '',
              width: el.naturalWidth || el.width || 0,
              height: el.naturalHeight || el.height || 0,
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'duitang', results.map(r => ({ ...r, sourceSite: 'duitang' }))) as unknown as z.infer<typeof searchImageResultSchema>;
      } catch (error) {
        return buildFail(error, 'duitang') as unknown as z.infer<typeof searchImageResultSchema>;
      }
    },
  });
}
