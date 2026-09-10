import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';

const newsResult = z.array(z.object({
  rank: z.number(),
  title: z.string(),
  description: z.string(),
  author: z.string(),
  publishedAt: z.string(),
  url: z.string(),
  source: z.string(),
}));


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'bbc',
    url: 'https://www.bbc.com',
    description: 'BBC News top stories and topic coverage',
    requiresLogin: false,
  });
  site.command('news', {
    description: 'Get BBC News headlines',
    result: newsResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = 'https://newsapi.org/v2/top-headlines?sources=bbc-news&apiKey=' + (process.env.NEWSAPI_KEY || '');
            const data = await fetchJson(url) as JsonObject;
            if (data.status !== 'ok') return fail('Failed to fetch BBC news. Set NEWSAPI_KEY env var.');
            interface NewsArticle {
              title?: string;
              description?: string;
              author?: string;
              publishedAt?: string;
              url?: string;
              source?: { name?: string };
            }
            const results = ((data.articles as Record<string, unknown>[] | undefined) ?? []).slice(0, p.limit || 20).map((a: NewsArticle, i: number) => ({
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
