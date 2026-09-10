import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const formulaResult = z.array(z.object({
  rank: z.number(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  license: z.string(),
  analytics: z.string(),
  url: z.string(),
}));

const caskResult = z.array(z.object({
  rank: z.number(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  homepage: z.string(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'homebrew',
    url: 'https://formulae.brew.sh',
    description: 'Homebrew formula and cask search',
    requiresLogin: false,
  });
  site.command('formula', {
    description: 'Search Homebrew formulae',
    result: formulaResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().optional().describe('Search keyword (omit to list all)'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const data = await fetchJson('https://formulae.brew.sh/api/formula.json') as JsonObject;
            const query = (p.query || '').toLowerCase();
            const formulae = Array.isArray(data) ? data : [];
            interface BrewFormula { name?: string; desc?: string; versions?: { stable?: string }; license?: string; analytics?: { install?: { '30d'?: number } } }
            const results = formulae
              .filter((f: BrewFormula) => !query || (f.name ?? '').toLowerCase().includes(query) || (f.desc ?? '').toLowerCase().includes(query))
              .slice(0, p.limit || 20)
              .map((f: BrewFormula, i: number) => ({
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
    result: caskResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().optional().describe('Search keyword (omit to list all)'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const data = await fetchJson('https://formulae.brew.sh/api/cask.json') as JsonObject;
            const query = (p.query || '').toLowerCase();
            const casks = Array.isArray(data) ? data : [];
            const results = casks
              .filter((c: { name?: string[]; desc?: string; token?: string }) => !query || (c.name ?? []).some((n: string) => n.toLowerCase().includes(query)) || (c.desc ?? '').toLowerCase().includes(query))
              .slice(0, p.limit || 20)
              .map((c: { name?: string[]; token?: string; desc?: string; version?: string; homepage?: string }, i: number) => ({
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
