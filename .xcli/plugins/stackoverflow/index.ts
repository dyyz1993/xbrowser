import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'stackoverflow',
    url: 'https://stackoverflow.com',
    description: 'Stack Overflow - 技术问答搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Stack Overflow questions',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${encodeURIComponent(p.query)}&site=stackoverflow&pagesize=${p.limit || 20}`;
            const data = await fetch(url).then(r => r.json()) as any;
            const items = data?.items ?? [];
            if (items.length === 0) return fail(`No questions matched "${p.query}"`);
            return ok(items.slice(0, p.limit).map((q: any, i: number) => ({
              rank: i + 1,
              title: q.title ?? '',
              score: q.score ?? 0,
              answerCount: q.answer_count ?? 0,
              viewCount: q.view_count ?? 0,
              tags: (q.tags ?? []).join(', '),
              owner: q.owner?.display_name ?? '',
              isAnswered: q.is_answered ?? false,
              acceptedAnswerId: q.accepted_answer_id ?? null,
              created: new Date(q.creation_date * 1000).toISOString().slice(0, 10),
              url: q.link ?? '',
            })));
    },
  });
}
