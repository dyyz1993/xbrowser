import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'wikidata',
    url: 'https://www.wikidata.org',
    description: 'Wikidata - 结构化知识库查询',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Wikidata entities',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(p.query)}&language=en&format=json&limit=${p.limit || 20}`;
            const data = await fetch(url).then(r => r.json()) as any;
            const results = (data.search ?? []).map((r: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      id: z.string().describe('Wikidata entity ID (e.g. "Q42" for Douglas Adams)')
    }),
    handler: async (p, ctx) => {
      const url = `https://www.wikidata.org/wiki/Special:EntityData/${p.id}.json`;
            const data = await fetch(url).then(r => r.json()) as any;
            const entity = data?.entities?.[p.id];
            if (!entity) return fail(`Entity "${p.id}" not found`);
            const labels = entity.labels ?? {};
            const descriptions = entity.descriptions ?? {};
            const claims = entity.claims ?? {};
            const sitelinks = entity.sitelinks ?? {};
            return ok({
              id: p.id,
              label: labels.en?.value ?? Object.values(labels)[0]?.value ?? '',
              description: descriptions.en?.value ?? Object.values(descriptions)[0]?.value ?? '',
              type: entity.type ?? '',
              modified: entity.modified ?? '',
              propertyCount: Object.keys(claims).length,
              siteLinkCount: Object.keys(sitelinks).length,
              url: `https://www.wikidata.org/wiki/${p.id}`,
            });
    },
  });
}
