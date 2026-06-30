import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'spotify',
    url: 'https://open.spotify.com',
    description: 'Spotify - 音乐搜索、专辑信息',
    requiresLogin: false,
  });

  // ─── search — 搜索音乐 ────────────────────────────

  site.command('search', {
    description: '搜索 Spotify 音乐，返回歌曲、艺术家、专辑信息',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      query: z.string().describe('搜索关键词（歌曲名/艺术家/专辑）'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser spotify search --query "Bohemian Rhapsody"', description: '搜索歌曲' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        artist: z.string(),
        album: z.string(),
        duration: z.string(),
        link: z.string(),
        image: z.string(),
      }).passthrough()),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        const url = `https://open.spotify.com/search/${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; artist: string; album: string; duration: string; link: string; image: string }> = [];
          const cards = document.querySelectorAll('[data-testid="search-track-row"], [data-testid="track-row"], [data-testid="herocard"]');
          const rows = cards.length > 0 ? cards : document.querySelectorAll('div[role="row"], div[class*="track"]');
          rows.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector('[data-testid="track-title"], a[class*="title"], [class*="track-name"]');
            const artistEl = card.querySelector('[data-testid="artist-link"], a[class*="artist"], span[class*="artist"]');
            const albumEl = card.querySelector('a[class*="album"], span[class*="album"]');
            const durationEl = card.querySelector('[data-testid="track-duration"], span[class*="duration"]');
            const imageEl = card.querySelector('img[src*="image"], img[class*="cover"]');
            const linkEl = titleEl?.closest('a') || card.querySelector('a[href*="/track/"]');

            items.push({
              title: titleEl?.textContent?.trim() || '',
              artist: artistEl?.textContent?.trim() || '',
              album: albumEl?.textContent?.trim() || '',
              duration: durationEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              image: imageEl instanceof HTMLImageElement ? (imageEl.src || imageEl.getAttribute('data-image') || '') : '',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; artist: string; album: string; duration: string; link: string; image: string }>;

        return ok(
          { query: params.query, count: results.length, results },
          [...tips, `找到 ${results.length} 条结果`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
