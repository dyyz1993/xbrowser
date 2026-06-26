import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'pubmed',
    url: 'https://pubmed.ncbi.nlm.nih.gov',
    description: 'PubMed - 生物医学文献搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search PubMed articles',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query, e.g. "machine learning cancer"'),
            limit: z.coerce.number().optional().default(20).describe('Max results (1-100)')
    }),
    handler: async (p, ctx) => {
      const query = encodeURIComponent(p.query);
            const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=${Math.min(p.limit || 20, 100)}&retmode=json`;
            const searchData = await fetch(url).then(r => r.json()) as any;
            const ids = searchData?.esearchresult?.idlist ?? [];
            if (ids.length === 0) return fail(`No articles matched "${p.query}"`);
            const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
            const summaryData = await fetch(summaryUrl).then(r => r.json()) as any;
            const results = ids.slice(0, p.limit).map((id: string, i: number) => {
              const result = summaryData?.result?.[id] ?? {};
              return {
                rank: i + 1,
                pmid: id,
                title: result.title ?? '',
                authors: (result.authors ?? []).slice(0, 3).map((a: any) => a.name).join(', '),
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
