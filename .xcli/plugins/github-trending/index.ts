import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'github-trending',
    url: 'https://github.com/trending',
    description: 'GitHub trending repositories',
    requiresLogin: false,
  });
  site.command('repos', {
    description: 'Get trending repositories on GitHub',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      language: z.string().optional().describe('Programming language filter (e.g. "typescript", "python", "rust")'),
            since: z.string().optional().default('daily').describe('Time range: daily, weekly, monthly'),
            limit: z.coerce.number().optional().default(25).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const lang = p.language ? `/${encodeURIComponent(p.language)}` : '';
            const since = p.since || 'daily';
            const url = `https://github.com/trending${lang}?since=${since}`;
            const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
            const results: any[] = [];
            const repoRegex = /<h2[^>]*class="[^"]*h3 lh-condensed[^"]*">[\s\S]*?<a[^>]*href="\/([^"]+)"[^>]*>/g;
            const descRegex = /<p[^>]*class="[^"]*col-9 color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
            const starRegex = /<span[^>]*id="repo-stars-counter-star"[^>]*>([^<]*)<\/span>/g;
            const langRegex = /<span[^>]*itemprop="programmingLanguage"[^>]*>([^<]*)<\/span>/g;
            const repos: string[] = [];
            let m;
            while ((m = repoRegex.exec(html)) !== null) repos.push(m[1].trim());
            const descs = [...html.matchAll(descRegex)].map(mm => mm[1].trim().replace(/<[^>]+>/g, ''));
            const langs = [...html.matchAll(langRegex)].map(mm => mm[1].trim());
            for (let i = 0; i < Math.min(repos.length, p.limit || 25); i++) {
              const parts = repos[i].split('/');
              results.push({
                rank: i + 1,
                author: parts[0] ?? '',
                name: parts[1] ?? '',
                description: descs[i] ?? '',
                language: langs[i] ?? '',
                stars: '(scrape required)',
                url: `https://github.com/${repos[i]}`,
              });
            }
            if (results.length === 0) return fail('No trending repos found');
            return ok(results);
    },
  });
}
