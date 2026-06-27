import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'apple-podcasts',
    url: 'https://podcasts.apple.com',
    description: 'Apple Podcasts - 播客搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Apple Podcasts',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(p.query)}&media=podcast&limit=${p.limit || 20}&entity=podcast`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            const results = data?.results ?? [];
            if (results.length === 0) return fail(`No podcasts matched "${p.query}"`);
            return ok(results.slice(0, p.limit).map((r: any, i: number) => ({
              rank: i + 1,
              collectionId: r.collectionId ?? 0,
              collectionName: r.collectionName ?? r.trackName ?? '',
              artistName: r.artistName ?? '',
              genres: (r.genres ?? []).join(', '),
              trackCount: r.trackCount ?? 0,
              url: r.collectionViewUrl ?? '',
              feedUrl: r.feedUrl ?? '',
            })));
    },
  });
  site.command('top', {
    description: 'Get top podcasts from Apple Podcasts',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      country: z.string().optional().default('us').describe('Country code (us, gb, jp, etc.)'),
            genre: z.string().optional().default('0').describe('Genre ID (0=all)'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const genre = p.genre || '0';
            const url = `https://itunes.apple.com/${p.country || 'us'}/rss/toppodcasts/limit=${p.limit || 20}/genre=${genre}/json`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            const feed = data?.feed;
            const results = (feed?.entry ?? feed?.results ?? []).slice(0, p.limit).map((r: any, i: number) => ({
              rank: i + 1,
              id: r.id?.attributes?.['im:id'] ?? r.id?.label ?? r.collectionId ?? '',
              name: r['im:name']?.label ?? r.collectionName ?? r.name ?? '',
              artist: r['im:artist']?.label ?? r.artistName ?? r.artist ?? '',
              image: r['im:image']?.[0]?.label ?? r.artworkUrl100 ?? '',
              summary: r.summary?.label ?? r.description ?? '',
              url: r.id?.label ?? r.collectionViewUrl ?? '',
            }));
            if (results.length === 0) return fail('No podcasts found');
            return ok(results);
    },
  });
}
