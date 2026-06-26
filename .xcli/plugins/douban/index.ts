import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'douban',
    url: 'https://www.douban.com',
    description: '豆瓣 - 电影、图书、音乐搜索',
    requiresLogin: false,
  });
function gp(ctx: CommandContext): Page {
  const p = ctx.page;
  if (!p) throw new Error('需要浏览器页面，请使用 --cdp 连接');
  return p;
}

  site.command('search', {
    description: '搜索豆瓣电影、图书或音乐',
    loginRequired: 'none',
    scope: 'page',
    parameters: z.object({
      type: z.enum(['movie', 'book', 'music']).optional().default('movie').describe('搜索类型：movie=电影, book=图书, music=音乐'),
            keyword: z.string().describe('搜索关键词'),
            limit: z.coerce.number().optional().default(20).describe('返回结果数量')
    }),
    handler: async (p, ctx) => {
      const page = gp(ctx);
            const searchUrl = p.type === 'book' ? 'https://search.douban.com/book/subject_search?search_text=' + encodeURIComponent(p.keyword)
              : p.type === 'music' ? 'https://music.douban.com/search?q=' + encodeURIComponent(p.keyword)
              : 'https://movie.douban.com/subject_search?search_text=' + encodeURIComponent(p.keyword);
            await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000);
            const data = await page.evaluate(() => {
              const results = [];
              const items = document.querySelectorAll('.item, .result, .sc-bZQynM, .sc-fqkvVR');
              items.forEach((item, i) => {
                const titleEl = item.querySelector('.title a, .hd a, a[href*="subject"]');
                const ratingEl = item.querySelector('.rating_nums, .rating, .star-link');
                const abstractEl = item.querySelector('.abstract, .intro, .pl, .color-gray');
                const title = titleEl?.textContent?.trim() || '';
                if (!title) return;
                results.push({
                  rank: i + 1,
                  title,
                  rating: ratingEl?.textContent?.trim() || '',
                  abstract: abstractEl?.textContent?.trim().replace(/\n/g, ' ') || '',
                  url: titleEl?.getAttribute('href') || '',
                });
              });
              return results;
            });
            if (!data || data.length === 0) return fail(`未找到 "${p.keyword}" 的相关结果`);
            return ok(data.slice(0, p.limit));
    },
  });
}
