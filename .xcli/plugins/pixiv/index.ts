import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pixiv',
    url: 'https://www.pixiv.net',
    description: 'Pixiv - 插画社区',
    requiresLogin: false,
  });

  // ─── search — 搜索插画 ────────────────────────────

  site.command('search', {
    description: '搜索 Pixiv 插画/漫画，返回标题、作者、点赞数',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      query: z.string().describe('搜索关键词（日文/英文/中文）'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser pixiv search --query "初音ミク"', description: '搜索初音未来插画' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        author: z.string(),
        likes: z.string(),
        link: z.string(),
        image: z.string(),
        width: z.number(),
        height: z.number(),
      }).passthrough()),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        const url = `https://www.pixiv.net/en/search.php?word=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; author: string; likes: string; link: string; image: string; width: number; height: number }> = [];
          const cards = document.querySelectorAll('[class*="search-result"] figure, [class*="work-item"], [class*="column"] figure');
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector('[class*="title"], figcaption a, a[class*="work"]');
            const authorEl = card.querySelector('[class*="user"], [class*="author"], a[class*="member"]');
            const likesEl = card.querySelector('[class*="count"], [class*="like"], [class*="bookmark"]');
            const imageEl = card.querySelector('img[src*="pximg"], img[class*="thumbnail"], img');
            const linkEl = titleEl?.closest('a') || card.querySelector('a[href*="/artworks/"]');

            const img = imageEl instanceof HTMLImageElement ? imageEl : null;
            items.push({
              title: titleEl?.textContent?.trim() || titleEl?.getAttribute('alt') || '',
              author: authorEl?.textContent?.trim() || '',
              likes: likesEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              image: img?.src || img?.getAttribute('data-src') || '',
              width: img?.naturalWidth || img?.width || 0,
              height: img?.naturalHeight || img?.height || 0,
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; author: string; likes: string; link: string; image: string; width: number; height: number }>;

        return ok(
          { query: params.query, count: results.length, results },
          [...tips, `找到 ${results.length} 件作品`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── trending — 排行榜 ────────────────────────────

  site.command('trending', {
    description: '获取 Pixiv 每日/每周/每月排行榜',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      mode: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily').describe('排行榜类型'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser pixiv trending', description: '查看每日排行榜' },
      { cmd: 'xbrowser pixiv trending --mode weekly', description: '查看每周排行榜' },
    ],
    result: z.object({
      mode: z.string(),
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        author: z.string(),
        rank: z.number(),
        link: z.string(),
        image: z.string(),
      }).passthrough()),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        const modeMap: Record<string, string> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };
        const url = `https://www.pixiv.net/ranking.php?mode=${modeMap[params.mode]}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; author: string; rank: number; link: string; image: string }> = [];
          const ranks = document.querySelectorAll('.ranking-item, [class*="ranking"] figure, [class*="rank"]');
          ranks.forEach((item, i) => {
            if (i >= limit) return;
            const titleEl = item.querySelector('[class*="title"], figcaption a, .work-title');
            const authorEl = item.querySelector('[class*="user"], [class*="author"], .user-name');
            const rankEl = item.querySelector('[class*="rank"], .ranking-num');
            const imageEl = item.querySelector('img[src*="pximg"], img');
            const linkEl = titleEl?.closest('a') || item.querySelector('a[href*="/artworks/"]');

            items.push({
              title: titleEl?.textContent?.trim() || titleEl?.getAttribute('alt') || '',
              author: authorEl?.textContent?.trim() || '',
              rank: parseInt(rankEl?.textContent?.trim() || '0'),
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              image: imageEl instanceof HTMLImageElement ? (imageEl.src || imageEl.getAttribute('data-src') || '') : '',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; author: string; rank: number; link: string; image: string }>;

        return ok(
          { mode: params.mode, count: results.length, results },
          [...tips, `获取 ${params.mode} 排行榜 ${results.length} 件作品`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
