import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  bookId: z.string(),
  title: z.string(),
  author: z.string(),
  intro: z.string(),
  cover: z.string(),
  category: z.string(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'weread',
    url: 'https://weread.qq.com',
    description: '微信读书 - 读书笔记、书架',
    requiresLogin: false,
  });
  site.command('search', {
    description: '搜索微信读书图书',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
            limit: z.coerce.number().optional().default(20).describe('返回数量')
    }),
    handler: async (p, _ctx) => {
      // WeRead has no public search API without login token; extract via DOM.
      const page = (_ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail('微信读书搜索需要浏览器页面（weread API 需要登录 token）');

      const searchUrl = `https://weread.qq.com/web/search/books?keyword=${encodeURIComponent(p.query)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);

      const raw = await page.evaluate(`
        (() => {
          const items = [...document.querySelectorAll('.search_result_book_item, .bookItem')].slice(0, ${p.limit || 20});
          return items.map((item, index) => {
            const link = item.querySelector('a[href*="/web/reader/"]');
            const title = item.querySelector('.title, .bookTitle');
            const author = item.querySelector('.author, .bookAuthor');
            const intro = item.querySelector('.intro, .bookIntro');
            const img = item.querySelector('img');
            const bookIdMatch = (link?.getAttribute('href') || '').match(/\\/web\\/reader\\/([a-f0-9]+)/);
            return {
              index,
              bookId: bookIdMatch?.[1] ?? '',
              title: title?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
              author: author?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
              intro: (intro?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 200),
              cover: img?.getAttribute('src') ?? '',
              category: '',
            };
          });
        })()
      `) as Array<Record<string, unknown>>;

      if (!raw.length) return fail(`未找到 "${p.query}" 的相关图书`);
      return ok(raw.map((item, i) => ({
        rank: i + 1,
        bookId: String(item.bookId ?? ''),
        title: String(item.title ?? ''),
        author: String(item.author ?? ''),
        intro: String(item.intro ?? '').slice(0, 200),
        cover: String(item.cover ?? ''),
        category: '',
        url: `https://weread.qq.com/web/reader/${item.bookId}`,
      })));
    },
  });
}
