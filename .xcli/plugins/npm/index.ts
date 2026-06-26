import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'npm',
    url: 'https://www.npmjs.com',
    description: 'npm registry search, package info, and download stats',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search the public npm registry by keyword',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword (e.g. "react", "graphql client")'),
            limit: z.coerce.number().optional().default(20).describe('Max results (1-250)')
    }),
    handler: async (p, ctx) => {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(p.query)}&size=${Math.min(p.limit || 20, 250)}`;
            const body = await fetch(url).then(r => r.json()) as any;
            const objects = body?.objects ?? [];
            if (objects.length === 0) return fail(`No npm packages matched "${p.query}"`);
            const results = objects.slice(0, p.limit).map((obj: any, i: number) => {
              const pkg = obj.package ?? {};
              const dl = obj.downloads ?? {};
              return {
                rank: i + 1,
                name: pkg.name ?? '',
                version: pkg.version ?? '',
                description: pkg.description ?? '',
                weeklyDownloads: dl.weekly ?? null,
                dependents: obj.dependents ?? null,
                license: pkg.license ?? '',
                publisher: pkg.publisher?.username ?? '',
                updated: (obj.updated ?? '').toString().slice(0, 10),
                url: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
              };
            });
            return ok(results);
    },
  });
  site.command('package', {
    description: 'Get npm package info and recent downloads',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name (e.g. "react", "lodash")')
    }),
    handler: async (p, ctx) => {
      const pkg = await fetch(`https://registry.npmjs.org/${encodeURIComponent(p.name)}`).then(r => r.json()) as any;
            if (pkg.error) return fail(`Package "${p.name}" not found: ${pkg.error}`);
            const latest = pkg['dist-tags']?.latest ?? '';
            const ver = pkg.versions?.[latest] ?? {};
            const dlUrl = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(p.name)}`;
            const dlData = await fetch(dlUrl).then(r => r.json()) as any;
            return ok({
              name: pkg.name ?? p.name,
              version: latest,
              description: pkg.description ?? '',
              license: ver.license ?? '',
              author: ver.author?.name ?? ver.author ?? '',
              homepage: ver.homepage ?? '',
              repository: ver.repository?.url ?? '',
              keywords: (pkg.keywords ?? []).join(', '),
              monthlyDownloads: dlData.downloads ?? 0,
              maintainers: (pkg.maintainers ?? []).map((m: any) => m.name).join(', '),
              readme: pkg.readme ? (pkg.readme.length > 200 ? pkg.readme.slice(0, 200) + '...' : pkg.readme) : '(no readme)',
            });
    },
  });
  site.command('downloads', {
    description: 'Get npm package download stats for a period',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name'),
            period: z.string().optional().default('last-month').describe('Period: last-day, last-week, last-month')
    }),
    handler: async (p, ctx) => {
      const period = p.period || 'last-month';
            const validPeriods = ['last-day', 'last-week', 'last-month'];
            if (!validPeriods.includes(period)) return fail(`Invalid period: ${period}. Use: ${validPeriods.join(', ')}`);
            const url = `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(p.name)}`;
            const data = await fetch(url).then(r => r.json()) as any;
            if (data.error) return fail(`Error: ${data.error}`);
            return ok({
              package: data.package ?? p.name,
              period: data.startDate ? `${data.startDate} ~ ${data.endDate}` : period,
              downloads: data.downloads ?? 0,
            });
    },
  });
}
