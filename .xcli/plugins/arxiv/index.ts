import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'arxiv',
    url: 'https://arxiv.org',
    description: 'arXiv - 学术论文预印本搜索和查询',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search arXiv papers by keyword',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(p.query)}&max_results=${p.limit || 20}&sortBy=relevance&sortOrder=descending`;
            const xml = await fetch(url).then(r => r.text());
            const results: any[] = [];
            const entryRegex = /<entry>[\s\S]*?<\/entry>/g;
            let m;
            while ((m = entryRegex.exec(xml)) !== null) {
              const entry = m[0];
              const id = entry.match(/<id>([^<]*)<\/id>/)?.[1] || '';
              const title = entry.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
              const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
              const published = entry.match(/<published>([^<]*)<\/published>/)?.[1]?.slice(0, 10) || '';
              const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/author>/g)].map(a => a[1]).join(', ');
              const link = entry.match(/<link[^>]*href="([^"]*arxiv\.org[^"]*)"[^>]*\/>/)?.[1] || id;
              if (title) results.push({ rank: results.length + 1, id: id.split('/').pop() || '', title, authors, summary: summary.slice(0, 300), published, url: link });
            }
            if (results.length === 0) return fail(`No papers matched "${p.query}"`);
            return ok(results.slice(0, p.limit));
    },
  });
  site.command('paper', {
    description: 'Get arXiv paper details by ID',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      id: z.string().describe('arXiv paper ID (e.g. "2101.00001")')
    }),
    handler: async (p, ctx) => {
      const url = `https://export.arxiv.org/api/query?id_list=${p.id}`;
            const xml = await fetch(url).then(r => r.text());
            const entry = xml.match(/<entry>[\s\S]*?<\/entry>/)?.[0];
            if (!entry) return fail(`Paper "${p.id}" not found`);
            const id = entry.match(/<id>([^<]*)<\/id>/)?.[1] || '';
            const title = entry.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
            const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
            const published = entry.match(/<published>([^<]*)<\/published>/)?.[1]?.slice(0, 10) || '';
            const updated = entry.match(/<updated>([^<]*)<\/updated>/)?.[1]?.slice(0, 10) || '';
            const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/author>/g)].map(a => a[1]).join(', ');
            const categories = [...entry.matchAll(/<category[^>]*term="([^"]*)"[^>]*\/?>/g)].map(c => c[1]).join(', ');
            const link = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] || '';
            const pdf = entry.match(/<link[^>]*href="([^"]*\.pdf)"[^>]*\/>/)?.[1] || '';
            return ok({ id: p.id, title, authors, summary, published, updated, categories, link, pdf });
    },
  });
  site.command('recent', {
    description: 'Get recent arXiv papers by category',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      category: z.string().optional().default('cs.AI').describe('arXiv category (e.g. cs.AI, math.ST, physics)'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, ctx) => {
      const cat = p.category || 'cs.AI';
            const url = `https://export.arxiv.org/api/query?search_query=cat:${cat}&max_results=${p.limit || 20}&sortBy=submittedDate&sortOrder=descending`;
            const xml = await fetch(url).then(r => r.text());
            const results: any[] = [];
            const entryRegex = /<entry>[\s\S]*?<\/entry>/g;
            let m;
            while ((m = entryRegex.exec(xml)) !== null) {
              const entry = m[0];
              const id = entry.match(/<id>([^<]*)<\/id>/)?.[1] || '';
              const title = entry.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || '';
              const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/author>/g)].map(a => a[1]).join(', ');
              const published = entry.match(/<published>([^<]*)<\/published>/)?.[1]?.slice(0, 10) || '';
              if (title) results.push({ rank: results.length + 1, id: id.split('/').pop() || '', title, authors, published });
            }
            if (results.length === 0) return fail(`No recent papers in category "${cat}"`);
            return ok(results.slice(0, p.limit));
    },
  });
}
