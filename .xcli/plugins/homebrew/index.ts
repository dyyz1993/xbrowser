import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'homebrew',
    url: 'https://formulae.brew.sh',
    description: 'Homebrew formula and cask search',
    requiresLogin: false,
  });
  site.command('formula', {
    description: 'Search Homebrew formulae',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().optional().describe('Search keyword (omit to list all)'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const data = await fetch('https://formulae.brew.sh/api/formula.json').then(r => r.json()) as any;
            const query = (p.query || '').toLowerCase();
            const formulae = Array.isArray(data) ? data : [];
            const results = formulae
              .filter((f: any) => !query || (f.name ?? '').toLowerCase().includes(query) || (f.desc ?? '').toLowerCase().includes(query))
              .slice(0, p.limit || 20)
              .map((f: any, i: number) => ({
                rank: i + 1,
                name: f.name ?? '',
                description: f.desc ?? '',
                version: f.versions?.stable ?? '',
                license: f.license ?? '',
                analytics: f.analytics?.install?.['30d'] ? `${f.analytics.install['30d']} installs/30d` : '',
                url: `https://formulae.brew.sh/formula/${f.name}`,
              }));
            if (results.length === 0) return fail(`No formulae matched "${p.query}"`);
            return ok(results);
    },
  });
  site.command('cask', {
    description: 'Search Homebrew casks (GUI apps)',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().optional().describe('Search keyword (omit to list all)'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const data = await fetch('https://formulae.brew.sh/api/cask.json').then(r => r.json()) as any;
            const query = (p.query || '').toLowerCase();
            const casks = Array.isArray(data) ? data : [];
            const results = casks
              .filter((c: any) => !query || (c.name ?? []).some((n: string) => n.toLowerCase().includes(query)) || (c.desc ?? '').toLowerCase().includes(query))
              .slice(0, p.limit || 20)
              .map((c: any, i: number) => ({
                rank: i + 1,
                name: (c.name ?? [])[0] ?? c.token ?? '',
                description: c.desc ?? '',
                version: c.version ?? '',
                homepage: c.homepage ?? '',
                url: `https://formulae.brew.sh/cask/${c.token}`,
              }));
            if (results.length === 0) return fail(`No casks matched "${p.query}"`);
            return ok(results);
    },
  });
}
