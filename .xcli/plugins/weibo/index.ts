import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, getPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const weibo = xcli.createSite({
    name: 'weibo',
    url: 'https://s.weibo.com',
    description: '微博图片搜索',
    requiresLogin: true,
    loginConfig: {
      requiresLogin: true,
      loginKeywords: ['登录', 'login', 'sign in'],
      loginSelectors: ['a[href*="login"]', 'a[href*="passport"]', 'a[href*="signin"]', '.W_login_form'],
      loggedInSelectors: ['[class*="avatar"]', '[class*="W_face"]', '[class*="user"]'],
      loginUrls: ['/login', '/passport'],
    },
  });

  weibo.command('search-image', {
    description: '微博图片搜索 - 搜索微博中的图片内容',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx as Record<string, unknown>);
      try {
        const url = `https://s.weibo.com/weibo?q=${encodeURIComponent(params.query)}&type=image`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          document.querySelectorAll('img[src*="sinaimg"]').forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.naturalWidth < 80) return;
            images.push({
              title: el.alt || '',
              thumbnailUrl: el.src,
              sourceUrl: el.closest('a')?.getAttribute('href') || '',
              width: el.naturalWidth,
              height: el.naturalHeight,
            });
          });

          return images;
        }, params.limit);

        return buildResult(params.query, 'weibo', results.map(r => ({ ...r, sourceSite: 'weibo' })));
      } catch (error) {
        return buildFail(error, 'weibo');
      }
    },
  });
}
