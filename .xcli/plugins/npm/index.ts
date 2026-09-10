import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { fetchJson } from '../shared/api-fetch.js';

/** npm registry JSON 响应的宽松类型（动态 JSON，字段可能缺失） */
type NpmJson = Record<string, unknown> & {
  objects?: Array<{ package?: Record<string, unknown>; downloads?: Record<string, unknown>; dependents?: number; updated?: unknown }>;
  error?: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, Record<string, unknown>>;
  name?: string;
  description?: string;
  keywords?: string[];
  maintainers?: Array<{ name?: string }>;
  readme?: string;
  package?: string;
  startDate?: string;
  endDate?: string;
  downloads?: number;
};


const searchResult = z.array(z.object({
  rank: z.number(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  weeklyDownloads: z.number().nullable(),
  dependents: z.number().nullable(),
  license: z.string(),
  publisher: z.string(),
  updated: z.string(),
  url: z.string(),
}));

const packageResult = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  license: z.string(),
  author: z.string(),
  homepage: z.string(),
  repository: z.string(),
  keywords: z.string(),
  monthlyDownloads: z.number(),
  maintainers: z.string(),
});

const downloadsResult = z.object({
  package: z.string(),
  period: z.string(),
  downloads: z.number(),
});

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'npm',
    url: 'https://www.npmjs.com',
    description: 'npm registry search, package info, and download stats',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search the public npm registry by keyword',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword (e.g. "react", "graphql client")'),
            limit: z.coerce.number().optional().default(20).describe('Max results (1-250)')
    }),
    handler: async (p, _ctx) => {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(p.query)}&size=${Math.min(p.limit || 20, 250)}`;
            const body = await fetchJson(url) as NpmJson;
            const objects = (body?.objects as Record<string, unknown>[] | undefined) ?? [];
            if (objects.length === 0) return fail(`No npm packages matched "${p.query}"`);
            const results = objects.slice(0, p.limit).map((obj, i) => {
              const pkg = (obj.package ?? {}) as Record<string, unknown>;
              const dl = (obj.downloads ?? {}) as Record<string, unknown>;
              return {
                rank: i + 1,
                name: pkg.name ?? '',
                version: pkg.version ?? '',
                description: pkg.description ?? '',
                weeklyDownloads: dl.weekly ?? null,
                dependents: obj.dependents ?? null,
                license: pkg.license ?? '',
                publisher: (pkg.publisher as { username?: string } | undefined)?.username ?? '',
                updated: (obj.updated ?? '').toString().slice(0, 10),
                url: (pkg.links as { npm?: string } | undefined)?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
              };
            });
            return ok(results);
    },
  });
  site.command('package', {
    description: 'Get npm package info and recent downloads',
    result: packageResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name (e.g. "react", "lodash")')
    }),
    handler: async (p, _ctx) => {
      const pkg = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(p.name)}`) as NpmJson;
            if (pkg.error) return fail(`Package "${p.name}" not found: ${pkg.error}`);
            const latest = pkg['dist-tags']?.latest ?? '';
            const ver = pkg.versions?.[latest] ?? {};
            const dlUrl = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(p.name)}`;
            const dlData = await fetchJson(dlUrl) as NpmJson;
            return ok({
              name: pkg.name ?? p.name,
              version: latest,
              description: pkg.description ?? '',
              license: ver.license ?? '',
              author: ((ver.author as { name?: string } | undefined)?.name ?? (ver.author as string | undefined)) ?? '',
              homepage: ver.homepage ?? '',
              repository: (ver.repository as { url?: string } | undefined)?.url ?? '',
              keywords: (pkg.keywords ?? []).join(', '),
              monthlyDownloads: dlData.downloads ?? 0,
              maintainers: (pkg.maintainers ?? []).map(m => m.name ?? '').join(', '),
              readme: pkg.readme ? (pkg.readme.length > 200 ? pkg.readme.slice(0, 200) + '...' : pkg.readme) : '(no readme)',
            });
    },
  });
  site.command('downloads', {
    description: 'Get npm package download stats for a period',
    result: downloadsResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name'),
            period: z.string().optional().default('last-month').describe('Period: last-day, last-week, last-month')
    }),
    handler: async (p, _ctx) => {
      const period = p.period || 'last-month';
            const validPeriods = ['last-day', 'last-week', 'last-month'];
            if (!validPeriods.includes(period)) return fail(`Invalid period: ${period}. Use: ${validPeriods.join(', ')}`);
            const url = `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(p.name)}`;
            const data = await fetchJson(url) as NpmJson;
            if (data.error) return fail(`Error: ${data.error}`);
            return ok({
              package: data.package ?? p.name,
              period: data.startDate ? `${data.startDate} ~ ${data.endDate}` : period,
              downloads: data.downloads ?? 0,
            });
    },
  });
}
