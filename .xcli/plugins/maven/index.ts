import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'maven',
    url: 'https://search.maven.org',
    description: 'Maven - Java 包搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Maven Central artifacts',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(p.query)}&rows=${p.limit || 20}&wt=json`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            const docs = data?.response?.docs ?? [];
            if (docs.length === 0) return fail(`No artifacts matched "${p.query}"`);
            return ok(docs.slice(0, p.limit).map((d: any, i: number) => ({
              rank: i + 1,
              groupId: d.g ?? '',
              artifactId: d.a ?? '',
              version: d.latestVersion ?? d.v ?? '',
              description: (d.p ?? d.ec ?? []).join('. ') || '',
              timestamp: d.timestamp ? new Date(d.timestamp).toISOString().slice(0, 10) : '',
              url: `https://search.maven.org/artifact/${d.g}/${d.a}/`,
            })));
    },
  });
}
