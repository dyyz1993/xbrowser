import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'nuget',
    url: 'https://www.nuget.org',
    description: 'NuGet - .NET 包搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search NuGet packages',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const url = `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(p.query)}&prerelease=false&skip=0&take=${p.limit || 20}`;
            const data = await fetch(url).then(r => r.json()) as any;
            const packages = data?.data ?? [];
            if (packages.length === 0) return fail(`No packages matched "${p.query}"`);
            return ok(packages.slice(0, p.limit).map((pkg: any, i: number) => ({
              rank: i + 1,
              id: pkg.id ?? '',
              version: pkg.version ?? '',
              description: pkg.description ?? '',
              authors: (pkg.authors ?? []).join(', '),
              downloads: pkg.totalDownloads ?? 0,
              tags: (pkg.tags ?? []).join(', '),
              url: `https://www.nuget.org/packages/${pkg.id}/`,
            })));
    },
  });
}
