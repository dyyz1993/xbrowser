import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  name: z.string(),
  description: z.string(),
  downloads: z.number(),
  favers: z.number(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'packagist',
    url: 'https://packagist.org',
    description: 'Packagist - PHP 包搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Packagist packages',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://packagist.org/search.json?q=${encodeURIComponent(p.query)}&per_page=${p.limit || 20}`;
            const data = await fetchJson(url) as JsonObject;
            const results = (data?.results as Record<string, unknown>[] | undefined) ?? [];
            if (results.length === 0) return fail(`No packages matched "${p.query}"`);
            interface PackagistResult { name?: string; description?: string; downloads?: number; favers?: number }
            return ok(results.slice(0, p.limit).map((r: PackagistResult, i: number) => ({
              rank: i + 1,
              name: r.name ?? '',
              description: r.description ?? '',
              downloads: r.downloads ?? 0,
              favers: r.favers ?? 0,
              url: `https://packagist.org/packages/${r.name}`,
            })));
    },
  });
}
