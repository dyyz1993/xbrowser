import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const instagram = xcli.createSite({
    name: 'instagram',
    url: 'https://www.instagram.com',
    description: 'Instagram 图片搜索',
    requiresLogin: true,
    loginConfig: {
      loginUrls: ['/login', '/signin', '/auth'],
      loginSelectors: ['[class*="login"]', '[class*="signin"]'],
      captchaSelectors: ['[class*="captcha"]', '[class*="verify"]'],
      loginKeywords: ['Sign in', 'Log in'],
      loggedInSelectors: ['[class*="avatar"]', '[data-testid*="avatar"]'],
      loginPrompt: 'This site requires login. Use --cdp to connect a logged-in browser.',
    },
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
        return true;
      } catch {
        return true;
      }
    },
  });

  instagram.command('search-image', {
    description: 'Instagram 标签图片搜索 - 搜索 #tag 下的图片',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索标签（不含 #）'),
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
        const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(params.query)}/`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);

        if (page.url().includes('/accounts/login/')) {
          return fail('Instagram 需要登录，请使用 --cdp 连接已登录的浏览器（CDP 9221）');
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

        return ok({
            query: params.query,
            engine: 'instagram',
            results: results.map(r => ({ ...r, sourceSite: 'instagram' })),
            total: results.length,
            timestamp: Date.now(),
          });
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
