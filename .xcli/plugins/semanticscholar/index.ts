import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'semanticscholar',
    url: 'https://www.semanticscholar.org',
    description: 'Semantic Scholar - 学术论文搜索引擎',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Semantic Scholar papers',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(p.query)}&limit=${p.limit || 20}&fields=title,authors,year,externalIds,citationCount,openAccessPdf`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            const papers = data?.data ?? [];
            if (papers.length === 0) return fail(`No papers matched "${p.query}"`);
            return ok(papers.slice(0, p.limit).map((paper: any, i: number) => ({
              rank: i + 1,
              paperId: paper.paperId ?? '',
              title: paper.title ?? '',
              year: paper.year ?? '',
              authors: (paper.authors ?? []).slice(0, 3).map((a: any) => a.name).join(', '),
              citationCount: paper.citationCount ?? 0,
              url: paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : `https://www.semanticscholar.org/paper/${paper.paperId}`,
            })));
    },
  });
}
