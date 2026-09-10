import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  title: z.string(),
  score: z.number(),
  answerCount: z.number(),
  viewCount: z.number(),
  tags: z.string(),
  owner: z.string(),
  isAnswered: z.boolean(),
  acceptedAnswerId: z.number().nullable(),
  created: z.string(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'stackoverflow',
    url: 'https://stackoverflow.com',
    description: 'Stack Overflow - 技术问答搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Stack Overflow questions',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${encodeURIComponent(p.query)}&site=stackoverflow&pagesize=${p.limit || 20}`;
            const data = await fetchJson(url) as JsonObject;
            const items = (data?.items as Record<string, unknown>[] | undefined) ?? [];
            if (items.length === 0) return fail(`No questions matched "${p.query}"`);
            interface SoQuestion { title?: string; score?: number; answer_count?: number; view_count?: number; tags?: string[]; owner?: { display_name?: string }; is_answered?: boolean; accepted_answer_id?: number | null; creation_date?: number; link?: string }
            return ok(items.slice(0, p.limit).map((q: SoQuestion, i: number) => ({
              rank: i + 1,
              title: q.title ?? '',
              score: q.score ?? 0,
              answerCount: q.answer_count ?? 0,
              viewCount: q.view_count ?? 0,
              tags: (q.tags ?? []).join(', '),
              owner: q.owner?.display_name ?? '',
              isAnswered: q.is_answered ?? false,
              acceptedAnswerId: q.accepted_answer_id ?? null,
              created: new Date(q.creation_date! * 1000).toISOString().slice(0, 10),
              url: q.link ?? '',
            })));
    },
  });
}
