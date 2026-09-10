import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';

const searchResult = z.array(z.object({
  rank: z.number(),
  collectionId: z.number(),
  collectionName: z.string(),
  artistName: z.string(),
  genres: z.string(),
  trackCount: z.number(),
  url: z.string(),
  feedUrl: z.string(),
}));

const topResult = z.array(z.object({
  rank: z.number(),
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  image: z.string(),
  summary: z.string(),
  url: z.string(),
}));


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'apple-podcasts',
    url: 'https://podcasts.apple.com',
    description: 'Apple Podcasts - 播客搜索',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Search Apple Podcasts',
    result: searchResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(p.query)}&media=podcast&limit=${p.limit || 20}&entity=podcast`;
            const data = await fetchJson(url) as JsonObject;
            const results = (data?.results as Record<string, unknown>[] | undefined) ?? [];
            if (results.length === 0) return fail(`No podcasts matched "${p.query}"`);
            interface PodcastRow {
              collectionId?: number;
              collectionName?: string;
              trackName?: string;
              artistName?: string;
              genres?: string[];
              trackCount?: number;
              collectionViewUrl?: string;
              feedUrl?: string;
            }
            return ok(results.slice(0, p.limit).map((r: PodcastRow, i: number) => ({
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
    result: topResult,
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
            const data = await fetchJson(url) as JsonObject;
            const feed = data?.feed;
            const results = (((feed as Record<string, unknown> | undefined)?.entry ?? (feed as Record<string, unknown> | undefined)?.results ?? []) as unknown[]).slice(0, p.limit).map((r: unknown, i: number) => { const rr = r as Record<string, unknown>; return ({
              rank: i + 1,
              id: String(((rr.id as Record<string, Record<string, string>> | undefined)?.attributes?.['im:id'] ?? (rr.id as Record<string, string> | undefined)?.label ?? rr.collectionId) ?? ''),
              name: String((rr['im:name'] as Record<string, string> | undefined)?.label ?? rr.collectionName ?? rr.name ?? ''),
              artist: String((rr['im:artist'] as Record<string, string> | undefined)?.label ?? rr.artistName ?? rr.artist ?? ''),
              image: String(((rr['im:image'] as Array<Record<string, string>> | undefined)?.[0]?.label ?? rr.artworkUrl100) ?? ''),
              summary: String((rr.summary as Record<string, string> | undefined)?.label ?? rr.description ?? ''),
              url: String(((rr.id as Record<string, string> | undefined)?.label ?? rr.collectionViewUrl) ?? ''),
            }); });
            if (results.length === 0) return fail('No podcasts found');
            return ok(results);
    },
  });
}
