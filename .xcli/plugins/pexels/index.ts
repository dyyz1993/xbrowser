import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';

export default function(xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pexels', url: 'https://www.pexels.com',
    description: 'Pexels - Free stock photos and videos', requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  site.command('search-image', {
    description: 'Search Pexels photos with metadata',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      query: z.string(), limit: z.number().optional().default(20),
      color: z.string().optional(), timeout: z.number().optional().default(20000),
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
      const page = (params.page as import('../types').Page) || (ctx as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        let url = `https://www.pexels.com/search/${encodeURIComponent(params.query)}/`;
        if (params.color) url += `?color=${params.color}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        for (let i = 0; i < Math.ceil(params.limit / 10); i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(800);
        }
        const results = await page.evaluate((limit: number) => {
          const images: Record<string, unknown>[] = [];
          // Pexels 的图片在 article 或 .MediaCard 中，排除导航/header 中的小图标
          const containers = document.querySelectorAll('article, .MediaCard, [data-testid="photo-card"], .photos__photo-item');
          containers.forEach((container) => {
            if (images.length >= limit) return;
            const imgs = container.querySelectorAll('img');
            imgs.forEach((img) => {
              if (images.length >= limit) return;
              const el = img;
              const src = el.src || '';
              // 只保留 Pexels CDN 图片，排除 flag/svg/avatar
              if (!src.includes('images.pexels.com') && !src.includes('static.pexels.com')) return;
              if (src.includes('/flags/') || src.includes('/user/') || src.includes('avatar')) return;
              if (el.width < 100 || el.height < 100) return;

              const srcset = el.getAttribute('srcset') || '';
              let originalUrl = el.getAttribute('data-big-src') || '';
              if (!originalUrl && srcset) {
                const entries = srcset.split(',').map((s) => s.trim().split(' '));
                const largest = entries.sort((a, b) => (parseInt(b[1] || '0', 10) || 0) - (parseInt(a[1] || '0', 10) || 0))[0];
                originalUrl = largest?.[0] || src;
              }
              if (!originalUrl) originalUrl = src;
              // 获取高清大图：Pexels CDN URL 追加高清参数
              const cleanUrl = originalUrl.split('?')[0];
              originalUrl = cleanUrl + '?auto=compress&cs=tinysrgb&dpr=2&w=2400';
              const midUrl = cleanUrl + '?auto=compress&cs=tinysrgb&dpr=2&w=800';
              images.push({
                title: el.alt || '', thumbnailUrl: midUrl,
                sourceUrl: el.closest('a')?.href || '', originalUrl,
                width: el.naturalWidth || 0, height: el.naturalHeight || 0,
                format: 'jpg', sourceSite: 'pexels',
              });
            });
          });

          // Fallback: 如果容器选择器没找到，直接找所有 pexels CDN 图片
          if (images.length === 0) {
            document.querySelectorAll('img').forEach((img) => {
              if (images.length >= limit) return;
              const el = img;
              const src = el.src || '';
              if (!src.includes('images.pexels.com')) return;
              if (src.includes('/flags/') || src.includes('/user/')) return;
              if (el.width < 100) return;
              const cleanFallbackUrl = src.split('?')[0];
              images.push({
                title: el.alt || '', thumbnailUrl: cleanFallbackUrl + '?auto=compress&cs=tinysrgb&dpr=2&w=800',
                sourceUrl: el.closest('a')?.href || '',
                originalUrl: cleanFallbackUrl + '?auto=compress&cs=tinysrgb&dpr=2&w=2400',
                width: el.naturalWidth || 0, height: el.naturalHeight || 0,
                format: 'jpg', sourceSite: 'pexels',
              });
            });
          }
          return images.slice(0, limit);
        }, params.limit);
        return ok({ query: params.query, engine: 'pexels', results, total: results.length, timestamp: Date.now() }, [`Pexels "${params.query}"，共 ${results.length} 张`]);
      } catch { return { data: null, message: error instanceof Error ? error.message : '未知错误' }; }
    },
  });
}
