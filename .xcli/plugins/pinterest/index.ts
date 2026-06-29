import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pinterest', url: 'https://www.pinterest.com',
    description: 'Pinterest - Image sharing platform', requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
        if (!body) return false;
        if ((body as string).includes('Log in')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  site.command('search-image', {
    description: 'Pinterest image search (requires login via --cdp)',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      query: z.string(), limit: z.number().optional().default(20),
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
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        await page.goto(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(params.query)}`, { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(3000);

        const antiBotResult = await ctx.detectAntiBot?.(page);
        if (antiBotResult?.detected) {
          return fail(`${antiBotResult.message}。请使用 --cdp http://localhost:9221 连接真实浏览器重试`);
        }

        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/signup')) {
          return fail('Pinterest 需要登录。请使用 --cdp http://localhost:9221 连接带登录态的浏览器');
        }

        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(1000);
        }

        const results = await page.evaluate((limit: number) => {
          const images: Record<string, unknown>[] = [];
          const items = document.querySelectorAll('[data-test-id="pin"], [data-test-pin-id], .GrowthUnauthPin_image');
          items.forEach((item, idx) => {
            if (idx >= limit) return;
            const el = item as HTMLElement;
            const img = el.querySelector('img') as HTMLImageElement;
            if (!img) return;
            const linkEl = el.querySelector('a[href*="/pin/"]') || el.closest('a');
            images.push({
              title: img.alt || '', thumbnailUrl: img.src,
              sourceUrl: (linkEl as HTMLAnchorElement | null)?.href || '', originalUrl: img.src,
              width: img.naturalWidth || 0, height: img.naturalHeight || 0,
              format: 'jpg', sourceSite: 'pinterest',
            });
          });
          return images.slice(0, limit);
        }, params.limit) as Array<Record<string, unknown>>;

        return ok({ query: params.query, engine: 'pinterest', results, total: results.length, timestamp: Date.now() }, [`Pinterest "${params.query}"，共 ${results.length} 张`]);
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
