import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  groupId: z.string(),
  artifactId: z.string(),
  version: z.string(),
  description: z.string(),
  timestamp: z.string(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'maven',
    url: 'https://search.maven.org',
    description: 'Maven - Java 包搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Maven Central artifacts',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(p.query)}&rows=${p.limit || 20}&wt=json`;
            const data = await fetchJson(url) as JsonObject;
            const docs = ((data as Record<string, { docs?: Record<string, unknown>[] } | undefined> | undefined)?.response?.docs as Record<string, unknown>[] | undefined) ?? [];
            if (docs.length === 0) return fail(`No artifacts matched "${p.query}"`);
            interface MavenDoc { g?: string; a?: string; latestVersion?: string; v?: string; p?: string[]; ec?: string[]; timestamp?: number }
            return ok(docs.slice(0, p.limit).map((d: MavenDoc, i: number) => ({
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
