import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';

function n(v: unknown): number {
  return Number(v ?? 0);
}

function s(v: unknown): string {
  return String(v ?? '');
}

function firstUrl(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const urls = (obj as Record<string, unknown>)?.url_list;
  if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0];
  return '';
}

function g(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function parseVideo(item: Record<string, unknown>) {
  const ct = n(item.create_time);
  const stats = (item.statistics ?? {}) as Record<string, unknown>;
  const vid = (item.video ?? {}) as Record<string, unknown>;
  const auth = (item.author ?? {}) as Record<string, unknown>;
  const tags = Array.isArray(item.text_extra)
    ? item.text_extra.map((t: unknown) => s(g(t, 'hashtag_name'))).filter(Boolean)
    : [];

  const bitRates = Array.isArray(vid.bit_rate)
    ? vid.bit_rate.map((br: unknown) => {
        const b = br as Record<string, unknown>;
        return {
          gearName: s(b.gear_name),
          qualityType: n(b.quality_type),
          playAddr: firstUrl(b.play_addr),
          size: n(b.play_addr ? (b.play_addr as Record<string, unknown>).data_size : 0),
        };
      })
    : [];

  return {
    awemeId: s(item.aweme_id),
    desc: s(item.desc),
    createTime: ct,
    createTimeStr: ct > 0 ? new Date(ct * 1000).toISOString().replace('T', ' ').slice(0, 19) : '',
    author: {
      uid: s(auth.uid),
      nickname: s(auth.nickname),
    },
    video: {
      playUrl: firstUrl(vid.play_addr),
      cover: firstUrl(vid.cover),
      width: n(vid.width),
      height: n(vid.height),
      duration: n(vid.duration),
      bitRates,
    },
    statistics: {
      diggCount: n(stats.digg_count),
      commentCount: n(stats.comment_count),
      shareCount: n(stats.share_count),
      collectCount: n(stats.collect_count),
      playCount: n(stats.play_count),
    },
    tagNames: tags,
  };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'douyin',
    url: 'https://www.douyin.com',
    description: '抖音数据采集',
  });

  site.command('videos', {
    description: '采集用户作品列表（网络拦截）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('用户主页 URL'),
      maxPages: z.number().default(5).describe('最大滚动次数'),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright-core').Page;
      if (!page) throw new Error('需要浏览器页面');

      const maxPages = (params.maxPages as number) || 5;
      const allAwemes: Record<string, unknown>[] = [];
      const seenIds = new Set<string>();

      page.on('response', async (response) => {
        const url = response.url();
        if (!url.includes('/aweme/v1/web/aweme/post/')) return;

        try {
          const json = await response.json();
          const awemeList = (json as Record<string, unknown>)?.aweme_list;
          if (!Array.isArray(awemeList)) return;

          for (const item of awemeList) {
            const id = s((item as Record<string, unknown>).aweme_id);
            if (!id || seenIds.has(id)) continue;
            seenIds.add(id);
            allAwemes.push(item as Record<string, unknown>);
          }
        } catch {
          // ignore
        }
      });

      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);

      let lastCount = allAwemes.length;
      let noNewCount = 0;

      for (let i = 0; i < maxPages; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2500);

        const currentCount = allAwemes.length;
        if (currentCount === lastCount) {
          noNewCount++;
        } else {
          noNewCount = 0;
          lastCount = currentCount;
        }

        if (noNewCount >= 3) break;
      }

      return {
        data: { total: allAwemes.length, videos: allAwemes.map(parseVideo) },
        tips: [`采集到 ${allAwemes.length} 个作品`],
      };
    },
  });

  site.command('profile', {
    description: '获取用户资料',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('用户主页 URL'),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright-core').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      const userInfo = await page.evaluate(() => {
        const nickname =
          document.querySelector('[class*="nickname"]')?.textContent?.trim() || '';
        const signature =
          document.querySelector('[class*="signature"]')?.textContent?.trim() || '';
        const stats: Record<string, string> = {};
        document.querySelectorAll('[class*="count"]').forEach((el) => {
          const label = el.previousElementSibling?.textContent?.trim() || '';
          if (label) stats[label] = el.textContent?.trim() || '';
        });
        return { nickname, signature, stats };
      });

      return {
        data: userInfo,
        tips: [`用户: ${userInfo.nickname}`],
      };
    },
  });

  site.command('detail', {
    description: '获取视频详情（DOM）',
    scope: 'browser',
    parameters: z.object({
      awemeId: z.string().describe('视频 ID'),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright-core').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto(`https://www.douyin.com/video/${params.awemeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(5000);

      const info = await page.evaluate(() => {
        const desc =
          document.querySelector('[class*="desc"]')?.textContent?.trim() || '';
        const author =
          document.querySelector('[class*="nickname"]')?.textContent?.trim() || '';
        const likeCount =
          document.querySelector('[class*="like"] [class*="count"]')?.textContent?.trim() ||
          '';
        const commentCount =
          document.querySelector('[class*="comment"] [class*="count"]')?.textContent?.trim() ||
          '';

        return { desc, author, likeCount, commentCount };
      });

      return {
        data: { awemeId: params.awemeId, ...info },
        tips: [`视频: ${info.desc?.slice(0, 50)}`],
      };
    },
  });
}
