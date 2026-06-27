import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'hackernews',
    url: 'https://news.ycombinator.com',
    description: 'Hacker News stories, comments, and user info',
    requiresLogin: false,
  });
  site.command('top', {
    description: 'Hacker News top stories',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json').then(r => r.json());
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = await Promise.all(
              ids.map((id: number) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
            );
            const results = items
              .filter((item: any) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const newIds = await fetch('https://hacker-news.firebaseio.com/v0/newstories.json').then(r => r.json());
            const ids = (newIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = await Promise.all(
              ids.map((id: number) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
            );
            const results = items
              .filter((item: any) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const bestIds = await fetch('https://hacker-news.firebaseio.com/v0/beststories.json').then(r => r.json());
            const ids = (bestIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = await Promise.all(
              ids.map((id: number) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
            );
            const results = items
              .filter((item: any) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetch('https://hacker-news.firebaseio.com/v0/askstories.json').then(r => r.json());
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = await Promise.all(
              ids.map((id: number) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
            );
            const results = items
              .filter((item: any) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetch('https://hacker-news.firebaseio.com/v0/showstories.json').then(r => r.json());
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = await Promise.all(
              ids.map((id: number) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
            );
            const results = items
              .filter((item: any) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('Number of stories')
    }),
    handler: async (p, _ctx) => {
      const topIds = await fetch('https://hacker-news.firebaseio.com/v0/jobstories.json').then(r => r.json());
            const ids = (topIds as number[]).slice(0, Math.min((p.limit || 20) + 10, 50));
            const items = await Promise.all(
              ids.map((id: number) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
            );
            const results = items
              .filter((item: any) => item && item.title && !item.deleted && !item.dead)
              .slice(0, p.limit)
              .map((item: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Number of results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(p.query)}&hitsPerPage=${p.limit || 20}`;
            const data = await fetch(url).then(r => r.json()) as JsonObject;
            const hits = data.hits || [];
            const results = hits.map((hit: any, i: number) => ({
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
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      id: z.coerce.number().describe('Item ID')
    }),
    handler: async (p, _ctx) => {
      const item = await fetch(`https://hacker-news.firebaseio.com/v0/item/${p.id}.json`).then(r => r.json()) as JsonObject;
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
