import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function(xcli: XCLIAPI): void {
  const steam = xcli.createSite({
    name: 'steam',
    url: 'https://store.steampowered.com',
    description: 'Steam 游戏评论抓取 — 通过 Review API 批量获取所有语言评论',
    requiresLogin: false,
  });

  steam.command('reviews', {
    description: '抓取 Steam 游戏的全部评论（cursor 分页，100/页）',
    scope: 'browser',
    result: z.any(),
    parameters: z.object({
      appId: z.string().describe('Steam app ID，如 3730100'),
      language: z.string().optional().default('all').describe('评论语言过滤，如 all/schinese/english'),
      filter: z.enum(['all', 'recent', 'updated']).optional().default('recent').describe('排序过滤方式'),
      reviewType: z.enum(['all', 'positive', 'negative']).optional().default('all').describe('好评/差评过滤'),
      purchaseType: z.enum(['all', 'steam', 'non_steam_purchase']).optional().default('all').describe('购买渠道过滤'),
      maxReviews: z.number().optional().default(0).describe('最大抓取数量，0=全部'),
      delay: z.number().optional().default(1500).describe('每页间隔(ms)，避免触发限流'),
    }),
    handler: async (params) => {
      const BASE_URL = `https://store.steampowered.com/appreviews/${params.appId}`;

      const { language = 'all', filter = 'recent', reviewType = 'all', purchaseType = 'all', maxReviews = 0, delay = 1500 } = params;

      const buildQuery = (cursor: string) => new URLSearchParams({
        json: '1',
        cursor,
        num_per_page: '100',
        language,
        purchase_type: purchaseType,
        review_type: reviewType,
        filter,
        filter_offtopic_activity: '0',
      });

      const allReviews: Record<string, unknown>[] = [];
      let cursor = '*';
      let page = 0;
      let totalFromApi = 0;

      while (true) {
        page++;
        const url = `${BASE_URL}?${buildQuery(cursor).toString()}`;

        let retries = 3;
        let data: SteamApiResponse | undefined;

        while (retries > 0) {
          try {
            const res = await fetch(url, {
              headers: {
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Cookie': 'wants_mature_content=1; birthtime=864000000; lastagecheckage=1-0-1997',
              },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json() as SteamApiResponse;
            if (data.success !== 1) throw new Error(`API success=${data.success}`);
            break;
          } catch (err) {
            retries--;
            if (retries === 0) {
              const msg = err instanceof Error ? err.message : String(err);
              return { success: false as const, data: null, message: `Page ${page} failed: ${msg}` };
            }
            await sleep(3000);
          }
        }

        if (!data) break;

        const reviews = data.reviews ?? [];
        if (page === 1) totalFromApi = data.query_summary?.total_reviews ?? 0;

        for (const r of reviews) {
          allReviews.push({
            recommendationid: r.recommendationid,
            steamid: r.author?.steamid,
            playtime_forever: r.author?.playtime_forever,
            playtime_at_review: r.author?.playtime_at_review,
            review: r.review,
            language: r.language,
            timestamp_created: r.timestamp_created,
            timestamp_updated: r.timestamp_updated,
            voted_up: r.voted_up,
            votes_up: r.votes_up,
            votes_funny: r.votes_funny,
            weighted_vote_score: r.weighted_vote_score,
            steam_purchase: r.steam_purchase,
            received_for_free: r.received_for_free,
            written_during_early_access: r.written_during_early_access,
            comment_count: r.comment_count,
          });
        }

        const nextCursor = data.cursor ?? '';
        const reached = maxReviews > 0 && allReviews.length >= maxReviews;
        if (reviews.length === 0 || !nextCursor || nextCursor === cursor || reached) break;

        cursor = nextCursor;
        await sleep(delay);
      }

      // Trim if maxReviews set
      const final = maxReviews > 0 ? allReviews.slice(0, maxReviews) : allReviews;
      const positive = final.filter(r => r.voted_up === true).length;
      const negative = final.length - positive;

      // Language breakdown
      const langs: Record<string, number> = {};
      for (const r of final) {
        const lang = (r.language as string) ?? 'unknown';
        langs[lang] = (langs[lang] ?? 0) + 1;
      }

      return ok({
          app_id: params.appId,
          scraped_at: new Date().toISOString(),
          api_total: totalFromApi,
          fetched: final.length,
          positive,
          negative,
          positive_ratio: final.length > 0 ? ((positive / final.length) * 100).toFixed(1) + '%' : 'N/A',
          language_breakdown: Object.entries(langs).sort((a, b) => b[1] - a[1]),
          reviews: final,
        }, [
          `Steam ${params.appId}: 抓取 ${final.length}/${totalFromApi} 条评论`,
          `👍${positive} 👎${negative} (${((positive / final.length) * 100).toFixed(1)}%)`,
          `语言分布: ${Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join(', ')}`,
        ]);
    },

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface SteamApiAuthor {
  steamid: string;
  num_games_owned: number;
  num_reviews: number;
  playtime_forever: number;
  playtime_last_two_weeks: number;
  playtime_at_review: number;
  last_played: number;
}

interface SteamApiReview {
  recommendationid: string;
  author: SteamApiAuthor;
  language: string;
  review: string;
  timestamp_created: number;
  timestamp_updated: number;
  voted_up: boolean;
  votes_up: number;
  votes_funny: number;
  weighted_vote_score: string;
  steam_purchase: boolean;
  received_for_free: boolean;
  written_during_early_access: boolean;
  comment_count: number;
}

interface SteamApiQuerySummary {
  num_reviews: number;
  review_score: number;
  review_score_desc: string;
  total_positive: number;
  total_negative: number;
  total_reviews: number;
}

interface SteamApiResponse {
  success: number;
  query_summary: SteamApiQuerySummary;
  reviews: SteamApiReview[];
  cursor: string;
}
