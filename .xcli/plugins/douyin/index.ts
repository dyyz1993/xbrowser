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

  return {
    awemeId: s(item.aweme_id),
    desc: s(item.desc),
    createTime: ct,
    createTimeStr: new Date(ct * 1000).toISOString().replace('T', ' ').slice(0, 19),
    author: {
      uid: s(auth.uid),
      nickname: s(auth.nickname),
      avatar: firstUrl(auth.avatar_thumb),
    },
    video: {
      playUrl: firstUrl(vid.play_addr),
      cover: firstUrl(vid.cover),
      width: n(vid.width),
      height: n(vid.height),
      duration: n(vid.duration),
    },
    statistics: {
      diggCount: n(stats.digg_count),
      commentCount: n(stats.comment_count),
      shareCount: n(stats.share_count),
      playCount: n(stats.play_count),
    },
    tagNames: tags,
  };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'douyin',
    url: 'https://www.douyin.com',
    description: '抖音页面数据提取（DOM 方式）',
  });

  site.command('ai-summary', {
    description: '提取 AI 章节摘要',
    scope: 'page',
    parameters: z.object({
      url: z.string().describe('用户主页 URL'),
      awemeId: z.string().describe('视频 ID'),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const separator = params.url.includes('?') ? '&' : '?';
      await page.goto(`${params.url}${separator}modal_id=${params.awemeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(6000);

      const data = await page.evaluate(() => {
        const modal = document.querySelector('.h1_b8gRO');
        if (!modal) return null;

        const summaryEl = modal.querySelector('.MpmPRgoY');
        const summary = summaryEl?.textContent?.trim() || '';

        const chapters: Array<{ time: string; title: string; content: string }> = [];
        const items = modal.querySelectorAll('.hFZ217ag');
        items.forEach((item) => {
          const raw = item.textContent || '';
          const m = raw.match(/^(\d{2}:\d{2})/);
          if (!m) return;
          const time = m[1];
          const title = raw.replace(/^\d{2}:\d{2}/, '').trim();
          const parent = item.closest('.npgJCnD2');
          const contentEl = parent?.querySelector('.qpDu5nGx');
          chapters.push({ time, title, content: contentEl?.textContent?.trim() || '' });
        });

        return { summary, chapters };
      });

      if (!data) throw new Error('未找到 AI 章节摘要');
      return { awemeId: params.awemeId, ...data };
    },
  });

  site.command('user-info', {
    description: '从用户主页提取用户资料（DOM）',
    scope: 'page',
    parameters: z.object({
      url: z.string().describe('用户主页 URL'),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

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

      return userInfo;
    },
  });

  site.command('video-info', {
    description: '从视频页面提取视频信息（DOM）',
    scope: 'page',
    parameters: z.object({
      awemeId: z.string().describe('视频 ID'),
    }),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

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
        const collectCount =
          document.querySelector('[class*="collect"] [class*="count"]')?.textContent?.trim() ||
          '';
        const shareCount =
          document.querySelector('[class*="share"] [class*="count"]')?.textContent?.trim() || '';

        return { desc, author, likeCount, commentCount, collectCount, shareCount };
      });

      return info;
    },
  });
}
