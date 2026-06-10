import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const bing = xcli.createSite({
    name: 'bing',
    url: 'https://www.bing.com',
    description: 'Bing Search & Images',
    requiresLogin: false,
  });

  bing.command('search-image', {
    description: 'Bing Images search - extract image URLs, sizes, and metadata',
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
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        let url = `https://www.bing.com/images/search?q=${encodeURIComponent(params.query)}&first=1`;

        const sizeMap: Record<string, string> = {
          small: '&qft=+filterui:imagesize-small',
          medium: '&qft=+filterui:imagesize-medium',
          large: '&qft=+filterui:imagesize-large',
          icon: '&qft=+filterui:imagesize-square',
        };
        if (params.size && params.size !== 'any') url += sizeMap[params.size] || '';

        const typeMap: Record<string, string> = {
          photo: '&qft=+filterui:photo-photo',
          clipart: '&qft=+filterui:photo-clipart',
          lineart: '&qft=+filterui:photo-linedrawing',
          animated: '&qft=+filterui:photo-animatedgif',
          vector: '&qft=+filterui:photo-clipart',
        };
        if (params.type) url += typeMap[params.type] || '';

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(2000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            originalUrl: string; width: number; height: number;
            format: string; fileSize: string;
          }> = [];

          const items = document.querySelectorAll('.iusc, .imgpt, .dgControl_list li');
          items.forEach((item, idx) => {
            if (idx >= limit) return;
            const el = item as HTMLElement;

            // Bing stores metadata in m attribute (JSON)
            const mAttr = el.getAttribute('m');
            if (mAttr) {
              try {
                const data = JSON.parse(mAttr);
                images.push({
                  title: data.t || '', thumbnailUrl: data.turl || '',
                  sourceUrl: data.purl || '', originalUrl: data.murl || data.turl || '',
                  width: data.w || 0, height: data.h || 0,
                  format: (data.murl || '').split('.').pop()?.split('?')[0] || 'jpg',
                  fileSize: data.s || '',
                });
                return;
              } catch { /* fallback */ }
            }

            const img = el.querySelector('img') as HTMLImageElement;
            if (!img) return;
            images.push({
              title: img.alt || '', thumbnailUrl: img.src,
              sourceUrl: el.querySelector('a')?.getAttribute('href') || '',
              originalUrl: img.src, width: img.naturalWidth || 0,
              height: img.naturalHeight || 0, format: 'jpg', fileSize: '',
            });
          });

          return images.slice(0, limit);
        }, params.limit);

        return ok({
            query: params.query, engine: 'bing-images',
            results: results.map(r => ({ ...r, sourceSite: 'bing', originalUrl: r.originalUrl || r.thumbnailUrl })),
        }, [`Bing Images "${params.query}"，共 ${results.length} 张`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });

  bing.command('webmaster-config', {
    description: '保存 Bing Webmaster/IndexNow API 配置',
    loginRequired: 'none',
    scope: 'cli',
    parameters: z.object({
      host: z.string().describe('站点域名（如 xbrowser.dev）'),
      key: z.string().describe('IndexNow API key'),
    }),
    examples: [
      { cmd: 'xbrowser bing webmaster-config --host xbrowser.dev --key mykey123', description: '保存 IndexNow 配置' },
    ],
    result: z.object({ host: z.string(), saved: z.boolean() }),
    handler: async (params, ctx) => {
      await ctx.storage.set('bing_webmaster', { host: params.host, key: params.key });
      return ok({ host: params.host, saved: true }, [`已保存 IndexNow 配置: host=${params.host}`]);
    },
  });

  bing.command('push-url', {
    description: '通过 Bing IndexNow API 即时推送 URL（即时索引协议）',
    loginRequired: 'none',
    scope: 'cli',
    parameters: z.object({
      urls: z.array(z.string()).describe('要推送的 URL 列表'),
      host: z.string().optional().describe('站点域名，默认使用已保存的配置'),
      key: z.string().optional().describe('IndexNow API key，默认使用已保存的配置'),
    }),
    examples: [
      { cmd: 'xbrowser bing push-url --urls \'["https://xbrowser.dev/"]\'', description: '推送 URL 到 Bing' },
    ],
    result: z.object({ success: z.boolean(), urlCount: z.number() }),
    handler: async (params, ctx) => {
      const saved = (await ctx.storage.get('bing_webmaster')) as { host?: string; key?: string } | null;
      const host = params.host || saved?.host;
      const key = params.key || saved?.key;

      if (!host || !key) {
        return fail('缺少 host 或 key，请先运行 webmaster-config 或通过参数传入', [
          '用法: xbrowser bing webmaster-config --host xbrowser.dev --key YOUR_KEY',
        ]);
      }

      try {
        const apiUrl = 'https://api.indexnow.org/indexnow';
        const body = JSON.stringify({
          host,
          key,
          keyLocation: `https://${host}/${key}.txt`,
          urlList: params.urls,
        });

        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        // IndexNow: 200 = OK, 202 = accepted for processing
        if (res.status === 200 || res.status === 202) {
          return ok({ success: true, urlCount: params.urls.length }, [
            `成功推送 ${params.urls.length} 条 URL 到 Bing IndexNow`,
            `HTTP ${res.status}${res.status === 202 ? '（已接受，处理中）' : ''}`,
          ]);
        }

        const text = await res.text().catch(() => '');
        return fail(`IndexNow 推送失败: HTTP ${res.status} ${text}`, [
          '确保 key 文件已部署到 https://' + host + '/' + key + '.txt',
        ]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '推送请求失败');
      }
    },
  });
}
