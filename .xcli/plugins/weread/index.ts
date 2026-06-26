import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'weread',
    url: 'https://weread.qq.com',
    description: '微信读书 - 读书笔记、书架',
    requiresLogin: false,
  });
  site.command('search', {
    description: '搜索微信读书图书',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
            limit: z.coerce.number().optional().default(20).describe('返回数量')
    }),
    handler: async (p, ctx) => {
      const url = `https://weread.qq.com/web/search?q=${encodeURIComponent(p.query)}`;
            const data = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://weread.qq.com/' } }).then(r => r.json()) as any;
            const books = data?.books ?? data?.data?.books ?? [];
            if (books.length === 0) return fail(`未找到 "${p.query}" 的相关图书`);
            return ok(books.slice(0, p.limit || 20).map((b: any, i: number) => ({
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
