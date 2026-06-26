import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'rubygems',
    url: 'https://rubygems.org',
    description: 'RubyGems - Ruby 包搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search RubyGems packages',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const url = `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(p.query)}`;
            const data = await fetch(url).then(r => r.json()) as any;
            const gems = Array.isArray(data) ? data : [];
            if (gems.length === 0) return fail(`No gems matched "${p.query}"`);
            return ok(gems.slice(0, p.limit).map((g: any, i: number) => ({
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
