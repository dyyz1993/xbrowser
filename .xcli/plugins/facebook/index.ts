import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const facebook = xcli.createSite({
    name: 'facebook',
    url: 'https://www.facebook.com',
    description: 'Facebook 图片搜索',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login/')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body) return false;
        if (body.includes('Log in')) return false;
        const hasLoginBtn = await page.locator('button:has-text("Log in"), a:has-text("Log in")').first().isVisible().catch(() => false);
        if (hasLoginBtn) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  facebook.command('search-image', {
    description: 'Facebook 图片搜索 - 搜索 Facebook 中的公开图片',
    loginRequired: 'none',
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
      const page = (ctx as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.facebook.com/search/posts?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(5000);

        if (page.url().includes('/login/')) {
          return fail('Facebook 需要登录，请使用 --cdp 连接已登录的浏览器（CDP 9221）');
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

        return ok({
            query: params.query,
            engine: 'facebook',
            results: results.map(r => ({ ...r, sourceSite: 'facebook' })),
            total: results.length,
            timestamp: Date.now(),
          });
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
