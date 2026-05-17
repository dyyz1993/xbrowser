import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createEphemeralContext, closeEphemeralContext, resolveLaunchOpts } from '../browser.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';

/** 统一图片结果格式 */
export interface ImageResult {
  title: string;
  thumbnailUrl: string;
  sourceUrl: string;
  originalUrl: string;
  width: number;
  height: number;
  fileSize?: string;
  format?: string;
  sourceSite: string;
}

export interface ImageSearchResult {
  query: string;
  engine: string;
  results: ImageResult[];
  total: number;
  timestamp: number;
}

/** 支持的搜索引擎映射 */
const IMAGE_ENGINES: Record<string, { plugin: string; command: string; url: string; needsCDP?: boolean }> = {
  // ── Headless 可用（免费，不需要登录） ──
  'bing-images': { plugin: 'bing', command: 'search-image', url: 'https://www.bing.com/images' },
  'unsplash': { plugin: 'unsplash', command: 'search-image', url: 'https://unsplash.com' },
  'pexels': { plugin: 'pexels', command: 'search-image', url: 'https://www.pexels.com' },
  'pixabay': { plugin: 'pixabay', command: 'search-image', url: 'https://pixabay.com' },
  // ── 需要 CDP（用户浏览器登录态）── 搜索引擎 ──
  'baidu-images': { plugin: 'baidu', command: 'search-image', url: 'https://image.baidu.com', needsCDP: true },
  'google-images': { plugin: 'google', command: 'search-image', url: 'https://images.google.com', needsCDP: true },
  // ── CDP: 专业图库 ──
  'flickr': { plugin: 'flickr', command: 'search-image', url: 'https://www.flickr.com', needsCDP: true },
  'deviantart': { plugin: 'deviantart', command: 'search-image', url: 'https://www.deviantart.com', needsCDP: true },
  '500px': { plugin: 'p500px', command: 'search-image', url: 'https://500px.com', needsCDP: true },
  'artstation': { plugin: 'artstation', command: 'search-image', url: 'https://www.artstation.com', needsCDP: true },
  'behance': { plugin: 'behance', command: 'search-image', url: 'https://www.behance.net', needsCDP: true },
  'dribbble': { plugin: 'dribbble', command: 'search-image', url: 'https://dribbble.com', needsCDP: true },
  'freepik': { plugin: 'freepik', command: 'search-image', url: 'https://www.freepik.com', needsCDP: true },
  'shutterstock': { plugin: 'shutterstock', command: 'search-image', url: 'https://www.shutterstock.com', needsCDP: true },
  'gettyimages': { plugin: 'gettyimages', command: 'search-image', url: 'https://www.gettyimages.com', needsCDP: true },
  // ── CDP: 中文素材站 ──
  'huaban': { plugin: 'huaban', command: 'search-image', url: 'https://huaban.com', needsCDP: true },
  'duitang': { plugin: 'duitang', command: 'search-image', url: 'https://www.duitang.com', needsCDP: true },
  '58pic': { plugin: '58pic', command: 'search-image', url: 'https://www.58pic.com', needsCDP: true },
  '699pic': { plugin: '699pic', command: 'search-image', url: 'https://www.699pic.com', needsCDP: true },
  'quanjing': { plugin: 'quanjing', command: 'search-image', url: 'https://www.quanjing.com', needsCDP: true },
  // ── CDP: 社交平台 ──
  'pinterest': { plugin: 'pinterest', command: 'search-image', url: 'https://www.pinterest.com', needsCDP: true },
  'instagram': { plugin: 'instagram', command: 'search-image', url: 'https://www.instagram.com', needsCDP: true },
  'weibo': { plugin: 'weibo', command: 'search-image', url: 'https://weibo.com', needsCDP: true },
  'xiaohongshu': { plugin: 'xiaohongshu', command: 'search-image', url: 'https://www.xiaohongshu.com', needsCDP: true },
  'twitter': { plugin: 'twitter', command: 'search-image', url: 'https://x.com', needsCDP: true },
  'reddit': { plugin: 'reddit', command: 'search-image', url: 'https://www.reddit.com', needsCDP: true },
  'imgur': { plugin: 'imgur', command: 'search-image', url: 'https://imgur.com', needsCDP: true },
  'tumblr': { plugin: 'tumblr', command: 'search-image', url: 'https://www.tumblr.com', needsCDP: true },
  'facebook': { plugin: 'facebook', command: 'search-image', url: 'https://www.facebook.com', needsCDP: true },
  '9gag': { plugin: '9gag', command: 'search-image', url: 'https://9gag.com', needsCDP: true },
  // ── CDP: 电商 ──
  'taobao': { plugin: 'taobao', command: 'search-image', url: 'https://www.taobao.com', needsCDP: true },
  'jd': { plugin: 'jd', command: 'search-image', url: 'https://www.jd.com', needsCDP: true },
};

/** 不指定引擎时，headless 默认引擎（按优先级排序） */
const DEFAULT_HEADLESS_ENGINES = ['bing-images', 'unsplash', 'pexels'];

/** 不指定引擎时，CDP 模式默认引擎 */
const DEFAULT_CDP_ENGINES = ['baidu-images', 'bing-images', 'unsplash', 'pexels', 'flickr', 'xiaohongshu', 'weibo'];

/** 并行下载图片 */
async function downloadImages(
  images: ImageResult[],
  downloadDir: string,
  concurrency: number,
): Promise<{ downloaded: number; failed: number; files: string[] }> {
  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(downloadDir, { recursive: true });

  const files: string[] = [];
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (img, batchIdx) => {
        const urlToDownload = img.originalUrl || img.thumbnailUrl;
        if (!urlToDownload) throw new Error('No URL to download');

        const ext = img.format || urlToDownload.split('.').pop()?.split('?')[0] || 'jpg';
        const safeName = img.title
          .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
          .slice(0, 40);
        const filename = `${String(i + batchIdx + 1).padStart(3, '0')}_${img.sourceSite}_${safeName}.${ext}`;
        const filepath = path.join(downloadDir, filename);

        const resp = await fetch(urlToDownload, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': img.sourceUrl || img.thumbnailUrl,
          },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const arrayBuf = await resp.arrayBuffer();
        await fs.writeFile(filepath, Buffer.from(arrayBuf));
        return filepath;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        files.push(r.value);
        downloaded++;
      } else {
        failed++;
      }
    }
  }

  return { downloaded, failed, files };
}

export const imageCommand = registerCommand({
  name: 'image',
  description: 'Search images across multiple sites with unified result format',
  scope: 'project' as const,
  parameters: z.object({
    query: z.string().describe('Search query'),
    engine: z.string().optional().describe('Specific engine: baidu-images, google-images, bing-images, unsplash, pexels, pixabay, huaban, pinterest'),
    limit: z.number().default(10).describe('Max results (default 10)'),
    size: z.enum(['any', 'large', 'medium', 'small', 'icon']).optional().default('any').describe('Image size filter'),
    color: z.string().optional().describe('Color filter'),
    type: z.enum(['photo', 'clipart', 'lineart', 'animated', 'vector']).optional().describe('Image type filter'),
    download: z.boolean().default(false).describe('Download images to local directory'),
    downloadDir: z.string().optional().default('./images').describe('Download directory'),
    concurrency: z.number().default(5).describe('Parallel download concurrency'),
    format: z.enum(['json', 'markdown', 'text']).default('json'),
    timeout: z.number().default(20000),
  }),
  handler: async (params, ctx: BrowserCommandContext) => {
    const loader = await getPluginLoader();
    const internalLoader = loader.getCore().loader;

    const isCDP = !!ctx.cdpEndpoint;
    const { context } = await createEphemeralContext(resolveLaunchOpts(ctx));

    try {
      const errors: Array<{ engine: string; error: string }> = [];
      const allResults: ImageSearchResult[] = [];

      // 智能选择引擎：
      // - 用户指定 engine → 只用指定的
      // - 用户没指定 → headless 走免费引擎，CDP 走更多引擎
      let enginesToUse: string[];
      if (params.engine) {
        enginesToUse = [params.engine];
      } else if (isCDP) {
        enginesToUse = DEFAULT_CDP_ENGINES;
      } else {
        enginesToUse = DEFAULT_HEADLESS_ENGINES;
      }

      // 并行搜索各站点
      const settled = await Promise.allSettled(
        enginesToUse.map(async (engineKey, idx) => {
          // 错开启动避免 CDP contention
          if (idx > 0) await new Promise(r => setTimeout(r, 300 * idx));

          const engineConfig = IMAGE_ENGINES[engineKey];
          if (!engineConfig) {
            throw new Error(`Unknown engine: ${engineKey}. Available: ${Object.keys(IMAGE_ENGINES).join(', ')}`);
          }

          const site = internalLoader.getSite(engineConfig.plugin);
          if (!site) {
            throw new Error(`Plugin "${engineConfig.plugin}" not loaded. Install it first: xbrowser plugin install ${engineConfig.plugin}`);
          }

          const cmd = site.getCommand(engineConfig.command);
          if (!cmd) {
            throw new Error(`Command "${engineConfig.command}" not found in plugin "${engineConfig.plugin}"`);
          }

          // 创建新 page 进行搜索
          const page = await context.newPage();
          try {
            // 插件 handler 期望 CommandContext，我们提供最小实现
            const pluginCtx = {
              ...ctx,
              page,
              args: [],
              options: {},
              cwd: process.cwd(),
              storage: {
                get: async () => null,
                set: async () => {},
                delete: async () => {},
                clear: async () => {},
                keys: async () => [],
              },
              output: { mode: 'json' as const, showTips: false, color: false, emoji: false },
            };

            const result = await cmd.handler(
              {
                query: params.query,
                limit: params.limit,
                size: params.size,
                color: params.color,
                type: params.type,
                page,
                timeout: params.timeout,
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pluginCtx as any
            ) as { data: ImageSearchResult; tips?: string[] };

            if (result?.data) {
              return result.data;
            }
            throw new Error('Plugin returned no data');
          } finally {
            await page.close().catch(() => {});
          }
        })
      );

      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === 'fulfilled') {
          allResults.push(r.value);
        } else {
          errors.push({
            engine: enginesToUse[i],
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      }

      // 合并去重
      const merged: ImageResult[] = [];
      const seen = new Set<string>();
      for (const sr of allResults) {
        for (const img of sr.results) {
          const key = img.originalUrl || img.thumbnailUrl;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(img);
          }
        }
      }

      const finalResults = merged.slice(0, params.limit * enginesToUse.length);

      // 下载
      let downloadInfo: { downloaded: number; failed: number; files: string[] } | undefined;
      if (params.download && finalResults.length > 0) {
        downloadInfo = await downloadImages(finalResults, params.downloadDir!, params.concurrency);
      }

      const result = {
        query: params.query,
        engines: allResults.map(r => r.engine),
        results: finalResults,
        total: finalResults.length,
        download: downloadInfo,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: Date.now(),
      };

      // format controls output shape: json → structured data, markdown → image grid, text → plain list
      if (params.format === 'markdown') {
        const lines = [`## Image Search: ${params.query}`, `_Engines: ${result.engines.join(', ')} | Total: ${result.total}_`, ''];
        for (const img of result.results) {
          lines.push(`### [${img.title}](${img.sourceUrl})`);
          lines.push(`![${img.title}](${img.thumbnailUrl})`);
          lines.push(`- Size: ${img.width}x${img.height}${img.fileSize ? ` | File: ${img.fileSize}` : ''}`);
          lines.push(`- Source: ${img.sourceSite} | [Original](${img.originalUrl})`);
          lines.push('');
        }
        if (result.download) {
          lines.push(`---\n_Downloaded: ${result.download.downloaded} | Failed: ${result.download.failed}_`);
        }
        return ok({ ...result, content: lines.join('\n') });
      }

      if (params.format === 'text') {
        const lines = [`Image Search: ${params.query} (${result.engines.join(', ')}, Total: ${result.total})`, ''];
        for (const img of result.results) {
          lines.push(`${img.title}`);
          lines.push(`  Thumbnail: ${img.thumbnailUrl}`);
          lines.push(`  Original:  ${img.originalUrl}`);
          lines.push(`  Size: ${img.width}x${img.height} | Source: ${img.sourceSite}`);
          lines.push('');
        }
        return ok({ ...result, content: lines.join('\n') });
      }

      return ok(result);
    } finally {
      await closeEphemeralContext(context);
    }
  },
});

export { IMAGE_ENGINES };
