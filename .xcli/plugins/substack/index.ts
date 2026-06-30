import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'substack',
    url: 'https://substack.com',
    description: 'Substack - 新闻通讯平台',
    requiresLogin: false,
  });

  // ─── search — 搜索通讯 ────────────────────────────

  site.command('search', {
    description: '搜索 Substack 新闻通讯，返回名称、简介、订阅数',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser substack search --query "technology"', description: '搜索科技类通讯' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      results: z.array(z.object({
        name: z.string(),
        description: z.string(),
        subscribers: z.string(),
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
        const url = `https://substack.com/search?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ name: string; description: string; subscribers: string; link: string; image: string }> = [];
          const cards = document.querySelectorAll('[class*="search-result"], [class*="publication"], article, [class*="card"]');
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const nameEl = card.querySelector('[class*="name"], [class*="title"] a, h3 a, h3, a[class*="publication"]');
            const descEl = card.querySelector('[class*="description"], [class*="bio"], p');
            const subEl = card.querySelector('[class*="subscribers"], [class*="subscriber"], [class*="followers"]');
            const imageEl = card.querySelector('img[src*="substack"], img[class*="avatar"], img[class*="logo"], img');
            const linkEl = nameEl?.closest('a') || card.querySelector('a[href*="substack.com/"]');

            items.push({
              name: nameEl?.textContent?.trim() || '',
              description: descEl?.textContent?.trim().slice(0, 200) || '',
              subscribers: subEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              image: imageEl instanceof HTMLImageElement ? (imageEl.src || '') : '',
            });
          });
          return items;
        }, params.limit) as Array<{ name: string; description: string; subscribers: string; link: string; image: string }>;

        return ok(
          { query: params.query, count: results.length, results },
          [...tips, `找到 ${results.length} 个通讯`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
