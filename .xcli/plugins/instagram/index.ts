import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const instagram = xcli.createSite({
    name: 'instagram',
    url: 'https://www.instagram.com',
    description: 'Instagram 图片搜索',
    requiresLogin: true,
  });

  instagram.command('search-image', {
    description: 'Instagram 标签图片搜索 - 搜索 #tag 下的图片',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索标签（不含 #）'),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(params.query)}/`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);

        if (page.url().includes('/accounts/login/')) {
          return {
            data: null,
            message: 'Instagram 需要登录，请使用 --cdp 连接已登录的浏览器（CDP 9221）',
          };
        }

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          const selectors = 'img[src*="instagram"], article img';
          document.querySelectorAll(selectors).forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.naturalWidth < 100) return;
            images.push({
              title: el.alt || '',
              thumbnailUrl: el.src,
              sourceUrl: el.closest('a')?.getAttribute('href') || window.location.href,
              width: el.naturalWidth,
              height: el.naturalHeight,
            });
          });

          return images;
        }, params.limit);

        return {
          data: {
            query: params.query,
            engine: 'instagram',
            results: results.map(r => ({ ...r, sourceSite: 'instagram' })),
            total: results.length,
            timestamp: Date.now(),
          },
        };
      } catch (error) {
        return { data: null, message: error instanceof Error ? error.message : '未知错误' };
      }
    },
  });
}
