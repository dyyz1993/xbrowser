import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'imdb',
    url: 'https://www.imdb.com',
    description: 'IMDb - 电影电视剧信息',
    requiresLogin: false,
  });

  // ─── 1. search — 搜索影视 ────────────────────────

  site.command('search', {
    description: '搜索 IMDb 电影/电视剧，返回标题、年份、评分、简介',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser imdb search --query "Inception"', description: '搜索电影 Inception' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        year: z.string(),
        rating: z.string(),
        cast: z.string(),
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
        const url = `https://www.imdb.com/find/?q=${encodeURIComponent(params.query)}&ref_=nv_sr_sm`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; year: string; rating: string; cast: string; link: string; image: string }> = [];
          const cards = document.querySelectorAll('.ipc-metadata-list-summary-item, .find-result-item, [data-testid="find-results"] .ipc-metadata-list-summary-item');
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector('.ipc-metadata-list-summary-item__t, a[class*="result-text"], .result-text a');
            const metadataEl = card.querySelector('.ipc-metadata-list-summary-item__li, .ipc-metadata-list-summary-item--with-hero__secondary');
            const ratingEl = card.querySelector('.ipc-rating-star--rating, [class*="rating"]');
            const imageEl = card.querySelector('img[src*="amazon"]');

            items.push({
              title: titleEl?.textContent?.trim() || titleEl?.getAttribute('aria-label') || '',
              year: metadataEl?.textContent?.trim()?.match(/\d{4}/)?.[0] || '',
              rating: ratingEl?.textContent?.trim() || '',
              cast: '',
              link: titleEl instanceof HTMLAnchorElement ? titleEl.href : (titleEl?.closest('a')?.getAttribute('href') ? `https://www.imdb.com${titleEl.closest('a')!.getAttribute('href')}` : ''),
              image: imageEl instanceof HTMLImageElement ? imageEl.src : '',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; year: string; rating: string; cast: string; link: string; image: string }>;

        return ok(
          { query: params.query, count: results.length, results },
          [...tips, `找到 ${results.length} 条结果`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── 2. detail — 影视详情 ─────────────────────────

  site.command('detail', {
    description: '获取 IMDb 电影/电视剧详细信息 — 评分、剧情、演员表',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      url: z.string().describe('IMDb 页面 URL（如 https://www.imdb.com/title/tt1375666/）'),
    }),
    examples: [
      { cmd: 'xbrowser imdb detail --url "https://www.imdb.com/title/tt1375666/"', description: '查看 Inception 详情' },
    ],
    result: z.object({
      title: z.string(),
      year: z.string(),
      rating: z.string(),
      ratingCount: z.string(),
      genres: z.string(),
      plot: z.string(),
      director: z.string(),
      cast: z.array(z.string()),
      image: z.string(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const detail = await page.evaluate(() => {
          const titleEl = document.querySelector('[data-testid="hero__pageTitle"], h1[class*="TitleHeader"], .title_wrapper h1');
          const ratingEl = document.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"], [class*="ratingValue"] span, .ratingValue span');
          const ratingCountEl = document.querySelector('[data-testid="hero-rating-bar__aggregate-rating__count"], [class*="ratingValue"] [class*="total"]');
          const genresEl = document.querySelector('[data-testid="genres"], .subtext a[href*="genre"]');
          const plotEl = document.querySelector('[data-testid="plot-xl"], [data-testid="plot"], .summary_text');
          const directorEl = document.querySelector('[data-testid="title-pc-principal-credit"] a, .credit_summary_item:first-child a');
          const castEls = document.querySelectorAll('[data-testid="title-cast-item"] a[data-testid="title-cast-item__actor"], .cast_list .primary_photo + td a, .cast_list .primary_photo + td + td a');
          const imageEl = document.querySelector('img[data-testid="hero-media__poster"], .poster img, div[class*="Poster"] img');

          const cast: string[] = [];
          castEls.forEach(el => {
            const name = el.textContent?.trim();
            if (name && !cast.includes(name)) cast.push(name);
          });

          return {
            title: titleEl?.textContent?.trim() || titleEl?.getAttribute('title') || '',
            year: document.body.textContent?.match(/(\d{4})\s*[·–—]/)?.[1] || '',
            rating: ratingEl?.textContent?.trim() || '',
            ratingCount: ratingCountEl?.textContent?.trim() || '',
            genres: genresEl?.textContent?.trim().replace(/\s+/g, ' ') || '',
            plot: plotEl?.textContent?.trim() || '',
            director: directorEl?.textContent?.trim() || '',
            cast: cast.slice(0, 10),
            image: imageEl instanceof HTMLImageElement ? imageEl.src : '',
          };
        }) as { title: string; year: string; rating: string; ratingCount: string; genres: string; plot: string; director: string; cast: string[]; image: string };

        return ok(detail, [...tips, `已获取「${detail.title}」详情`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
