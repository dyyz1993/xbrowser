import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { fail } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, scrollPage, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'huaban', url: 'https://huaban.com',
    description: '花瓣网 - 设计灵感采集', requiresLogin: false,
  });

  site.command('search-image', {
    description: '花瓣网图片搜索',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        await page.goto(`https://huaban.com/search?q=${encodeURIComponent(params.query)}`, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(5000);

        const pageContent = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '') as string;
        if (pageContent.includes('安全验证') || pageContent.includes('请输入验证码') || pageContent.includes('验证')) {
          return fail('花瓣网触发了安全验证，请在浏览器中手动完成验证后重试', ['建议：使用 --cdp 9221 连接已登录的浏览器，手动访问 huaban.com 完成验证后再执行搜索']);
        }

        await scrollPage(page, 3, 1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<Record<string, unknown>> = [];
          let items = document.querySelectorAll('img[data-src]');
          if (items.length === 0) {
            items = document.querySelectorAll('img');
          }
          items.forEach((item) => {
            if (images.length >= limit) return;
            const img = item as HTMLImageElement;
            const src = img.getAttribute('data-src') || img.src || '';
            if (!src || img.width < 50) return;
            const thumbnailUrl = src.startsWith('//') ? 'https:' + src : src;
            if (!thumbnailUrl.startsWith('http')) return;
            if (thumbnailUrl.includes('logo') || thumbnailUrl.includes('icon') || thumbnailUrl.includes('avatar')) return;
            const originalUrl = thumbnailUrl.replace(/_fw\d+/, '_fw1200');
            const parentA = img.closest('a');
            images.push({
              title: img.alt || parentA?.getAttribute('title') || '',
              thumbnailUrl, sourceUrl: parentA?.href || '', originalUrl,
              width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0, format: 'jpg', sourceSite: 'huaban',
            });
          });
          return images.slice(0, limit);
        }, params.limit) as Array<Record<string, unknown>>;

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'huaban', results);
      } catch (error) {
        return buildFail(error, 'huaban');
      }
    },
  });
}
