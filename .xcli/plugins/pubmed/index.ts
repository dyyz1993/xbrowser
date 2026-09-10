import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  pmid: z.string(),
  title: z.string(),
  authors: z.string(),
  journal: z.string(),
  pubDate: z.string(),
  doi: z.string(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pubmed',
    url: 'https://pubmed.ncbi.nlm.nih.gov',
    description: 'PubMed - 生物医学文献搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search PubMed articles',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query, e.g. "machine learning cancer"'),
            limit: z.coerce.number().optional().default(20).describe('Max results (1-100)')
    }),
    handler: async (p, _ctx) => {
      const query = encodeURIComponent(p.query);
            const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=${Math.min(p.limit || 20, 100)}&retmode=json`;
            const searchData = await fetchJson(url) as JsonObject;
            const ids: string[] = ((searchData as Record<string, Record<string, string[]>> | undefined)?.esearchresult?.idlist) ?? [];
            if (ids.length === 0) return fail(`No articles matched "${p.query}"`);
            const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
            const summaryData = await fetchJson(summaryUrl) as JsonObject;
            const results = ids.slice(0, p.limit).map((id: string, i: number) => {
              const result = ((summaryData as Record<string, Record<string, Record<string, unknown>>> | undefined)?.result?.[id] ?? {}) as Record<string, unknown>;
              return {
                rank: i + 1,
                pmid: id,
                title: result.title ?? '',
                authors: ((result.authors as Array<{ name?: string }> | undefined) ?? []).slice(0, 3).map((a: { name?: string }) => a.name).join(', '),
                journal: result.fulljournalname ?? result.source ?? '',
                pubDate: result.pubdate ?? '',
                doi: result.elocationid ?? '',
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
              };
            });
            return ok(results);
    },
  });
}
