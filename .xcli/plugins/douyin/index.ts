import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';

type Page = import('playwright-core').Page;
type Response = import('playwright-core').Response;

const DOUYIN_BASE = 'https://www.douyin.com';
const API = {
  AWEME_POST: '/aweme/v1/web/aweme/post/',
  COMMENT_LIST: '/aweme/v1/web/comment/list/',
  AWEME_DETAIL: '/aweme/v1/web/aweme/detail/',
  FAVORITES: '/aweme/v1/web/aweme/favorites/',
} as const;

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

function formatTime(ts: number): string {
  if (ts <= 0) return '';
  const d = new Date(ts * 1000);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseVideo(item: Record<string, unknown>) {
  const ct = n(item.create_time);
  const stats = ((item.statistics ?? {}) || {}) as Record<string, unknown>;
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
    createTimeStr: formatTime(ct),
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

interface Interceptor {
  items: () => Record<string, unknown>[];
  dispose: () => void;
}

function interceptApi(
  page: Page,
  urlPattern: string,
  dataKey: string,
  idKey: string,
): Interceptor {
  const items: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  const handler = async (response: Response) => {
    if (!response.url().includes(urlPattern)) return;
    try {
      const json = await response.json();
      const list = (json as Record<string, unknown>)?.[dataKey];
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const id = s(g(item, idKey));
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        items.push(item as Record<string, unknown>);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.warn('[douyin] Failed to parse response:', (err as Error).message);
      }
    }
  };

  page.on('response', handler);
  return {
    items: () => items,
    dispose: () => page.off('response', handler),
  };
}

async function scrollAndCollect(
  page: Page,
  maxPages: number,
  getItemCount: () => number,
  opts: { delay?: number; staleThreshold?: number } = {},
): Promise<void> {
  const { delay = 2500, staleThreshold = 3 } = opts;
  let lastCount = getItemCount();
  let staleCount = 0;

  for (let i = 0; i < maxPages; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(delay);
    const currentCount = getItemCount();
    if (currentCount === lastCount) {
      staleCount++;
    } else {
      staleCount = 0;
      lastCount = currentCount;
    }
    if (staleCount >= staleThreshold) break;
  }
}

function buildCtxTips(ctx: Record<string, unknown>): string[] {
  const tips: string[] = [];
  if (!ctx.cdpEndpoint) {
    tips.push('建议使用 --cdp 9221 参数连接到 Chrome 浏览器');
  }
  tips.push(`Session: ${ctx.sessionId || 'default'}`);
  return tips;
}

function parseComment(item: Record<string, unknown>) {
  const ct = n(item.create_time);
  const replyToRaw = item.reply_to_comment;
  const replyTo =
    replyToRaw && typeof replyToRaw === 'object'
      ? {
          id: s(g(replyToRaw, 'cid')),
          text: s(g(replyToRaw, 'text')),
          user: {
            uid: s(g(replyToRaw, 'user.uid')),
            nickname: s(g(replyToRaw, 'user.nickname')),
          },
        }
      : undefined;

  return {
    id: s(g(item, 'cid')),
    text: s(g(item, 'text')),
    user: {
      uid: s(g(item, 'user.uid')),
      nickname: s(g(item, 'user.nickname')),
      avatar: firstUrl(g(item, 'user.avatar_thumb.url_list')),
    },
    createTime: ct,
    createTimeStr: formatTime(ct),
    diggCount: n(g(item, 'digg_count')),
    replyCount: n(g(item, 'reply_comment_total')),
    replyTo,
  };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'douyin',
    url: DOUYIN_BASE,
    description: '抖音数据采集',
  });

  site.command('videos', {
    description: '采集用户作品列表（网络拦截）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('用户主页 URL'),
      maxPages: z.number().default(5).describe('最大滚动次数'),
    }),
    examples: [
      { cmd: 'xbrowser douyin videos --url "https://www.douyin.com/user/xxx"', description: '采集用户作品' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);

        const interceptor = interceptApi(page, API.AWEME_POST, 'aweme_list', 'aweme_id');
        try {
          await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);
          await scrollAndCollect(page, params.maxPages || 5, () => interceptor.items().length);

          const videos = interceptor.items().map(parseVideo);
          tips.push(`采集到 ${videos.length} 个作品`);
          return { data: { total: videos.length, videos }, tips };
        } finally {
          interceptor.dispose();
        }
      } catch (error) {
        return {
          data: null,
          tips: ['采集用户作品失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('profile', {
    description: '获取用户资料',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('用户主页 URL'),
    }),
    examples: [
      { cmd: 'xbrowser douyin profile --url "https://www.douyin.com/user/xxx"', description: '获取用户资料' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);

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

        tips.push(`用户: ${userInfo.nickname}`);
        return { data: userInfo, tips };
      } catch (error) {
        return {
          data: null,
          tips: ['获取用户资料失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('detail', {
    description: '获取视频详情（DOM）',
    scope: 'browser',
    parameters: z.object({
      awemeId: z.string().describe('视频 ID'),
    }),
    examples: [
      { cmd: 'xbrowser douyin detail --awemeId "7xxxxxxxxxxxxx"', description: '获取视频详情' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);

        await page.goto(`${DOUYIN_BASE}/video/${params.awemeId}`, {
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

        tips.push(`视频: ${info.desc?.slice(0, 50)}`);
        return { data: { awemeId: params.awemeId, ...info }, tips };
      } catch (error) {
        return {
          data: null,
          tips: ['获取视频详情失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('comments', {
    description: '获取视频评论（网络拦截）',
    scope: 'browser',
    parameters: z.object({
      awemeId: z.string().describe('视频 ID'),
      maxPages: z.number().default(5).describe('最大滚动次数'),
    }),
    examples: [
      { cmd: 'xbrowser douyin comments --awemeId "7xxxxxxxxxxxxx"', description: '获取视频评论' },
      { cmd: 'xbrowser douyin comments --awemeId "7xxxxxxxxxxxxx" --maxPages 10', description: '获取更多评论' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);

        const interceptor = interceptApi(page, API.COMMENT_LIST, 'comments', 'cid');
        try {
          await page.goto(`${DOUYIN_BASE}/video/${params.awemeId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          await page.waitForTimeout(3000);
          await scrollAndCollect(page, params.maxPages || 5, () => interceptor.items().length);

          const comments = interceptor.items().map(parseComment);
          tips.push(`采集到 ${comments.length} 条评论`);
          return { data: { total: comments.length, comments }, tips };
        } finally {
          interceptor.dispose();
        }
      } catch (error) {
        return {
          data: null,
          tips: ['获取视频评论失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('user-comments', {
    description: '获取用户喜欢的视频列表（网络拦截）',
    scope: 'browser',
    parameters: z.object({
      uid: z.string().describe('用户 ID'),
      maxPages: z.number().default(5).describe('最大滚动次数'),
    }),
    examples: [
      { cmd: 'xbrowser douyin user-comments --uid "xxx"', description: '获取用户喜欢的视频' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);

        const interceptor = interceptApi(page, API.FAVORITES, 'aweme_list', 'aweme_id');
        try {
          await page.goto(`${DOUYIN_BASE}/user/${params.uid}?showTab=like`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          await page.waitForTimeout(3000);
          await scrollAndCollect(page, params.maxPages || 5, () => interceptor.items().length);

          const videos = interceptor.items().map(parseVideo);
          if (videos.length === 0) {
            tips.push('未采集到数据，可能该用户的喜欢列表为私密或需要登录');
          }
          tips.push(`采集到 ${videos.length} 个喜欢的视频`);
          return {
            data: { total: videos.length, favorites: videos },
            tips,
          };
        } finally {
          interceptor.dispose();
        }
      } catch (error) {
        return {
          data: null,
          tips: ['获取用户喜欢列表失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('ai-subtitle', {
    description: '通过抖音 AI 提取视频字幕',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('视频详情页 URL 或用户主页 URL'),
      videoIndex: z.number().optional().default(0).describe('第几个作品（0=第一个，仅用户主页时有效）'),
      prompt: z.string().optional().default('提取当前视频的字幕信息').describe('AI 提示词'),
      waitTimeout: z.number().optional().default(60000).describe('等待 AI 响应超时（毫秒）'),
    }),
    examples: [
      { cmd: 'xbrowser douyin ai-subtitle --url "https://www.douyin.com/video/7xxx"', description: '提取指定视频字幕' },
      { cmd: 'xbrowser douyin ai-subtitle --url "https://www.douyin.com/user/xxx" --videoIndex 0', description: '提取用户第一个作品字幕' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildCtxTips(ctx as Record<string, unknown>);
      const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
        | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
        | undefined;

      const AI_ICON_SELECTORS = [
        'button[class*="ai"]',
        '[class*="ai-icon"]',
        '[class*="aiIcon"]',
        '[data-e2e="ai-button"]',
        'button[aria-label*="AI"]',
        'button[aria-label*="ai"]',
        '[class*="AIPanel"] button',
        'svg[class*="ai"]',
      ];

      const IFRAME_SELECTORS = [
        'iframe[class*="ai"]',
        'iframe[src*="ai"]',
        'iframe[class*="AIPanel"]',
        'iframe[class*="chat"]',
      ];

      const INPUT_SELECTORS = [
        'textarea',
        'input[type="text"]',
        '[contenteditable="true"]',
        'div[contenteditable="true"]',
      ];

      const SEND_SELECTORS = [
        'button[type="submit"]',
        'button:has-text("发送")',
        'button:has-text("Send")',
        '[class*="send"]',
        '[class*="submit"]',
      ];

      const RESPONSE_SELECTORS = [
        '[class*="message"]',
        '[class*="response"]',
        '[class*="ai-response"]',
        '[class*="content"]',
      ];

      try {
        let videoUrl = params.url;
        const isUserPage = params.url.includes('/user/');

        if (isUserPage) {
          tips.push('进入用户主页...');
          await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);

          const videoSelectors = [
            'li[data-e2e="recommend-list-item"]',
            'li[class*="video-item"]',
            'div[class*="video-card"]',
            'a[href*="/video/"]',
          ];

          let videoEl: import('playwright-core').ElementHandle | null = null;
          for (const sel of videoSelectors) {
            const videos = await page.$$(sel);
            if (videos.length > 0 && params.videoIndex < videos.length) {
              videoEl = videos[params.videoIndex];
              break;
            }
          }

          if (!videoEl) {
            if (waitForHuman) {
              tips.push('未找到作品元素，等待手动操作...');
              await waitForHuman({ reason: '请在浏览器中点击要提取字幕的视频', timeout: 60 });
              videoUrl = page.url();
            } else {
              throw new Error(`未找到第 ${params.videoIndex + 1} 个作品`);
            }
          } else {
            await videoEl.click();
            await page.waitForTimeout(3000);
            videoUrl = page.url();
            tips.push(`已点击第 ${params.videoIndex + 1} 个作品`);
          }
        } else {
          tips.push('进入视频详情页...');
          await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);
        }

        tips.push('正在查找 AI 图标...');
        let aiIconFound = false;
        for (const sel of AI_ICON_SELECTORS) {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            aiIconFound = true;
            tips.push(`已点击 AI 图标 (${sel.split('[')[0]})`);
            break;
          }
        }

        if (!aiIconFound) {
          if (waitForHuman) {
            tips.push('未找到 AI 图标，等待手动操作...');
            await waitForHuman({ reason: '请在浏览器中找到并点击 AI 图标', timeout: 60 });
          } else {
            throw new Error('未找到 AI 图标，请确认页面已加载 AI 功能');
          }
        }

        await page.waitForTimeout(2000);
        tips.push('等待 AI 面板加载...');

        let frame: import('playwright-core').FrameLocator | null = null;
        for (const sel of IFRAME_SELECTORS) {
          const iframeEl = page.frameLocator(sel);
          const count = await iframeEl.locator('body').count();
          if (count > 0) {
            frame = iframeEl;
            tips.push(`已定位到 iframe`);
            break;
          }
        }

        if (!frame) {
          frame = page.frameLocator('iframe').first();
          tips.push('使用第一个 iframe');
        }

        let inputBox: import('playwright-core').Locator | null = null;
        for (const sel of INPUT_SELECTORS) {
          const el = frame.locator(sel).first();
          const count = await el.count();
          if (count > 0) {
            inputBox = el;
            tips.push(`已定位到输入框`);
            break;
          }
        }

        if (!inputBox) {
          if (waitForHuman) {
            tips.push('未找到输入框，等待手动操作...');
            await waitForHuman({ reason: '请在 AI 面板中输入提示词并发送', timeout: 60 });
            const response = await frame.locator(RESPONSE_SELECTORS.join(',')).last().textContent();
            return {
              data: { subtitle: response?.trim() || '', prompt: params.prompt },
              tips: [...tips, '字幕提取完成'],
            };
          } else {
            throw new Error('未找到 AI 输入框');
          }
        }

        await inputBox.fill(params.prompt!);
        await page.waitForTimeout(500);
        tips.push(`已输入提示词: ${params.prompt}`);

        let sent = false;
        for (const sel of SEND_SELECTORS) {
          const btn = frame.locator(sel).first();
          const count = await btn.count();
          if (count > 0) {
            await btn.click();
            sent = true;
            tips.push('已点击发送按钮');
            break;
          }
        }

        if (!sent) {
          await inputBox.press('Enter');
          tips.push('已按 Enter 发送');
        }

        tips.push('等待 AI 响应...');
        await page.waitForTimeout(5000);

        const startTime = Date.now();
        let response = '';
        while (Date.now() - startTime < params.waitTimeout!) {
          await page.waitForTimeout(2000);
          for (const sel of RESPONSE_SELECTORS) {
            const text = await frame!.locator(sel).last().textContent();
            if (text && text.trim().length > 50 && text !== params.prompt) {
              response = text.trim();
              break;
            }
          }
          if (response) break;
        }

        if (!response) {
          if (waitForHuman) {
            tips.push('AI 响应超时，等待手动操作...');
            await waitForHuman({ reason: '请等待 AI 响应完成', timeout: 60 });
            response = (await frame!.locator(RESPONSE_SELECTORS.join(',')).last().textContent()) || '';
          } else {
            throw new Error('AI 响应超时');
          }
        }

        tips.push('字幕提取完成');
        return {
          data: {
            subtitle: response,
            prompt: params.prompt,
            videoUrl,
          },
          tips,
        };
      } catch (error) {
        return {
          data: null,
          tips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });
}
