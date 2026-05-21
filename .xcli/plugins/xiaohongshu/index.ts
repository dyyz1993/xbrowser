import type { XCLIAPI, ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import { detectSsr } from '../shared/ssr-detect.js';

type Page = import('playwright-core').Page;
type Response = import('playwright-core').Response;

const XHS_BASE = 'https://www.xiaohongshu.com';
const API = {
  FEED: '/api/sns/web/v1/feed',
  USER_POSTED: '/api/sns/web/v1/user_posted',
  COMMENT_PAGE: '/api/sns/web/v2/comment/page',
  USER_INFO: '/api/sns/web/v1/user/otherinfo',
  SEARCH_NOTES: '/api/sns/web/v1/search/notes',
  HOME_FEED: '/api/sns/web/v1/homefeed',
} as const;

function n(v: unknown): number { return Number(v ?? 0); }
function s(v: unknown): string { return String(v ?? ''); }

function g(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function formatTime(ts: number): string {
  if (ts <= 0) return '';
  const d = new Date(ts);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseNote(item: Record<string, unknown>) {
  const nc = (item.note_card || item) as Record<string, unknown>;
  const inter = ((nc.interact_info ?? {}) || {}) as Record<string, unknown>;
  const user = ((nc.user ?? {}) || {}) as Record<string, unknown>;
  const cover = (nc.cover ?? {}) as Record<string, unknown>;
  const images = Array.isArray(nc.image_list)
    ? nc.image_list.map((img: unknown) => { const i = img as Record<string, unknown>; return s(i.url_default || i.url); })
    : [];
  const video = nc.video;
  const videoUrl = video && typeof video === 'object' ? s((video as Record<string, unknown>).url) : '';
  const tags = Array.isArray(nc.tag_list) ? nc.tag_list.map((t: unknown) => s((t as Record<string, unknown>).name)) : [];
  return {
    noteId: s(nc.note_id), type: s(nc.type), title: s(nc.title), desc: s(nc.desc),
    cover: s(cover.url_default || cover.url), images, videoUrl,
    author: { userId: s(user.user_id), nickname: s(user.nickname), avatar: s(user.avatar || '') },
    statistics: {
      likedCount: s(inter.liked_count), collectedCount: s(inter.collected_count),
      commentCount: s(inter.comment_count), shareCount: s(inter.share_count),
    },
    tags, time: n(nc.time), lastUpdateTime: n(nc.last_update_time),
  };
}

function parseComment(item: Record<string, unknown>) {
  const ui = (item.user_info ?? {}) as Record<string, unknown>;
  const ct = n(item.create_time);
  return {
    id: s(item.id || item.comment_id), content: s(item.content),
    author: { userId: s(ui.user_id || ''), nickname: s(ui.nickname || ''), avatar: s(ui.image || '') },
    likedCount: n(item.like_count || item.liked_count),
    subCommentCount: n(item.sub_comment_count || item.sub_comment_total),
    ipLocation: s(item.ip_location), createTime: ct, createTimeStr: formatTime(ct),
  };
}

function parseUser(data: Record<string, unknown>) {
  const user = ((data as Record<string, unknown>).user ?? data) as Record<string, unknown>;
  return {
    userId: s(user.user_id), nickname: s(user.nickname), redId: s(user.red_id || user.xhsId),
    avatar: s(user.image), desc: s(user.desc), gender: s(user.gender), ipLocation: s(user.ip_location),
    tags: Array.isArray(user.tag) ? user.tag.map((t: unknown) => s((t as Record<string, unknown>).name || t)) : [],
    statistics: { notes: n(user.notes), fans: n(user.fans), following: n(user.follows), interaction: n(user.interaction) },
  };
}

function parseNoteBrief(item: Record<string, unknown>) {
  const nc = ((item.note_card ?? item) ?? {}) as Record<string, unknown>;
  const user = ((nc.user ?? {}) || {}) as Record<string, unknown>;
  const inter = ((nc.interact_info ?? {}) || {}) as Record<string, unknown>;
  const cover = (nc.cover ?? {}) as Record<string, unknown>;
  return {
    noteId: s(nc.note_id || item.id), type: s(nc.type),
    title: s(nc.title || nc.display_title), cover: s(cover.url_default || cover.url || ''),
    author: { userId: s(user.user_id), nickname: s(user.nickname) },
    likedCount: s(inter.liked_count),
  };
}

interface Interceptor { items: () => Record<string, unknown>[]; dispose: () => void }

function interceptApi(page: Page, urlPattern: string, dataKey: string, idKey: string): Interceptor {
  const items: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  const handler = async (response: Response) => {
    if (!response.url().includes(urlPattern)) return;
    try {
      const json = await response.json();
      const root = (json as Record<string, unknown>)?.data;
      if ((json as Record<string, unknown>)?.success === false) {
        if (process.env.DEBUG) console.warn('[xhs] API returned success=false for', urlPattern);
        return;
      }
      if (!root) return;
      const list = (root as Record<string, unknown>)?.[dataKey];
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const id = s(g(item, idKey));
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        items.push(item as Record<string, unknown>);
      }
    } catch (err) {
      if (process.env.DEBUG) console.warn('[xhs] interceptApi parse error:', (err as Error)?.message);
    }
  };
  page.on('response', handler);
  return { items: () => items, dispose: () => page.off('response', handler) };
}

function interceptFirst<T>(page: Page, urlPattern: string, extractor: (json: unknown) => T | null) {
  let result: T | null = null;
  const handler = async (response: Response) => {
    if (result || !response.url().includes(urlPattern)) return;
    try {
      const json = await response.json();
      if ((json as Record<string, unknown>)?.success === false) {
        if (process.env.DEBUG) console.warn('[xhs] API returned success=false for', urlPattern);
        return;
      }
      const extracted = extractor(json);
      if (extracted) result = extracted;
    } catch (err) {
      if (process.env.DEBUG) console.warn('[xhs] interceptFirst parse error:', (err as Error)?.message);
    }
  };
  page.on('response', handler);
  return { get: () => result, dispose: () => page.off('response', handler) };
}

type WaitForHumanFn = (opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>;

async function scrollAndCollect(
  page: Page, maxPages: number, getItemCount: () => number,
  opts: { delay?: number; staleThreshold?: number; waitForHuman?: WaitForHumanFn } = {},
) {
  const { delay = 2500, staleThreshold = 3, waitForHuman } = opts;
  let lastCount = getItemCount(), staleCount = 0;
  for (let i = 0; i < maxPages; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(delay + Math.random() * 1000);
    const cur = getItemCount();
    if (cur === 0 && lastCount === 0 && i >= 1 && waitForHuman) {
      await waitForHuman({ reason: '小红书可能需要验证，请在浏览器中完成滑块验证', timeout: 120 });
    }
    if (cur === lastCount) staleCount++; else { staleCount = 0; lastCount = cur; }
    if (staleCount >= staleThreshold) break;
  }
}

async function waitForInterceptor<T>(getter: () => T | null, maxMs = 10000): Promise<T | null> {
  for (let w = 0; w < maxMs / 500; w++) {
    const r = getter();
    if (r) return r;
    await new Promise<void>(res => setTimeout(res, 500));
  }
  return getter();
}

async function dismissModals(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('[class*="login-layer"], [class*="mask"], [class*="overlay"]').forEach((el) => {
      if (el instanceof HTMLElement) el.style.display = 'none';
    });
    document.body.style.overflow = '';
  });
}

function buildCtxTips(ctx: Record<string, unknown>): string[] {
  const tips: string[] = [];
  if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
  tips.push(`Session: ${ctx.sessionId || 'default'}`);
  return tips;
}

function errResult(message: string, tips: string[]) {
    return ok(null, []);

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({ name: 'xiaohongshu', url: XHS_BASE, description: '小红书数据采集' });

  site.command('detail', {
    description: '获取笔记详情（API 拦截）',
    scope: 'browser',
    parameters: z.object({ noteId: z.string().describe('笔记 ID') }),
    examples: [{ cmd: 'xbrowser xiaohongshu detail --noteId "67xxxxxxxxxxxxxx"', description: '获取笔记详情' }],
    result: z.any(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);
        const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as WaitForHumanFn | undefined;
        const interceptor = interceptFirst<Record<string, unknown>>(page, API.FEED, (json) => {
          const data = (json as Record<string, unknown>)?.data;
          if (!data || typeof data !== 'object') return null;
          const items = (data as Record<string, unknown>)?.items;
          if (!Array.isArray(items) || items.length === 0) return null;
          return items[0] as Record<string, unknown>;
        });
        try {
          await page.goto(`${XHS_BASE}/explore/${params.noteId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await dismissModals(page);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          let raw = await waitForInterceptor(interceptor.get);
          if (!raw && waitForHuman) {
            await waitForHuman({ reason: '小红书笔记详情加载失败，可能需要登录或验证', timeout: 120 });
            raw = await waitForInterceptor(interceptor.get, 5000);
          }
          if (!raw) return { data: null, tips: [...tips, '未获取到笔记数据，可能笔记不存在或需要登录'] };
          const note = parseNote(raw);
          tips.push(`笔记: ${note.title?.slice(0, 50) || note.desc?.slice(0, 50)}`);
    return ok(note, []);
      } catch (error) { return errResult(error instanceof Error ? error.message : '未知错误', ['获取笔记详情失败']); }
    },
  });

  site.command('notes', {
    description: '采集用户笔记列表（API 拦截）',
    scope: 'browser',
    parameters: z.object({ userId: z.string().describe('用户 ID'), maxPages: z.number().default(5).describe('最大滚动次数') }),
    examples: [{ cmd: 'xbrowser xiaohongshu notes --userId "5xxxxxxxxxxxx"', description: '采集用户笔记' }],
    result: z.any(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);
        const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as WaitForHumanFn | undefined;
        const interceptor = interceptApi(page, API.USER_POSTED, 'notes', 'note_id');
        try {
          await page.goto(`${XHS_BASE}/user/profile/${params.userId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await dismissModals(page);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          await scrollAndCollect(page, params.maxPages || 5, () => interceptor.items().length, { waitForHuman });
          const notes = interceptor.items().map(parseNote);
          tips.push(`采集到 ${notes.length} 条笔记`);
    return ok({ total: notes.length, []);
      } catch (error) { return errResult(error instanceof Error ? error.message : '未知错误', ['采集用户笔记失败']); }
    },
  });

  site.command('profile', {
    description: '获取用户资料（API 拦截 + DOM 兜底）',
    scope: 'browser',
    parameters: z.object({ userId: z.string().describe('用户 ID') }),
    examples: [{ cmd: 'xbrowser xiaohongshu profile --userId "5xxxxxxxxxxxx"', description: '获取用户资料' }],
    result: z.any(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);
        const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as WaitForHumanFn | undefined;
        const interceptor = interceptFirst<Record<string, unknown>>(page, API.USER_INFO, (json) => {
          const data = (json as Record<string, unknown>)?.data;
          return data && typeof data === 'object' ? data as Record<string, unknown> : null;
        });
        try {
          await page.goto(`${XHS_BASE}/user/profile/${params.userId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await dismissModals(page);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          let raw = await waitForInterceptor(interceptor.get);
          if (!raw && waitForHuman) {
            await waitForHuman({ reason: '小红书用户资料加载失败，可能需要登录或验证', timeout: 120 });
            raw = await waitForInterceptor(interceptor.get, 5000);
          }
          if (raw) { const user = parseUser(raw); tips.push(`用户: ${user.nickname}`); return { data: user, tips }; }
          const domInfo = await page.evaluate(() => {
            const nickname =
              document.querySelector('[class*="nickname"]')?.textContent?.trim() ||
              document.querySelector('[class*="userName"]')?.textContent?.trim() ||
              document.querySelector('[class*="user-name"]')?.textContent?.trim() ||
              '';
            const desc = document.querySelector('[class*="desc"]')?.textContent?.trim() || '';
            const avatar = document.querySelector('[class*="avatar"] img')?.getAttribute('src') || '';
            const stats: Record<string, string> = {};
            document.querySelectorAll('[class*="count"]').forEach((el) => {
              const label = el.previousElementSibling?.textContent?.trim() || '';
              if (label) stats[label] = el.textContent?.trim() || '';
            });
            return { nickname, desc, avatar, stats };
          });
          tips.push(`用户(DOM): ${domInfo.nickname}`);
    return ok({ userId: params.userId, []);
      } catch (error) { return errResult(error instanceof Error ? error.message : '未知错误', ['获取用户资料失败']); }
    },
  });

  site.command('search', {
    description: '搜索笔记（API 拦截）',
    scope: 'browser',
    parameters: z.object({ keyword: z.string().describe('搜索关键词'), maxPages: z.number().default(3).describe('最大滚动次数') }),
    examples: [{ cmd: 'xbrowser xiaohongshu search --keyword "美食推荐"', description: '搜索笔记' }],
    result: z.any(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);
        const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as WaitForHumanFn | undefined;
        const interceptor = interceptApi(page, API.SEARCH_NOTES, 'items', 'id');
        try {
          await page.goto(`${XHS_BASE}/search_result?keyword=${encodeURIComponent(params.keyword)}&source=web_search_result_notes`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await dismissModals(page);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          await scrollAndCollect(page, params.maxPages || 3, () => interceptor.items().length, { waitForHuman });
          const notes = interceptor.items().map(parseNoteBrief);
          tips.push(`搜索到 ${notes.length} 条笔记`);
    return ok({ keyword: params.keyword, []);
      } catch (error) { return errResult(error instanceof Error ? error.message : '未知错误', ['搜索笔记失败']); }
    },
  });

  site.command('comments', {
    description: '获取笔记评论（API 拦截）',
    scope: 'browser',
    parameters: z.object({ noteId: z.string().describe('笔记 ID'), maxPages: z.number().default(8).describe('最大滚动次数') }),
    examples: [{ cmd: 'xbrowser xiaohongshu comments --noteId "67xxxxxxxxxxxxxx"', description: '获取笔记评论' }],
    result: z.any(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);
        const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as WaitForHumanFn | undefined;
        const interceptor = interceptApi(page, API.COMMENT_PAGE, 'comments', 'id');
        try {
          await page.goto(`${XHS_BASE}/explore/${params.noteId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await dismissModals(page);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          await scrollAndCollect(page, params.maxPages || 8, () => interceptor.items().length, {
            delay: 3000,
            staleThreshold: 4,
            waitForHuman,
          });
          const comments = interceptor.items().map(parseComment);
          tips.push(`采集到 ${comments.length} 条评论`);
    return ok({ total: comments.length, []);
      } catch (error) { return errResult(error instanceof Error ? error.message : '未知错误', ['获取笔记评论失败']); }
    },
  });

  site.command('feed', {
    description: '获取首页推荐（API 拦截）',
    scope: 'browser',
    parameters: z.object({ maxPages: z.number().default(3).describe('最大滚动次数') }),
    examples: [{ cmd: 'xbrowser xiaohongshu feed', description: '获取首页推荐' }],
    result: z.any(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);
        const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as WaitForHumanFn | undefined;
        const interceptor = interceptApi(page, API.HOME_FEED, 'items', 'id');
        try {
          await page.goto(`${XHS_BASE}/explore`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await dismissModals(page);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          await scrollAndCollect(page, params.maxPages || 3, () => interceptor.items().length, { waitForHuman });
          const notes = interceptor.items().map(parseNoteBrief);
          tips.push(`获取到 ${notes.length} 条推荐笔记`);
    return ok({ total: notes.length, []);
      } catch (error) { return errResult(error instanceof Error ? error.message : '未知错误', ['获取首页推荐失败']); }
    },
  });

  site.command('resolve-url', {
    description: '解析小红书短链',
    scope: 'browser',
    parameters: z.object({ url: z.string().describe('短链 URL') }),
    examples: [{ cmd: 'xbrowser xiaohongshu resolve-url --url "https://xhslink.com/xxx"', description: '解析短链' }],
    result: z.any(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);

        const ssr = await detectSsr(page);
        if (ssr) {
          tips.push(ssr.tip);
          if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
        }

        const finalUrl = page.url();
        const noteIdMatch = finalUrl.match(/\/explore\/([a-zA-Z0-9]+)/);
        const userIdMatch = finalUrl.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
        const noteId = noteIdMatch ? noteIdMatch[1] : '';
        const userId = userIdMatch ? userIdMatch[1] : '';
        tips.push(`最终 URL: ${finalUrl}`);
        if (noteId) tips.push(`笔记 ID: ${noteId}`);
        if (userId) tips.push(`用户 ID: ${userId}`);
    return ok({ originalUrl: params.url, []);
    },
  });

  site.command('search-image', {
    description: '小红书图片搜索',
    scope: 'browser',
    parameters: z.object({
      query: z.string(),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page) || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        await page.goto('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(params.query) + '&source=web_search_result_notes', { waitUntil: 'networkidle', timeout: params.timeout });
        await page.waitForTimeout(6000);
        for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await page.waitForTimeout(1500); }
        const results = await page.evaluate((limit) => {
          const imgs: Array<Record<string, unknown>> = [];
          let allImgs = document.querySelectorAll('img[src*="xhscdn"], img[src*="sns-webpic"], img[src*="xiaohongshu"]');
          if (allImgs.length === 0) {
            allImgs = document.querySelectorAll('img');
          }
          allImgs.forEach((img) => {
            if (imgs.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || el.getAttribute('data-src') || '';
            const finalSrc = src.startsWith('//') ? 'https:' + src : src;
            if (!finalSrc.startsWith('http')) return;
            if (el.width < 30) return;
            if (finalSrc.includes('logo') || finalSrc.includes('icon') || finalSrc.includes('avatar')) return;
            imgs.push({
              title: el.alt || '', thumbnailUrl: finalSrc, sourceUrl: el.closest('a')?.href || '',
              originalUrl: finalSrc.replace(/\/\d+$/, '/0'), width: el.naturalWidth || el.width || 0,
              height: el.naturalHeight || el.height || 0, format: 'jpg', sourceSite: 'xiaohongshu',
            });
          });
          return imgs;
        }, params.limit);
    return ok({ query: params.query, [`小红书 "${params.query}"，共 ${results.length} 张`] };);
    },
  });
}
