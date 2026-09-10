import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';

/** HN API item shape (top/new/best/ask stories share this form). */
interface HnItem {
  id?: number;
  title?: string;
  score?: number;
  by?: string;
  descendants?: number;
  url?: string;
  time?: number;
  text?: string;
}


const storiesResult = z.array(z.object({
  rank: z.number(),
  id: z.number(),
  title: z.string(),
  score: z.number(),
  author: z.string(),
  comments: z.number(),
  url: z.string(),
}));

const readResult = z.object({
  id: z.number(),
  title: z.string(),
  text: z.string(),
  score: z.number(),
  author: z.string(),
  comments: z.number(),
  url: z.string(),
  type: z.string(),
});

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'hackernews',
    url: 'https://news.ycombinator.com',
    description: 'Hacker News stories, comments, and user info',
    requiresLogin: false,
  });
  site.command('top', {
    description: 'Hacker News top stories',
    result: storiesResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = (await Promise.all(
              ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
            )) as HnItem[];
            const results = items
              .filter((item: { title?: unknown; deleted?: unknown; dead?: unknown }) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: HnItem, i: number) => ({
                rank: i + 1,
                id: item.id,
                title: item.title,
                score: item.score,
                author: item.by,
                comments: item.descendants ?? 0,
                url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
              }));
            return ok(results);
    },
  });
  site.command('new', {
    description: 'Hacker News new stories',
    result: storiesResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const newIds = await fetchJson('https://hacker-news.firebaseio.com/v0/newstories.json');
            const ids = (newIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = (await Promise.all(
              ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
            )) as HnItem[];
            const results = items
              .filter((item: { title?: unknown; deleted?: unknown; dead?: unknown }) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: HnItem, i: number) => ({
                rank: i + 1,
                id: item.id,
                title: item.title,
                score: item.score,
                author: item.by,
                comments: item.descendants ?? 0,
                url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
              }));
            return ok(results);
    },
  });
  site.command('best', {
    description: 'Hacker News best stories',
    result: storiesResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const bestIds = await fetchJson('https://hacker-news.firebaseio.com/v0/beststories.json');
            const ids = (bestIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = (await Promise.all(
              ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
            )) as HnItem[];
            const results = items
              .filter((item: { title?: unknown; deleted?: unknown; dead?: unknown }) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: HnItem, i: number) => ({
                rank: i + 1,
                id: item.id,
                title: item.title,
                score: item.score,
                author: item.by,
                comments: item.descendants ?? 0,
                url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
              }));
            return ok(results);
    },
  });
  site.command('ask', {
    description: 'Hacker News Ask HN stories',
    result: storiesResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetchJson('https://hacker-news.firebaseio.com/v0/askstories.json');
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = (await Promise.all(
              ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
            )) as HnItem[];
            const results = items
              .filter((item: { title?: unknown; deleted?: unknown; dead?: unknown }) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: HnItem, i: number) => ({
                rank: i + 1,
                id: item.id,
                title: item.title,
                score: item.score,
                author: item.by,
                comments: item.descendants ?? 0,
                url: `https://news.ycombinator.com/item?id=${item.id}`,
              }));
            return ok(results);
    },
  });
  site.command('show', {
    description: 'Hacker News Show HN stories',
    result: storiesResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetchJson('https://hacker-news.firebaseio.com/v0/showstories.json');
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = (await Promise.all(
              ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
            )) as HnItem[];
            const results = items
              .filter((item: { title?: unknown; deleted?: unknown; dead?: unknown }) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: HnItem, i: number) => ({
                rank: i + 1,
                id: item.id,
                title: item.title,
                score: item.score,
                author: item.by,
                comments: item.descendants ?? 0,
                url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
              }));
            return ok(results);
    },
  });
  site.command('jobs', {
    description: 'Hacker News job stories',
    result: storiesResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetchJson('https://hacker-news.firebaseio.com/v0/jobstories.json');
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = (await Promise.all(
              ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
            )) as HnItem[];
            const results = items
              .filter((item: { title?: unknown; deleted?: unknown; dead?: unknown }) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: HnItem, i: number) => ({
                rank: i + 1,
                id: item.id,
                title: item.title,
                score: item.score,
                author: item.by,
                comments: item.descendants ?? 0,
                url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
              }));
            return ok(results);
    },
  });
  site.command('search', {
    description: 'Search Hacker News stories by keyword (via Algolia)',
    result: storiesResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Number of results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(p.query)}&hitsPerPage=${p.limit || 20}`;
            const data = await fetchJson(url) as JsonObject;
            const hits = ((data as Record<string, unknown>).hits as unknown[] | undefined) || [];
            const results = (hits as Record<string, unknown>[]).map((hit: { objectID?: string | number; title?: string; points?: number; author?: string; num_comments?: number; url?: string; story_url?: string }, i: number) => ({
              rank: i + 1,
              id: hit.objectID,
              title: hit.title,
              score: hit.points,
              author: hit.author,
              comments: hit.num_comments,
              url: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            }));
            return ok(results);
    },
  });
  site.command('read', {
    description: 'Read a Hacker News story/item by ID',
    result: readResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      id: z.coerce.number().describe('Item ID')
    }),
    handler: async (p, _ctx) => {
      const item = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${p.id}.json`) as JsonObject;
            if (!item) return fail(`Item ${p.id} not found`);
            return ok({
              id: item.id,
              title: item.title,
              text: item.text || '(no text)',
              score: item.score,
              author: item.by,
              comments: item.descendants ?? 0,
              url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
              type: item.type,
            });
    },
  });
}
