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
  url: z.string(),
}));

const packageResult = z.object({
  name: z.string(),
  version: z.string(),
  summary: z.string(),
  description: z.string(),
  author: z.string(),
  authorEmail: z.string(),
  license: z.string(),
  homePage: z.string(),
  projectUrls: z.string(),
  requiresPython: z.string(),
  requiresDist: z.string(),
  classifiers: z.string(),
  downloads: z.number(),
  releases: z.number(),
});

const downloadsResult = z.object({
  package: z.string(),
  lastDay: z.number(),
  lastWeek: z.number(),
  lastMonth: z.number(),
});

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pypi',
    url: 'https://pypi.org',
    description: 'PyPI package search and info',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search PyPI packages by keyword',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://pypi.org/search/?q=${encodeURIComponent(p.query)}&page=1`;
            const html = await fetch(url).then(r => r.text());
            // Parse HTML for package list
            const results = [];
            const nameRegex = /<span class="package-snippet__name">([^<]+)<\/span>/g;
            const descRegex = /<p class="package-snippet__description">([^<]*)<\/p>/g;
            const versionRegex = /<span class="package-snippet__version">([^<]+)<\/span>/g;
            const names = [...html.matchAll(nameRegex)].map(m => m[1]);
            const descs = [...html.matchAll(descRegex)].map(m => m[1]);
            const versions = [...html.matchAll(versionRegex)].map(m => m[1]);
            for (let i = 0; i < Math.min(names.length, p.limit || 20); i++) {
              results.push({
                rank: i + 1,
                name: names[i] ?? '',
                version: versions[i] ?? '',
                description: (descs[i] ?? '').trim(),
                url: `https://pypi.org/project/${names[i]}/`,
              });
            }
            if (results.length === 0) return fail(`No packages matched "${p.query}"`);
            return ok(results);
    },
  });
  site.command('package', {
    description: 'Get PyPI package details',
    result: packageResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name')
    }),
    handler: async (p, _ctx) => {
      const url = `https://pypi.org/pypi/${encodeURIComponent(p.name)}/json`;
            const data = await fetchJson(url) as JsonObject;
            if (data.message && (data.message as unknown as string).includes('Not Found')) return fail(`Package "${p.name}" not found`);
            const info = (data.info as Record<string, unknown> | undefined) ?? {};
            return ok({
              name: info.name ?? p.name,
              version: info.version ?? '',
              summary: info.summary ?? '',
              description: ((info.description as string | undefined) ?? '').slice(0, 500) + (((info.description as string | undefined)?.length ?? 0) > 500 ? '...' : ''),
              author: info.author ?? '',
              authorEmail: info.author_email ?? '',
              license: info.license ?? '',
              homePage: info.home_page ?? '',
              projectUrls: info.project_urls ? Object.entries(info.project_urls).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
              requiresPython: info.requires_python ?? '',
              requiresDist: ((info.requires_dist as string[] | undefined) ?? []).join(', '),
              classifiers: ((info.classifiers as string[] | undefined) ?? []).slice(0, 10).join(', '),
              downloads: (info.downloads as Record<string, number> | undefined)?.last_month ?? 0,
              releases: Object.keys((data.releases as Record<string, unknown> | undefined) ?? {}).length,
            });
    },
  });
  site.command('downloads', {
    description: 'Get PyPI package download stats',
    result: downloadsResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name')
    }),
    handler: async (p, _ctx) => {
      const url = `https://pypistats.org/api/packages/${p.name.toLowerCase()}/recent`;
            const data = await fetchJson(url) as JsonObject;
            if (data.error) return fail(`Error: ${data.error}`);
            return ok({
              package: p.name,
              lastDay: (data.data as Record<string, number> | undefined)?.last_day ?? 0,
              lastWeek: (data.data as Record<string, number> | undefined)?.last_week ?? 0,
              lastMonth: (data.data as Record<string, number> | undefined)?.last_month ?? 0,
            });
    },
  });
}
