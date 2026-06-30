import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'v2ex',
    url: 'https://www.v2ex.com',
    description: 'V2EX - 创意工作者社区',
    requiresLogin: false,
  });

  // ─── hot — 热门主题 ──────────────────────────────

  site.command('hot', {
    description: '获取 V2EX 热门主题列表',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      limit: z.number().optional().default(20),
    }),
    examples: [
      { cmd: 'xbrowser v2ex hot', description: '查看热门主题' },
    ],
    result: z.object({
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        node: z.string(),
        author: z.string(),
        replies: z.string(),
        link: z.string(),
      }).passthrough()),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        await page.goto('https://www.v2ex.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; node: string; author: string; replies: string; link: string }> = [];
          const topics = document.querySelectorAll('.cell.item, tr[class*="item"], .topic-item');
          topics.forEach((topic, i) => {
            if (i >= limit) return;
            const titleEl = topic.querySelector('.topic-link, a[class*="topic"], .item_title a');
            const nodeEl = topic.querySelector('.node a, a[class*="node"]');
            const authorEl = topic.querySelector('.topic_info a:not(.node), strong a, a[class*="author"]');
            const repliesEl = topic.querySelector('.count_of_replies, [class*="replies"], .topic_info .gray');
            const linkEl = titleEl?.closest('a') || topic.querySelector('a[href*="/t/"]');

            items.push({
              title: titleEl?.textContent?.trim() || '',
              node: nodeEl?.textContent?.trim() || '',
              author: authorEl?.textContent?.trim() || '',
              replies: repliesEl?.textContent?.trim()?.match(/\d+/)?.[0] || '0',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; node: string; author: string; replies: string; link: string }>;

        return ok(
          { count: results.length, results },
          [...tips, `获取 ${results.length} 个热门主题`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── latest — 最新主题 ────────────────────────────

  site.command('latest', {
    description: '获取 V2EX 最新主题列表',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      limit: z.number().optional().default(20),
    }),
    examples: [
      { cmd: 'xbrowser v2ex latest', description: '查看最新主题' },
    ],
    result: z.object({
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        node: z.string(),
        author: z.string(),
        replies: z.string(),
        link: z.string(),
      }).passthrough()),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        await page.goto('https://www.v2ex.com/?tab=latest', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; node: string; author: string; replies: string; link: string }> = [];
          const topics = document.querySelectorAll('.cell.item, tr[class*="item"], .topic-item');
          topics.forEach((topic, i) => {
            if (i >= limit) return;
            const titleEl = topic.querySelector('.topic-link, a[class*="topic"], .item_title a');
            const nodeEl = topic.querySelector('.node a, a[class*="node"]');
            const authorEl = topic.querySelector('.topic_info a:not(.node), strong a, a[class*="author"]');
            const repliesEl = topic.querySelector('.count_of_replies, [class*="replies"], .topic_info .gray');
            const linkEl = titleEl?.closest('a') || topic.querySelector('a[href*="/t/"]');

            items.push({
              title: titleEl?.textContent?.trim() || '',
              node: nodeEl?.textContent?.trim() || '',
              author: authorEl?.textContent?.trim() || '',
              replies: repliesEl?.textContent?.trim()?.match(/\d+/)?.[0] || '0',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; node: string; author: string; replies: string; link: string }>;

        return ok(
          { count: results.length, results },
          [...tips, `获取 ${results.length} 个最新主题`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
