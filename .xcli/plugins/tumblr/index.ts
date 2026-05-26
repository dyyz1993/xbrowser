import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const tumblr = xcli.createSite({
    name: 'tumblr',
    url: 'https://www.tumblr.com',
    description: 'Tumblr 图片搜索',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  tumblr.command('search-image', {
    description: 'Tumblr 图片搜索 - 搜索 Tumblr 上的图片内容',
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
      const page = (params.page as import('playwright').Page)
        || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.tumblr.com/search/${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(6000);
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1200);
        }

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let imgs = document.querySelectorAll('img[src*="tumblr"], img[src*="media.tumblr"]');
          if (imgs.length === 0) {
            imgs = document.querySelectorAll('img');
          }
          imgs.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 30 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar')) return;
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

        return ok({
            query: params.query,
            engine: 'tumblr',
            results: results.map(r => ({ ...r, sourceSite: 'tumblr' })),
            total: results.length,
            timestamp: Date.now(),
          });
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
