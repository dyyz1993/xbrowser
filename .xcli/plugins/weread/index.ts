import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


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
      const url = `https://weread.qq.com/web/search?q=${encodeURIComponent(p.query)}`;
            const data = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://weread.qq.com/' } }) as JsonObject;
            const books = (((data as Record<string, { books?: unknown[] }> | undefined)?.books ?? (data as Record<string, Record<string, { books?: unknown[] }>> | undefined)?.data?.books) ?? []) as Record<string, unknown>[];
            if (books.length === 0) return fail(`未找到 "${p.query}" 的相关图书`);
            interface WeReadBook { bookId?: string; title?: string; author?: string; intro?: string; cover?: string; category?: string; cat?: string }
            return ok(books.slice(0, p.limit || 20).map((b: WeReadBook, i: number) => ({
              rank: i + 1,
              bookId: b.bookId ?? '',
              title: b.title ?? '',
              author: b.author ?? '',
              intro: (b.intro ?? '').slice(0, 200),
              cover: b.cover ?? '',
              category: b.category ?? b.cat ?? '',
              url: `https://weread.qq.com/web/reader/${b.bookId}`,
            })));
    },
  });
}
