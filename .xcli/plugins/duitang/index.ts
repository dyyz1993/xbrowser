import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const duitang = xcli.createSite({
    name: 'duitang',
    url: 'https://www.duitang.com',
    description: '堆糖 - 美好生活研究所',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  duitang.command('search-image', {
    description: '堆糖图片搜索',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
      timeout: z.number().optional().default(20000),
    }),
    result: z.object({
      query: z.string(),
      engine: z.string(),
      results: z.array(z.object({
        title: z.string(),
        thumbnailUrl: z.string(),
        sourceUrl: z.string(),
        originalUrl: z.string().optional(),
        width: z.number(),
        height: z.number(),
        format: z.string().optional(),
        sourceSite: z.string(),
        fileSize: z.string().optional(),
      }).passthrough()),
      total: z.number().optional(),
      timestamp: z.union([z.string(), z.number()]).optional(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = (params.page as import('../types').Page)
        || (ctx as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.duitang.com/search/?kw=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout }).catch(() => {});
        await page.waitForTimeout(5000);

        try {
          const currentUrl = page.url();
          if (!currentUrl.includes('duitang.com')) {
            return fail('堆糖页面被重定向，请检查网络或使用 --cdp 连接已登录浏览器', ['建议使用 CDP 9221 连接浏览器']);
          }
        } catch { /* page may have closed */ }

        for (let i = 0; i < 3; i++) {
          try {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForTimeout(1000);
          } catch { break; }
        }

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

        return ok({
            query: params.query,
            engine: 'duitang',
            results: results.map(r => ({ ...r, sourceSite: 'duitang' })),
            }, [`堆糖 "${params.query}"，共 ${results.length} 张`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
