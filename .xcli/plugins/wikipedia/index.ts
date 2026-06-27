import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'wikipedia',
    url: 'https://en.wikipedia.org',
    description: 'Wikipedia page search and summaries',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Wikipedia articles',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search query'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(p.query)}&format=json&srlimit=${p.limit || 20}`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            const results = (data.query?.search ?? []).map((r: any, i: number) => ({
              rank: i + 1,
              title: r.title ?? '',
              snippet: r.snippet?.replace(/<[^>]+>/g, '') ?? '',
              pageId: r.pageid ?? 0,
              wordCount: r.wordcount ?? 0,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
            }));
            if (results.length === 0) return fail(`No Wikipedia articles matched "${p.query}"`);
            return ok(results);
    },
  });
  site.command('summary', {
    description: 'Get Wikipedia article summary',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      title: z.string().describe('Page title')
    }),
    handler: async (p, _ctx) => {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.title)}`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            if (data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') return fail(`Page "${p.title}" not found`);
            return ok({
              title: data.title ?? p.title,
              extract: data.extract ?? '',
              description: data.description ?? '',
              thumbnail: data.thumbnail?.source ?? '',
              pageId: data.pageid ?? 0,
              url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
            });
    },
  });
  site.command('page', {
    description: 'Get full Wikipedia page content',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      title: z.string().describe('Page title')
    }),
    handler: async (p, _ctx) => {
      const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(p.title)}&format=json&prop=text&section=0`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            if (data.error) return fail(`Error: ${data.error.info}`);
            const text = (data.parse?.text?.['*'] ?? '').replace(/<[^>]+>/g, '').trim();
            return ok({
              title: data.parse?.title ?? p.title,
              text: text.slice(0, 5000) + (text.length > 5000 ? '...' : ''),
              pageId: data.parse?.pageid ?? 0,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
            });
    },
  });
  site.command('random', {
    description: 'Get random Wikipedia article summary',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({}),
    handler: async (_p, _ctx) => {
      const data = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary').then(r => r.json()) as JsonObject;
            return ok({
              title: data.title ?? '',
              extract: data.extract ?? '',
              description: data.description ?? '',
              thumbnail: data.thumbnail?.source ?? '',
              pageId: data.pageid ?? 0,
              url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent((data.title ?? '').replace(/ /g, '_'))}`,
            });
    },
  });
  site.command('trending', {
    description: 'Get most viewed Wikipedia articles for a given day',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      year: z.coerce.number().optional().describe('Year (default: today)'),
            month: z.coerce.number().optional().describe('Month 1-12 (default: today)'),
            day: z.coerce.number().optional().describe('Day 1-31 (default: today)'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const today = new Date();
            const year = p.year ?? today.getFullYear();
            const month = String(p.month ?? (today.getMonth() + 1)).padStart(2, '0');
            const day = String(p.day ?? today.getDate()).padStart(2, '0');
            const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access/${year}/${month}/${day}`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            const articles = data.items?.[0]?.articles ?? [];
            const results = articles.slice(0, p.limit || 20).map((a: any, i: number) => ({
              rank: i + 1,
              title: a.article ?? '',
              views: a.views ?? 0,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent((a.article ?? '').replace(/ /g, '_'))}`,
            }));
            if (results.length === 0) return fail('No trending articles found');
            return ok(results);
    },
  });
}
