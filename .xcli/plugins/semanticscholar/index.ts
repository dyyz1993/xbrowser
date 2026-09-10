import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const searchResult = z.array(z.object({
  rank: z.number(),
  paperId: z.string(),
  title: z.string(),
  year: z.number(),
  authors: z.string(),
  citationCount: z.number(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'semanticscholar',
    url: 'https://www.semanticscholar.org',
    description: 'Semantic Scholar - 学术论文搜索引擎',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Semantic Scholar papers',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(p.query)}&limit=${p.limit || 20}&fields=title,authors,year,externalIds,citationCount,openAccessPdf`;
            const data = await fetchJson(url) as JsonObject;
            const papers = (data?.data as Record<string, unknown>[] | undefined) ?? [];
            if (papers.length === 0) return fail(`No papers matched "${p.query}"`);
            interface PaperRow { paperId?: string; title?: string; year?: number; authors?: Array<{ name?: string }>; citationCount?: number; externalIds?: { DOI?: string } }
            return ok(papers.slice(0, p.limit).map((paper: PaperRow, i: number) => ({
              rank: i + 1,
              paperId: paper.paperId ?? '',
              title: paper.title ?? '',
              year: paper.year ?? '',
              authors: (paper.authors ?? []).slice(0, 3).map((a: { name?: string }) => a.name).join(', '),
              citationCount: paper.citationCount ?? 0,
              url: paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : `https://www.semanticscholar.org/paper/${paper.paperId}`,
            })));
    },
  });
}
