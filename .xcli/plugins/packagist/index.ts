import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'packagist',
    url: 'https://packagist.org',
    description: 'Packagist - PHP 包搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Packagist packages',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const url = `https://packagist.org/search.json?q=${encodeURIComponent(p.query)}&per_page=${p.limit || 20}`;
            const data = await fetch(url).then(r => r.json()) as any;
            const results = data?.results ?? [];
            if (results.length === 0) return fail(`No packages matched "${p.query}"`);
            return ok(results.slice(0, p.limit).map((r: any, i: number) => ({
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
