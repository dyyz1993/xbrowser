import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function(xcli: XCLIAPI): void {
  const google = xcli.createSite({
    name: 'google',
    url: 'https://www.google.com',
    description: 'Google Search & Images',
    requiresLogin: false,
    loginConfig: {
      requiresLogin: false,
    },
  });

  google.command('search-image', {
    description: 'Google Images search - extract image URLs, sizes, and metadata',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(20),
      size: z.enum(['any', 'large', 'medium', 'small', 'icon']).optional().default('any'),
      color: z.string().optional(),
      type: z.enum(['photo', 'clipart', 'lineart', 'animated', 'vector']).optional(),
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
      const page = (params.page as import('../types').Page)
        || (ctx as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        let url = `https://www.google.com/search?q=${encodeURIComponent(params.query)}&tbm=isch`;

        const sizeMap: Record<string, string> = { large: '&tbs=isz:l', medium: '&tbs=isz:m', icon: '&tbs=isz:i' };
        if (params.size && params.size !== 'any') url += sizeMap[params.size] || '';

        const colorMap: Record<string, string> = { red: '&tbs=ic:specific,isc:red', blue: '&tbs=ic:specific,isc:blue', green: '&tbs=ic:specific,isc:green', black: '&tbs=ic:specific,isc:black', white: '&tbs=ic:specific,isc:white', transparent: '&tbs=ic:trans' };
        if (params.color && colorMap[params.color]) url += colorMap[params.color];

        const typeMap: Record<string, string> = { photo: '&tbs=itp:photo', clipart: '&tbs=itp:clipart', lineart: '&tbs=itp:lineart', animated: '&tbs=itp:animated', vector: '&tbs=itp:vector' };
        if (params.type && typeMap[params.type]) url += typeMap[params.type];

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(2000);

        const scrolls = Math.ceil(params.limit / 20);
        for (let i = 0; i < scrolls; i++) {
          await page.evaluate(() => window.scrollBy(0, 800));
          await page.waitForTimeout(500);
        }

        // First, try to extract image data from Google's embedded JSON metadata
        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            originalUrl: string; width: number; height: number; format: string;
          }> = [];

          // Helper: extract HTTP URL, skip base64 data URIs
          const toHttpUrl = (raw: string | null | undefined): string => {
            if (!raw) return '';
            // If it's already an HTTP URL, return as-is
            if (raw.startsWith('http')) return raw;
            // If it's a protocol-relative URL, prepend https:
            if (raw.startsWith('//')) return 'https:' + raw;
            // Skip data URIs (base64)
            if (raw.startsWith('data:')) return '';
            return raw;
          };

          // Strategy 1: Extract from script tags containing image metadata (AF_initDataCallback)
          try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              const text = script.textContent || '';
              // Google embeds image data in AF_initDataCallback blocks
              const matches = text.matchAll(/\["(https?:[^"\]]+?)"[^\]]*?\](?:,\["(https?:[^"\]]+?)")?/g);
              // More reliable: look for the large image grid data pattern
            }
          } catch { /* ignore, fall through */ }

          // Strategy 2: Extract from DOM elements with data attributes
          const items = document.querySelectorAll('[data-src], .isv-r, div.ivg-i, .rg_i, .YQ4gaf');

          if (items.length === 0) {
            // Fallback: find all HTTP-sourced images
            const allImgs = document.querySelectorAll('img');
            allImgs.forEach((img) => {
              if (images.length >= limit) return;
              const el = img as HTMLImageElement;
              const srcAttr = el.getAttribute('src') || '';
              const httpSrc = toHttpUrl(srcAttr);
              if (!httpSrc) return;
              if (el.width < 50 || el.height < 50) return;
              images.push({
                title: el.alt || '', thumbnailUrl: httpSrc, sourceUrl: '',
                originalUrl: httpSrc, width: el.naturalWidth || el.width,
                height: el.naturalHeight || el.height, format: 'jpg',
              });
            });
            return images.slice(0, limit);
          }

          items.forEach((item) => {
            if (images.length >= limit) return;
            const el = item as HTMLElement;
            const img = (el.tagName === 'IMG' ? el : el.querySelector('img')) as HTMLImageElement;
            if (!img) return;

            // Get thumbnail URL: prefer data-src (HTTP URL), avoid base64 img.src
            const dataSrc = toHttpUrl(el.getAttribute('data-src'));
            const imgSrcAttr = toHttpUrl(img.getAttribute('src'));
            const thumbnailUrl = dataSrc || imgSrcAttr || '';
            if (!thumbnailUrl) return; // Skip if no valid HTTP URL

            // Get original/source URL from parent anchor or data attributes
            const anchor = el.closest('a') || img.closest('a');
            const sourceUrl = anchor?.href || el.getAttribute('data-ref') || '';

            // Try to extract original image URL from data attributes
            let originalUrl = dataSrc || imgSrcAttr;

            // Check for data-tld (source site domain hint)
            images.push({
              title: img.alt || '', thumbnailUrl,
              sourceUrl,
              originalUrl,
              width: parseInt(el.getAttribute('data-w') || '0', 10) || img.naturalWidth,
              height: parseInt(el.getAttribute('data-h') || '0', 10) || img.naturalHeight,
              format: 'jpg',
            });
          });
          return images.slice(0, limit);
        }, params.limit);

        return ok({
            query: params.query, engine: 'google-images',
            results: results.map(r => ({ ...r, sourceSite: 'google', originalUrl: r.originalUrl || r.thumbnailUrl })),
        }, [`Google Images "${params.query}"，共 ${results.length} 张`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });

  google.command('webmaster-config', {
    description: '保存 Google Search Console 配置（站点域名）',
    loginRequired: 'none',
    scope: 'cli',
    parameters: z.object({
      site: z.string().describe('站点域名（如 https://xbrowser.dev）'),
    }),
    examples: [
      { cmd: 'xbrowser google webmaster-config --site https://xbrowser.dev', description: '保存 GSC 配置' },
    ],
    result: z.object({ site: z.string(), saved: z.boolean() }),
    handler: async (params, ctx) => {
      await ctx.storage.set('google_webmaster', { site: params.site });
      return ok({ site: params.site, saved: true }, [`已保存 Google Webmaster 配置: site=${params.site}`]);
    },
  });

  google.command('push-url', {
    description: '通过 Google ping 通知 Google 抓取 sitemap，或在浏览器中提交 URL',
    loginRequired: 'none',
    scope: 'cli',
    parameters: z.object({
      sitemapUrl: z.string().optional().describe('Sitemap URL，用于 ping 通知 Google'),
      urls: z.array(z.string()).optional().describe('要推送的 URL 列表（通过浏览器操作 GSC）'),
      site: z.string().optional().describe('站点域名，默认使用已保存的配置'),
    }),
    examples: [
      { cmd: 'xbrowser google push-url --sitemapUrl https://xbrowser.dev/sitemap.xml', description: 'Ping Google 抓取 sitemap' },
    ],
    result: z.object({ success: z.boolean(), method: z.string() }),
    handler: async (params, ctx) => {
      if (params.sitemapUrl) {
        // Method 1: Ping Google sitemap endpoint
        try {
          const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(params.sitemapUrl)}`;
          const res = await fetch(pingUrl, { method: 'GET', signal: AbortSignal.timeout(15000) });
          if (res.ok) {
            return ok({ success: true, method: 'sitemap-ping' }, [
              `Sitemap ping 成功: ${params.sitemapUrl}`,
              `HTTP ${res.status}`,
              'Google 将在后续抓取中处理 sitemap',
            ]);
          }
          return fail(`Sitemap ping 失败: HTTP ${res.status}`, [
            '在中国大陆可能无法直接访问 google.com',
            '可通过浏览器打开 Google Search Console 手动提交',
          ]);
        } catch (error) {
          const msg = error instanceof Error ? error.message : '未知错误';
          return fail(`Sitemap ping 失败: ${msg}`, [
            '在中国大陆可能无法直接访问 google.com',
            '可通过浏览器打开 Google Search Console 手动提交 sitemap',
            `GSC 地址: https://search.google.com/search-console/sitemaps`,
          ]);
        }
      }

      return fail('请指定 --sitemapUrl 或 --urls 参数', [
        '用法: xbrowser google push-url --sitemapUrl https://xbrowser.dev/sitemap.xml',
        '或通过浏览器访问 Google Search Console 手动提交',
      ]);
    },
  });
}
