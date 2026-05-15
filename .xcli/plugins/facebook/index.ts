import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const facebook = xcli.createSite({
    name: 'facebook',
    url: 'https://www.facebook.com',
    description: 'Facebook 图片搜索',
    requiresLogin: true,
  });

  facebook.command('search-image', {
    description: 'Facebook 图片搜索 - 搜索 Facebook 中的公开图片',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.facebook.com/search/posts?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(5000);

        if (page.url().includes('/login/')) {
          return {
            data: null,
            message: 'Facebook 需要登录，请使用 --cdp 连接已登录的浏览器（CDP 9221）',
          };
        }

        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1000);
        }

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let imgs = document.querySelectorAll('img[src*="fbcdn"], img[src*="facebook"]');
          if (imgs.length === 0) {
            imgs = document.querySelectorAll('img');
          }
          imgs.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 50 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar') || src.includes('emoji')) return;
            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: el.closest('a')?.getAttribute('href') || '',
              width: el.naturalWidth || el.width,
              height: el.naturalHeight || el.height,
            });
          });

          return images;
        }, params.limit);

        return {
          data: {
            query: params.query,
            engine: 'facebook',
            results: results.map(r => ({ ...r, sourceSite: 'facebook' })),
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
