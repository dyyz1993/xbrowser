import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  id: z.string(),
  label: z.string(),
  description: z.string(),
  url: z.string(),
}));

const entityResult = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  type: z.string(),
  modified: z.string(),
  propertyCount: z.number(),
  siteLinkCount: z.number(),
  url: z.string(),
});

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'wikidata',
    url: 'https://www.wikidata.org',
    description: 'Wikidata - 结构化知识库查询',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Wikidata entities',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(p.query)}&language=en&format=json&limit=${p.limit || 20}`;
            const data = await fetchJson(url) as JsonObject;
            interface WikidataEntity { id?: string; label?: string; description?: string; display?: { label?: { value?: string }; description?: { value?: string } } }
            const results = ((data.search as Record<string, unknown>[] | undefined) ?? []).map((r: WikidataEntity, i: number) => ({
              rank: i + 1,
              id: r.id ?? '',
              label: r.label ?? r.display?.label?.value ?? '',
              description: r.description ?? r.display?.description?.value ?? '',
              url: `https://www.wikidata.org/wiki/${r.id}`,
            }));
            if (results.length === 0) return fail(`No Wikidata entities matched "${p.query}"`);
            return ok(results);
    },
  });
  site.command('entity', {
    description: 'Get Wikidata entity details',
    result: entityResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      id: z.string().describe('Wikidata entity ID (e.g. "Q42" for Douglas Adams)')
    }),
    handler: async (p, _ctx) => {
      const url = `https://www.wikidata.org/wiki/Special:EntityData/${p.id}.json`;
            const data = await fetchJson(url) as JsonObject;
            const entity = (data?.entities as Record<string, unknown> | undefined)?.[p.id];
            if (!entity) return fail(`Entity "${p.id}" not found`);
            const labels = (entity as Record<string, unknown>).labels ?? {};
            const descriptions = (entity as Record<string, unknown>).descriptions ?? {};
            const claims = (entity as Record<string, unknown>).claims ?? {};
            const sitelinks = (entity as Record<string, unknown>).sitelinks ?? {};
            return ok({
              id: p.id,
              label: (labels as Record<string, { value?: string }>).en?.value ?? (Object.values(labels)[0] as { value?: string } | undefined)?.value ?? '',
              description: (descriptions as Record<string, { value?: string }>).en?.value ?? (Object.values(descriptions)[0] as { value?: string } | undefined)?.value ?? '',
              type: (entity as Record<string, unknown>).type ?? '',
              modified: (entity as Record<string, unknown>).modified ?? '',
              propertyCount: Object.keys(claims).length,
              siteLinkCount: Object.keys(sitelinks).length,
              url: `https://www.wikidata.org/wiki/${p.id}`,
            });
    },
  });
}
