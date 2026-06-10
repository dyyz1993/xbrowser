import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { fail } from '@dyyz1993/xcli-core';
import { detectAntiBot } from '../../../src/anti-bot-detection.js';
import { searchImageResultSchema, baseSearchParams, scrollPage, buildResult } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const shutterstock = xcli.createSite({
    name: 'shutterstock',
    url: 'https://www.shutterstock.com',
    description: 'Shutterstock - Stock Photos, Images & Vectors',
    requiresLogin: false,
  });

  shutterstock.command('search-image', {
    description: 'Shutterstock image search',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        const url = `https://www.shutterstock.com/search/${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(6000);

        const antiBotResult = await detectAntiBot(page);
        if (antiBotResult.detected) {
          return fail(`${antiBotResult.message}。请使用 --cdp http://localhost:9221 连接真实浏览器重试`);
        }

        await scrollPage(page, 6, 1500);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let items = document.querySelectorAll('img[src*="shutterstock"], .search-results-grid img, img[src*="shutter"]');
          if (items.length === 0) {
            items = document.querySelectorAll('img');
          }
          items.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 30 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar')) return;

            const container = el.closest('a, [data-testid], .search-results-grid-item');
            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: (container as HTMLAnchorElement)?.href || '',
              width: el.naturalWidth || el.width || 0,
              height: el.naturalHeight || el.height || 0,
            });
          });

          return images.slice(0, limit);
        }, params.limit) as Array<{ title: string; thumbnailUrl: string; sourceUrl: string; width: number; height: number }>;

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'shutterstock', results.map(r => ({ ...r, sourceSite: 'shutterstock' })));
      } catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('net::')) {
          return fail(`请求超时或网络错误: ${msg}。可尝试 --cdp http://localhost:9221 连接真实浏览器`);
        }
        return fail(`搜索失败: ${msg}。可尝试 --cdp http://localhost:9221 连接真实浏览器`);
      }
    },
  });
}
