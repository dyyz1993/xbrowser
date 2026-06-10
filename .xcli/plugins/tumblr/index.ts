import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { fail } from '@dyyz1993/xcli-core';
import { detectAntiBot } from '../../../src/anti-bot-detection.js';
import { searchImageResultSchema, baseSearchParams, getPage, scrollPage, buildResult } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const tumblr = xcli.createSite({
    name: 'tumblr',
    url: 'https://www.tumblr.com',
    description: 'Tumblr 图片搜索',
    requiresLogin: false,
  });

  tumblr.command('search-image', {
    description: 'Tumblr 图片搜索 - 搜索 Tumblr 上的图片内容',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = getPage(params as Record<string, unknown>, ctx);
      try {
        const url = `https://www.tumblr.com/search/${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(6000);

        const antiBotResult = await detectAntiBot(page);
        if (antiBotResult.detected) {
          return fail(`${antiBotResult.message}。请使用 --cdp http://localhost:9221 连接真实浏览器重试`) as unknown as z.infer<typeof searchImageResultSchema>;
        }

        await scrollPage(page, 5, 1200);

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

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'tumblr', results.map(r => ({ ...r, sourceSite: 'tumblr' }))) as unknown as z.infer<typeof searchImageResultSchema>;
      } catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('net::')) {
          return fail(`请求超时或网络错误: ${msg}。可尝试 --cdp http://localhost:9221 连接真实浏览器`) as unknown as z.infer<typeof searchImageResultSchema>;
        }
        return fail(`搜索失败: ${msg}。可尝试 --cdp http://localhost:9221 连接真实浏览器`) as unknown as z.infer<typeof searchImageResultSchema>;
      }
    },
  });
}
