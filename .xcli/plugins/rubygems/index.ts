import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  downloads: z.number(),
  authors: z.string(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'rubygems',
    url: 'https://rubygems.org',
    description: 'RubyGems - Ruby 包搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search RubyGems packages',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(p.query)}`;
            const data = await fetchJson(url) as JsonObject;
            const gems = Array.isArray(data) ? data : [];
            if (gems.length === 0) return fail(`No gems matched "${p.query}"`);
            interface GemRow { name?: string; version?: string; current_version?: string; description?: string; info?: string; downloads?: number; authors?: string }
            return ok(gems.slice(0, p.limit).map((g: GemRow, i: number) => ({
              rank: i + 1,
              name: g.name ?? '',
              version: g.version ?? g.current_version ?? '',
              description: g.description ?? g.info ?? '',
              downloads: g.downloads ?? 0,
              authors: g.authors ?? '',
              url: `https://rubygems.org/gems/${g.name}`,
            })));
    },
  });
}
