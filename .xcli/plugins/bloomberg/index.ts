import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'bloomberg',
    url: 'https://www.bloomberg.com',
    description: 'Bloomberg - 财经新闻、市场数据',
    requiresLogin: false,
  });

  // ─── search — 搜索财经新闻 ────────────────────────

  site.command('search', {
    description: '搜索 Bloomberg 财经新闻，返回标题、摘要、时间、链接',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser bloomberg search --query "Apple"', description: '搜索 Apple 相关新闻' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        summary: z.string(),
        date: z.string(),
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
        const url = `https://www.bloomberg.com/search?query=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; summary: string; date: string; link: string; image: string }> = [];
          const articles = document.querySelectorAll('[class*="searchResult"] article, [data-testid="search-result"], article[class*="story"], [class*="hero"] article');
          articles.forEach((article, i) => {
            if (i >= limit) return;
            const titleEl = article.querySelector('h3 a, h3, a[class*="headline"], [class*="title"] a, [class*="headline"] a');
            const summaryEl = article.querySelector('p, [class*="summary"], [class*="description"]');
            const dateEl = article.querySelector('time, [class*="date"], [class*="timestamp"], [class*="published"]');
            const imageEl = article.querySelector('img[src*="bloomberg"], img[src*="bwb"], img');
            const linkEl = titleEl?.closest('a') || article.querySelector('a[href*="/news/"], a[href*="/articles/"]');

            items.push({
              title: titleEl?.textContent?.trim() || '',
              summary: summaryEl?.textContent?.trim() || '',
              date: dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              image: imageEl instanceof HTMLImageElement ? (imageEl.src || '') : '',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; summary: string; date: string; link: string; image: string }>;

        return ok(
          { query: params.query, count: results.length, results },
          [...tips, `找到 ${results.length} 条新闻`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
