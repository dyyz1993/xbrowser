import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pypi',
    url: 'https://pypi.org',
    description: 'PyPI package search and info',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search PyPI packages by keyword',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name')
    }),
    handler: async (p, ctx) => {
      const url = `https://pypi.org/pypi/${encodeURIComponent(p.name)}/json`;
            const data = await fetch(url).then(r => r.json()) as any;
            if (data.message && data.message.includes('Not Found')) return fail(`Package "${p.name}" not found`);
            const info = data.info ?? {};
            const urls = data.urls ?? [];
            return ok({
              name: info.name ?? p.name,
              version: info.version ?? '',
              summary: info.summary ?? '',
              description: (info.description ?? '').slice(0, 500) + (info.description?.length > 500 ? '...' : ''),
              author: info.author ?? '',
              authorEmail: info.author_email ?? '',
              license: info.license ?? '',
              homePage: info.home_page ?? '',
              projectUrls: info.project_urls ? Object.entries(info.project_urls).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
              requiresPython: info.requires_python ?? '',
              requiresDist: (info.requires_dist ?? []).join(', '),
              classifiers: (info.classifiers ?? []).slice(0, 10).join(', '),
              downloads: info.downloads?.last_month ?? 0,
              releases: Object.keys(data.releases ?? {}).length,
            });
    },
  });
  site.command('downloads', {
    description: 'Get PyPI package download stats',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      name: z.string().describe('Package name')
    }),
    handler: async (p, ctx) => {
      const url = `https://pypistats.org/api/packages/${p.name.toLowerCase()}/recent`;
            const data = await fetch(url).then(r => r.json()) as any;
            if (data.error) return fail(`Error: ${data.error}`);
            return ok({
              package: p.name,
              lastDay: data.data?.last_day ?? 0,
              lastWeek: data.data?.last_week ?? 0,
              lastMonth: data.data?.last_month ?? 0,
            });
    },
  });
}
