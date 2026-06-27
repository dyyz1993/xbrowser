import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'bbc',
    url: 'https://www.bbc.com',
    description: 'BBC News top stories and topic coverage',
    requiresLogin: false,
  });
  site.command('news', {
    description: 'Get BBC News headlines',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = 'https://newsapi.org/v2/top-headlines?sources=bbc-news&apiKey=' + (process.env.NEWSAPI_KEY || '');
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            if (data.status !== 'ok') return fail('Failed to fetch BBC news. Set NEWSAPI_KEY env var.');
            const results = (data.articles ?? []).slice(0, p.limit || 20).map((a: any, i: number) => ({
              rank: i + 1,
              title: a.title ?? '',
              description: a.description ?? '',
              author: a.author ?? '',
              publishedAt: a.publishedAt?.slice(0, 10) ?? '',
              url: a.url ?? '',
              source: a.source?.name ?? 'BBC News',
            }));
            if (results.length === 0) return fail('No news articles found');
            return ok(results);
    },
  });
}
