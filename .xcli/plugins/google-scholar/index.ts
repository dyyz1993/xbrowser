import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'google-scholar',
    url: 'https://scholar.google.com',
    description: 'Google Scholar search and profile lookup',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Google Scholar articles',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(p.query)}&hl=en&as_sdt=0%2C5`;
            const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
            const results: any[] = [];
            const titleRegex = /<h3 class="gs_rt">[^<]*<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
            const snippetRegex = /<div class="gs_rs">([^<]*)<\/div>/g;
            const authorRegex = /<div class="gs_a">([^<]*)<\/div>/g;
            const titles: string[] = [], links: string[] = [], snippets: string[] = [], authors: string[] = [];
            let m;
            while ((m = titleRegex.exec(html)) !== null) { links.push(m[1]); titles.push(m[2].replace(/<[^>]+>/g, '')); }
            while ((m = snippetRegex.exec(html)) !== null) snippets.push(m[1].trim());
            while ((m = authorRegex.exec(html)) !== null) authors.push(m[1].trim());
            for (let i = 0; i < Math.min(titles.length, p.limit || 20); i++) {
              results.push({
                rank: i + 1,
                title: titles[i] ?? '',
                authors: authors[i] ?? '',
                snippet: snippets[i] ?? '',
                url: links[i] ?? '',
              });
            }
            if (results.length === 0) return fail(`No results for "${p.query}". Google Scholar may require cookies.`);
            return ok(results);
    },
  });
}
