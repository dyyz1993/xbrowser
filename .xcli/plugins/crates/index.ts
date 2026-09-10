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
  recentDownloads: z.number(),
  updated: z.string(),
  stars: z.number(),
  url: z.string(),
}));

const crateResult = z.object({
  name: z.string(),
  latestVersion: z.string(),
  description: z.string(),
  downloads: z.number(),
  recentDownloads: z.number(),
  stars: z.number(),
  forks: z.number(),
  issues: z.number(),
  homepage: z.string(),
  repository: z.string(),
  documentation: z.string(),
  keywords: z.string(),
  categories: z.string(),
  created: z.string(),
});


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'crates',
    url: 'https://crates.io',
    description: 'Crates.io Rust package search and info',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search crates.io by keyword',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(p.query)}&per_page=${Math.min(p.limit || 20, 100)}`;
            const data = await fetchJson(url, { headers: { 'User-Agent': 'xbrowser/1.0' } }) as JsonObject;
            const crates = (data.crates as Record<string, unknown>[] | undefined) ?? [];
            if (crates.length === 0) return fail(`No crates matched "${p.query}"`);
            interface CrateRow {
              name?: string;
              max_version?: string;
              newest_version?: string;
              description?: string;
              downloads?: number;
              recent_downloads?: number;
              updated_at?: string;
              stars?: number;
            }
            const results = crates.slice(0, p.limit).map((c: CrateRow, i: number) => ({
              rank: i + 1,
              name: c.name ?? '',
              version: c.max_version ?? c.newest_version ?? '',
              description: c.description ?? '',
              downloads: c.downloads ?? 0,
              recentDownloads: c.recent_downloads ?? 0,
              updated: c.updated_at?.slice(0, 10) ?? '',
              stars: c.stars ?? 0,
              url: `https://crates.io/crates/${c.name}`,
            }));
            return ok(results);
    },
  });
  site.command('crate', {
    description: 'Get crates.io package details',
    result: crateResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Crate name')
    }),
    handler: async (p, _ctx) => {
      const url = `https://crates.io/api/v1/crates/${encodeURIComponent(p.name)}`;
            const data = await fetchJson(url, { headers: { 'User-Agent': 'xbrowser/1.0' } }) as JsonObject;
            const cr = (data.crate as Record<string, unknown> | undefined) ?? {};
            if (!cr.name) return fail(`Crate "${p.name}" not found`);
            const ver = ((data.versions as Record<string, unknown>[] | undefined)?.[0] ?? {}) as Record<string, unknown>;
            return ok({
              name: cr.name ?? p.name,
              latestVersion: cr.max_version ?? ver.num ?? '',
              description: cr.description ?? '',
              downloads: cr.downloads ?? 0,
              recentDownloads: cr.recent_downloads ?? 0,
              stars: cr.stars ?? 0,
              forks: cr.forks ?? 0,
              issues: cr.issues ?? 0,
              homepage: cr.homepage ?? '',
              repository: cr.repository ?? '',
              documentation: cr.documentation ?? '',
              keywords: ((cr.keywords as string[] | undefined) ?? []).join(', '),
              categories: ((cr.categories as string[] | undefined) ?? []).join(', '),
              created: (cr.created_at as string | undefined)?.slice(0, 10) ?? '',
              updated: (cr.updated_at as string | undefined)?.slice(0, 10) ?? '',
            });
    },
  });
}
