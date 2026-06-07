import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';

type Page = import('../types').Page;
type Response = import('../types').Response;

const SSR_VARIABLE_TO_FRAMEWORK: Record<string, string> = {
  __NEXT_DATA__: 'Next.js',
  __NUXT__: 'Nuxt.js',
  RENDER_DATA: 'Douyin/ByteDance',
  __INITIAL_STATE__: 'Generic SSR',
  __APP_DATA__: 'Generic SSR',
  __PRELOADED_STATE__: 'Generic SSR',
  __DATA__: 'Generic SSR',
  __SSR_DATA__: 'Generic SSR',
  __remixContext: 'Remix',
  __vite_ssr_data__: 'Vite SSR',
};
const SSR_VARIABLES = Object.keys(SSR_VARIABLE_TO_FRAMEWORK);

async function detectSsr(page: Page) {
  try {
    const result = await page.evaluate((vars) => {
      for (const varName of vars) {
        const value = (window as unknown as Record<string, unknown>)[varName];
        if (value != null && typeof value === 'object') {
          const keys = Object.keys(value as Record<string, unknown>).slice(0, 10);
          return { variable: varName, keys };
        }
      }
      return null;
    }, SSR_VARIABLES);
    if (!result) return undefined;
    const framework = SSR_VARIABLE_TO_FRAMEWORK[result.variable] ?? 'Unknown';
    return {
      detected: true as const,
      framework,
      variable: result.variable,
      dataKeys: result.keys,
      tip: `检测到 ${framework} SSR 页面，数据在 ${result.variable} 中，可直接提取`,
    };
  } catch {
    return undefined;
  }
}

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
      secUid: s(auth.sec_uid),
      nickname: s(auth.nickname),
      signature: s(auth.signature),
      avatar: firstUrl(auth.avatar_larger) || firstUrl(auth.avatar_thumb),
      homepage: s(auth.sec_uid) ? `${DOUYIN_BASE}/user/${s(auth.sec_uid)}` : '',
      ipLocation: s(auth.ip_location),
      followerCount: n(auth.follower_count),
      followingCount: n(auth.following_count),
      awemeCount: n(auth.aweme_count),
      favoritingCount: n(auth.favoriting_count),
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

const CAPTCHA_DETECTORS = [
  { selector: '[class*="captcha"]', name: '验证码' },
  { selector: '#captcha_container', name: '验证码容器' },
  { selector: '[id*="captcha"]', name: '验证码' },
  { selector: '[class*="secsdk"]', name: '安全验证' },
  { selector: '[class*="captcha-slider"]', name: '滑块验证' },
];

async function checkCaptcha(
  page: Page,
  tips: string[],
  waitForHuman?: (opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>,
): Promise<boolean> {
  try {
    for (const detector of CAPTCHA_DETECTORS) {
      const el = await page.$(detector.selector);
      if (!el) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;

      tips.push(`⚠️ 检测到${detector.name}，需要人工介入`);
      const port = process.env.XBROWSER_DAEMON_PORT || '9224';
      const viewerUrl = `http://localhost:${port}/preview/default`;
      tips.push(`🔗 Viewer 地址: ${viewerUrl}`);

      if (waitForHuman) {
        tips.push('请在 Viewer 中完成验证...');
        await waitForHuman({
          reason: `检测到${detector.name}，请在 Viewer 中完成验证`,
          timeout: 120,
        });
        await new Promise<void>(r => setTimeout(r, 2000));
        const stillThere = await page.$(detector.selector);
        if (stillThere && await stillThere.isVisible().catch(() => false)) {
          return true;
        }
        tips.push('验证码已解决');
        return false;
      }

      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'douyin',
    url: DOUYIN_BASE,
    description: '抖音数据采集',
    requiresLogin: true,
    loginConfig: {
      loginUrls: ['/login', '/passport'],
      loginSelectors: ['[class*="login"]', '[class*="modal"]'],
      captchaSelectors: ['[class*="captcha"]', '[class*="verify"]', '[class*="slider"]'],
      loginKeywords: ['登录', '注册'],
      loggedInSelectors: ['[class*="avatar"]', '[class*="user-info"]'],
      loginPrompt: '请使用 --cdp 连接已登录的浏览器（CDP 9221）',
    },
    isLogin: async (ctx) => {
      const ctxAny = ctx as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/passport')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body) return false;
        if (body.includes('登录')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  site.command('videos', {
    description: '采集用户作品列表（网络拦截）',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('用户主页 URL'),
      maxPages: z.number().default(5).describe('最大滚动次数'),
    }),
    examples: [
      { cmd: 'xbrowser douyin videos --url "https://www.douyin.com/user/xxx"', description: '采集用户作品' },
    ],
    result: z.object({
      total: z.number(),
      videos: z.array(z.object({
        awemeId: z.string(), desc: z.string(), createTime: z.number(), createTimeStr: z.string(),
        author: z.object({ uid: z.string(), nickname: z.string() }).passthrough(),
        video: z.object({
          playUrl: z.string(), cover: z.string(), width: z.number(), height: z.number(), duration: z.number(),
          bitRates: z.array(z.object({
            gearName: z.string(), qualityType: z.number(), playAddr: z.string(), size: z.number(),
          }).passthrough()),
        }).passthrough(),
        statistics: z.object({
          diggCount: z.number(), commentCount: z.number(), shareCount: z.number(),
          collectCount: z.number(), playCount: z.number(),
        }).passthrough(),
        tagNames: z.array(z.string()),
      }).passthrough()),
    }),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);

        const interceptor = interceptApi(page, API.AWEME_POST, 'aweme_list', 'aweme_id');
        try {
          await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          await scrollAndCollect(page, params.maxPages || 5, () => interceptor.items().length);

          const videos = interceptor.items().map(parseVideo);
          tips.push(`采集到 ${videos.length} 个作品`);
          return ok({ total: videos.length, videos }, tips);
        } finally {
          interceptor.dispose();
        }
      } catch (error) {
        return fail('未知错误', ['采集用户作品失败']);
      }
    },
  });

  async function resolveTargetProfileUrl(input: string, page: Page, tips: string[]): Promise<string> {
    let url = input;

    const urlMatch = url.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      url = urlMatch[1];
      if (urlMatch[0] !== input.trim()) {
        tips.push('从文本中提取到 URL');
      }
    }

    if (url.includes('v.douyin.com')) {
      tips.push('解析短链...');
      const resp = await page.request.get(url, { maxRedirects: 5 });
      const finalUrl = resp.url();
      tips.push(`跳转到: ${finalUrl}`);
      url = finalUrl;
    }

    if (/^\d{15,25}$/.test(url.trim())) {
      tips.push(`检测到纯 awemeId: ${url}`);
      return await resolveFromAwemeId(url.trim(), page, tips);
    }

    const videoMatch = url.match(/video\/(\d+)/);
    if (videoMatch) {
      tips.push(`检测到视频详情页，提取 awemeId: ${videoMatch[1]}`);
      return await resolveFromAwemeId(videoMatch[1], page, tips);
    }

    const userMatch = url.match(/user\/([A-Za-z0-9_-]+)/);
    if (userMatch) {
      tips.push(`检测到用户主页 secUid: ${userMatch[1].slice(0, 20)}...`);
      return `${DOUYIN_BASE}/user/${userMatch[1]}`;
    }

    if (!url.startsWith('http')) {
      tips.push('检测到纯 secUid 输入');
      return `${DOUYIN_BASE}/user/${url}`;
    }

    throw new Error(
      `无法识别输入格式。支持的格式：\n` +
      `  1. 用户主页 URL: https://www.douyin.com/user/SEC_UID\n` +
      `  2. 短链: https://v.douyin.com/xxx/\n` +
      `  3. 视频详情页: https://www.douyin.com/video/xxx\n` +
      `  4. 纯 awemeId（19位数字）\n` +
      `  5. 纯 secUid\n` +
      `  6. 包含上述 URL 的文本`,
    );
  }

  async function resolveFromAwemeId(awemeId: string, page: Page, tips: string[]): Promise<string> {
    tips.push(`通过视频详情获取作者 secUid...`);
    await page.goto(DOUYIN_BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise<void>(r => setTimeout(r, 2000));

    let secUid = '';

    const detailHandler = async (response: Response) => {
      if (!response.url().includes('aweme/v1/web/aweme/detail')) return;
      try {
        const json = await response.json();
        const uid = s(g(json, 'aweme_detail.author.sec_uid'));
        if (uid) secUid = uid;
      } catch {
        if (process.env.DEBUG) console.warn('[douyin] Failed to parse detail API response');
      }
    };

    page.on('response', detailHandler);
    try {
      await page.goto(`${DOUYIN_BASE}/video/${awemeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const waitMs = 8000;
      const intervalMs = 500;
      for (let elapsed = 0; elapsed < waitMs && !secUid; elapsed += intervalMs) {
        await new Promise<void>(r => setTimeout(r, intervalMs));
      }
    } finally {
      page.off('response', detailHandler);
    }

    if (!secUid) {
      throw new Error(`无法从视频 ${awemeId} 获取作者 secUid，请确认视频 ID 有效且已登录`);
    }

    tips.push(`获取到 secUid: ${secUid.slice(0, 20)}...`);
    return `${DOUYIN_BASE}/user/${secUid}`;
  }

  site.command('profile', {
    description: '获取用户详细资料（XHR 拦截）',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('用户主页 URL 或 secUid'),
    }),
    examples: [
      { cmd: 'xbrowser douyin profile --url "https://www.douyin.com/user/MS4wLjAB..."', description: '获取用户资料' },
    ],
    result: z.object({
      uid: z.string(),
      secUid: z.string(),
      nickname: z.string(),
      signature: z.string(),
      avatar: z.string(),
      homepage: z.string(),
      ipLocation: z.string(),
      gender: z.number(),
      followerCount: z.number(),
      followingCount: z.number(),
      awemeCount: z.number(),
      favoritingCount: z.number(),
      totalFavorited: z.number(),
      verificationType: z.number(),
      customVerify: z.string(),
      shortId: z.string(),
      uniqueId: z.string(),
      roomId: z.string(),
      liveStatus: z.number(),
      schoolName: z.string(),
      province: z.string(),
      city: z.string(),
    }),
    handler: async (params, ctx) => {
      const tips: string[] = [];
      try {
        const sessionPage = (ctx as Record<string, unknown>).page as Page;
        if (!sessionPage) throw new Error('需要浏览器页面');

        const targetUrl = await resolveTargetProfileUrl(params.url, sessionPage, tips);

        let userProfile: Record<string, unknown> | null = null;
        let intercepted = false;

        const onProfileResponse = async (response: Response) => {
          if (!response.url().includes('aweme/v1/web/user/profile')) return;
          if (intercepted) return;
          try {
            const json = await response.json();
            const user = g(json, 'user') as Record<string, unknown> | null;
            if (user && user.nickname) {
              userProfile = user;
              intercepted = true;
            }
          } catch {
            if (process.env.DEBUG) console.warn('[douyin] Failed to parse profile API response');
          }
        };

        sessionPage.on('response', onProfileResponse);
        try {
          await sessionPage.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const _waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
            | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
            | undefined;
          const _hasCaptcha = await checkCaptcha(sessionPage, tips, _waitForHuman);
          if (_hasCaptcha) {
            return fail('需要完成验证码验证后重试', tips);
          }
          const waitMs = 10000;
          const intervalMs = 500;
          for (let elapsed = 0; elapsed < waitMs && !intercepted; elapsed += intervalMs) {
            await new Promise<void>(r => setTimeout(r, intervalMs));
          }
        } finally {
          sessionPage.off('response', onProfileResponse);
        }

        if (!userProfile) {
          return fail('未获取到用户资料，请确认 URL 有效且已登录', tips);
        }

        const result = {
          uid: s(userProfile.uid),
          secUid: s(userProfile.sec_uid),
          nickname: s(userProfile.nickname),
          signature: s(userProfile.signature),
          avatar: firstUrl(userProfile.avatar_larger),
          homepage: `${DOUYIN_BASE}/user/${s(userProfile.sec_uid)}`,
          ipLocation: s(userProfile.ip_location),
          gender: n(userProfile.gender),
          followerCount: n(userProfile.follower_count),
          followingCount: n(userProfile.following_count),
          awemeCount: n(userProfile.aweme_count),
          favoritingCount: n(userProfile.favoriting_count),
          totalFavorited: n(userProfile.total_favorited),
          verificationType: n(userProfile.verification_type),
          customVerify: s(userProfile.custom_verify),
          shortId: s(userProfile.short_id),
          uniqueId: s(userProfile.unique_id),
          roomId: s(userProfile.room_id),
          liveStatus: n(userProfile.live_status),
          schoolName: s(userProfile.school_name),
          province: s(userProfile.province),
          city: s(userProfile.city),
        };

        tips.push(`用户: ${result.nickname}`);
        tips.push(`粉丝: ${result.followerCount} | 关注: ${result.followingCount} | 作品: ${result.awemeCount}`);
        tips.push(`获赞: ${result.totalFavorited}`);

        return ok(result, tips);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return fail(msg, [`获取用户资料失败: ${msg}`, ...tips]);
      }
    },
  });

  site.command('detail', {
    description: '获取视频详细信息（XHR 拦截，支持短链）',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('视频 URL / 短链 / 或纯 awemeId'),
    }),
    examples: [
      { cmd: 'xbrowser douyin detail --url "https://www.douyin.com/video/7xxx"', description: '获取视频详情' },
      { cmd: 'xbrowser douyin detail --url "https://v.douyin.com/xxx"', description: '短链获取详情' },
      { cmd: 'xbrowser douyin detail --url "7643743295886642939"', description: '用 awemeId 获取详情' },
    ],
    result: z.object({
      awemeId: z.string(),
      desc: z.string(),
      author: z.object({
        uid: z.string(),
        secUid: z.string(),
        nickname: z.string(),
        signature: z.string(),
        avatar: z.string(),
        homepage: z.string(),
        ipLocation: z.string(),
        followerCount: z.number(),
        followingCount: z.number(),
        awemeCount: z.number(),
        favoritingCount: z.number(),
      }),
      video: z.object({
        duration: z.number(),
        width: z.number(),
        height: z.number(),
        ratio: z.string(),
        format: z.string(),
        cover: z.string(),
        dynamicCover: z.string(),
        playUrl: z.string(),
        bitRates: z.array(z.object({
          gearName: z.string(),
          qualityType: z.number(),
          playAddr: z.string(),
          size: z.number(),
          width: z.number(),
          height: z.number(),
          dataSize: z.number(),
          bitRate: z.number(),
        })),
      }),
      statistics: z.object({
        diggCount: z.number(),
        commentCount: z.number(),
        shareCount: z.number(),
        collectCount: z.number(),
        playCount: z.number(),
      }),
      music: z.object({ title: z.string(), author: z.string(), playUrl: z.string() }).optional(),
      tagNames: z.array(z.string()),
      createTime: z.number(),
      createTimeStr: z.string(),
    }),
    handler: async (params, ctx) => {
      const tips: string[] = [];
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');

        let input = params.url;
        let awemeId = '';

        if (/^\d{15,25}$/.test(input)) {
          awemeId = input;
        } else if (input.includes('v.douyin.com')) {
          tips.push('解析短链...');
          const resp = await page.request.get(input, { maxRedirects: 5 });
          const finalUrl = resp.url();
          tips.push(`跳转到: ${finalUrl}`);
          const m = finalUrl.match(/video\/(\d+)/);
          if (!m) throw new Error('无法从短链中提取视频 ID');
          awemeId = m[1];
        } else {
          const m = input.match(/video\/(\d+)/);
          if (!m) throw new Error('无法从 URL 中提取视频 ID');
          awemeId = m[1];
        }

        let detail: Record<string, unknown> | null = null;

        const handler = async (response: Response) => {
          if (!response.url().includes('aweme/v1/web/aweme/detail')) return;
          try {
            const json = await response.json();
            detail = g(json, 'aweme_detail') as Record<string, unknown> ?? null;
          } catch {
            if (process.env.DEBUG) console.warn('[douyin] Failed to parse detail API response');
          }
        };

        page.on('response', handler);
        try {
          await page.goto(`${DOUYIN_BASE}/video/${awemeId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const _waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
            | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
            | undefined;
          const _hasCaptcha = await checkCaptcha(page, tips, _waitForHuman);
          if (_hasCaptcha) {
            return fail('需要完成验证码验证后重试', tips);
          }
          await page.waitForTimeout(5000);
        } finally {
          page.off('response', handler);
        }

        if (!detail) {
          return fail('XHR 拦截未获取到详情数据，请确认页面正常加载', tips);
        }

        const parsed = parseVideo(detail);
        const vid = (detail.video ?? {}) as Record<string, unknown>;
        const music = detail.music as Record<string, unknown> | undefined;

        const result = {
          awemeId: parsed.awemeId,
          desc: parsed.desc,
          author: parsed.author,
          video: {
            duration: parsed.video.duration,
            width: parsed.video.width,
            height: parsed.video.height,
            ratio: s(vid.ratio),
            format: s(vid.format),
            cover: parsed.video.cover,
            dynamicCover: firstUrl(vid.dynamic_cover),
            playUrl: parsed.video.playUrl,
            bitRates: parsed.video.bitRates.map((br, i) => {
              const raw = (Array.isArray(vid.bit_rate) ? vid.bit_rate[i] : {}) as Record<string, unknown>;
              return {
                ...br,
                width: n((raw.play_addr as Record<string, unknown>)?.width),
                height: n((raw.play_addr as Record<string, unknown>)?.height),
                dataSize: br.size,
                bitRate: n(raw.bit_rate),
              };
            }),
          },
          statistics: parsed.statistics,
          music: music ? {
            title: s(music.title),
            author: s(music.author),
            playUrl: firstUrl(music.play_url),
          } : undefined,
          tagNames: parsed.tagNames,
          createTime: parsed.createTime,
          createTimeStr: parsed.createTimeStr,
        };

        tips.push(`标题: ${parsed.desc?.slice(0, 50)}`);
        tips.push(`作者: ${parsed.author.nickname}`);
        tips.push(`点赞: ${parsed.statistics.diggCount} | 评论: ${parsed.statistics.commentCount} | 播放: ${parsed.statistics.playCount}`);
        tips.push(`${parsed.video.bitRates.length} 个画质可选`);

        return ok(result, tips);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['获取视频详情失败', ...tips]);
      }
    },
  });

  site.command('comments', {
    description: '获取视频评论（网络拦截）',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      awemeId: z.string().describe('视频 ID'),
      maxPages: z.number().default(5).describe('最大滚动次数'),
    }),
    examples: [
      { cmd: 'xbrowser douyin comments --awemeId "7xxxxxxxxxxxxx"', description: '获取视频评论' },
      { cmd: 'xbrowser douyin comments --awemeId "7xxxxxxxxxxxxx" --maxPages 10', description: '获取更多评论' },
    ],
    result: z.object({
      total: z.number(),
      comments: z.array(z.object({
        id: z.string(), text: z.string(),
        user: z.object({ uid: z.string(), nickname: z.string(), avatar: z.string() }).passthrough(),
        createTime: z.number(), createTimeStr: z.string(),
        diggCount: z.number(), replyCount: z.number(),
        replyTo: z.object({
          id: z.string(), text: z.string(),
          user: z.object({ uid: z.string(), nickname: z.string() }).passthrough(),
        }).passthrough().optional(),
      }).passthrough()),
    }),
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
          const _waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
            | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
            | undefined;
          const _hasCaptcha = await checkCaptcha(page, tips, _waitForHuman);
          if (_hasCaptcha) {
            return fail('需要完成验证码验证后重试', tips);
          }
          await page.waitForTimeout(3000);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          await scrollAndCollect(page, params.maxPages || 5, () => interceptor.items().length);

          const comments = interceptor.items().map(parseComment);
          tips.push(`采集到 ${comments.length} 条评论`);
          return ok({ total: comments.length, comments }, tips);
        } finally {
          interceptor.dispose();
        }
      } catch (error) {
        return fail('未知错误', ['获取视频评论失败']);
      }
    },
  });

  site.command('user-comments', {
    description: '获取用户喜欢的视频列表（网络拦截）',
    loginRequired: 'optional',
    scope: 'browser',
    parameters: z.object({
      uid: z.string().describe('用户 ID'),
      maxPages: z.number().default(5).describe('最大滚动次数'),
    }),
    examples: [
      { cmd: 'xbrowser douyin user-comments --uid "xxx"', description: '获取用户喜欢的视频' },
    ],
    result: z.object({
      total: z.number(),
      favorites: z.array(z.object({
        awemeId: z.string(), desc: z.string(), createTime: z.number(), createTimeStr: z.string(),
        author: z.object({ uid: z.string(), nickname: z.string() }).passthrough(),
        video: z.object({
          playUrl: z.string(), cover: z.string(), width: z.number(), height: z.number(), duration: z.number(),
          bitRates: z.array(z.object({
            gearName: z.string(), qualityType: z.number(), playAddr: z.string(), size: z.number(),
          }).passthrough()),
        }).passthrough(),
        statistics: z.object({
          diggCount: z.number(), commentCount: z.number(), shareCount: z.number(),
          collectCount: z.number(), playCount: z.number(),
        }).passthrough(),
        tagNames: z.array(z.string()),
      }).passthrough()),
    }),
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
          const _waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
            | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
            | undefined;
          const _hasCaptcha = await checkCaptcha(page, tips, _waitForHuman);
          if (_hasCaptcha) {
            return fail('需要完成验证码验证后重试', tips);
          }
          await page.waitForTimeout(3000);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          await scrollAndCollect(page, params.maxPages || 5, () => interceptor.items().length);

          const videos = interceptor.items().map(parseVideo);
          if (videos.length === 0) {
            tips.push('未采集到数据，可能该用户的喜欢列表为私密或需要登录');
          }
          tips.push(`采集到 ${videos.length} 个喜欢的视频`);
          return ok({ total: videos.length, favorites: videos }, tips);
        } finally {
          interceptor.dispose();
        }
      } catch (error) {
        return fail('未知错误', ['获取用户喜欢列表失败']);
      }
    },
  });

  site.command('search', {
    description: '搜索抖音视频',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      keyword: z.string().describe('搜索关键词'),
      maxPages: z.number().optional().default(1).describe('翻页数'),
    }),
    examples: [
      { cmd: 'xbrowser douyin search --keyword "潮汕美食"', description: '搜索视频' },
      { cmd: 'xbrowser douyin search --keyword "潮汕美食" --maxPages 3', description: '搜索并翻页' },
    ],
    result: z.object({
      total: z.number(),
      source: z.string(),
      keyword: z.string(),
      videos: z.array(z.object({
        awemeId: z.string(), desc: z.string(),
        author: z.object({ nickname: z.string() }).passthrough(),
        createTime: z.number().optional(), createTimeStr: z.string().optional(),
        video: z.object({
          playUrl: z.string().optional(), cover: z.string().optional(),
          width: z.number().optional(), height: z.number().optional(), duration: z.number().optional(),
          bitRates: z.array(z.any()).optional(),
        }).passthrough().optional(),
        cover: z.string().optional(), duration: z.string().optional(),
        statistics: z.object({
          diggCount: z.union([z.number(), z.string()]).optional(),
          commentCount: z.union([z.number(), z.string()]).optional(),
          collectCount: z.union([z.number(), z.string()]).optional(),
          shareCount: z.number().optional(), playCount: z.number().optional(),
        }).passthrough().optional(),
        tagNames: z.array(z.string()).optional(),
      }).passthrough()),
    }),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildCtxTips(ctx as Record<string, unknown>);

        const searchUrl = `${DOUYIN_BASE}/search/${encodeURIComponent(params.keyword)}`;

        const collected: Record<string, unknown>[] = [];
        const seenIds = new Set<string>();

        function extractAwemeItems(json: Record<string, unknown>): Record<string, unknown>[] {
          const candidates: unknown[] = [];
          for (const key of ['data', 'aweme_list', 'rawData', 'list']) {
            const val = json[key];
            if (Array.isArray(val)) candidates.push(...val);
          }
          const data = json.data;
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            const d = data as Record<string, unknown>;
            if (Object.keys(d).some(k => /^\d+$/.test(k))) {
              for (const val of Object.values(d)) {
                if (val && typeof val === 'object') {
                  const item = val as Record<string, unknown>;
                  const info = item.aweme_info;
                  if (info && typeof info === 'object') {
                    candidates.push(info);
                  } else if (item.aweme_id) {
                    candidates.push(item);
                  }
                }
              }
            }
            for (const key of ['aweme_list', 'list']) {
              const arr = d[key];
              if (Array.isArray(arr)) candidates.push(...arr);
            }
          }
          return candidates.filter((c): c is Record<string, unknown> =>
            c !== null && typeof c === 'object' && s(g(c, 'aweme_id')) !== '',
          );
        }

        const handler = async (response: Response) => {
          const url = response.url();
          if (!url.includes('/aweme/v1/web/')) return;
          try {
            const json = await response.json() as Record<string, unknown>;
            for (const item of extractAwemeItems(json)) {
              const id = s(g(item, 'aweme_id'));
              if (!id || seenIds.has(id)) continue;
              seenIds.add(id);
              collected.push(item);
            }
          } catch {
            // response parse failure for non-matching responses, skip
          }
        };

        page.on('response', handler);
        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const _waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
            | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
            | undefined;
          const _hasCaptcha = await checkCaptcha(page, tips, _waitForHuman);
          if (_hasCaptcha) {
            return fail('需要完成验证码验证后重试', tips);
          }
          await page.waitForTimeout(6000);

          const ssr = await detectSsr(page);
          if (ssr) {
            tips.push(ssr.tip);
            if (ssr.dataKeys?.length) tips.push(`SSR 数据 keys: ${ssr.dataKeys.join(', ')}`);
          }

          for (let i = 0; i < params.maxPages; i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(3000);
          }

          if (collected.length === 0) {
            const domVideos = await page.evaluate(() => {
              const items: Array<Record<string, unknown>> = [];
              const cards = document.querySelectorAll('li');
              for (const card of cards) {
                const awemeId = card.querySelector('[data-e2e-aweme-id]')?.getAttribute('data-e2e-aweme-id')
                  || card.querySelector('[data-e2e-vid]')?.getAttribute('data-e2e-vid');
                if (!awemeId) continue;

                const nicknameEl = card.querySelector('a[href*="/user/"] p span span span span span')
                  || card.querySelector('a[href*="/user/"] span');
                let nickname = nicknameEl?.textContent?.trim() || '';

                const fullText = (card.textContent || '').trim();
                let desc = '';
                const expandIdx = fullText.indexOf('...展开');
                if (expandIdx >= 0) {
                  const afterExpand = fullText.slice(expandIdx + 5);
                  const statPattern = /\d+[\.\d]*[万]?$/;
                  const lines = afterExpand.split(/\n/).map(l => l.trim()).filter(Boolean);
                  const descParts: string[] = [];
                  for (const line of lines) {
                    if (/^\d+[\.\d]*万?$/.test(line)) break;
                    if (/^相关搜索/.test(line)) break;
                    if (/^\d{2}:\d{2}/.test(line)) break;
                    descParts.push(line);
                  }
                  desc = descParts.join(' ').trim();
                }
                if (!desc) {
                  const dotIdx = fullText.indexOf('·');
                  if (dotIdx >= 0) {
                    const afterDot = fullText.slice(dotIdx);
                    const timeMatch = afterDot.match(/·\d+[天周月年前后]+(.+?)(?:\d{2}:\d{2}|\d+[\.\d]*万?$)/);
                    if (timeMatch) desc = timeMatch[1].trim();
                  }
                }
                desc = desc.replace(/\d{2}:\d{2}\/\d{2}:\d{2}$/, '').replace(/\d{2}:\d{2}\s*$/, '').trim();
                desc = desc.replace(/\d+\.\d+万\d+\d+\.\d+万\d+\.\d+万.*$/, '').trim();
                desc = desc.replace(/合集\s*·.*$/, '').trim();

                const stats: Record<string, string> = {};
                card.querySelectorAll('[data-e2e]').forEach(el => {
                  const e2e = el.getAttribute('data-e2e') || '';
                  if (e2e.includes('digg') || e2e.includes('comment') || e2e.includes('collect')) {
                    const val = (el.textContent || '').trim();
                    if (val) stats[e2e] = val;
                  }
                });

                const durationEl = card.querySelector('[data-e2e="feed-active-video"] span:last-child, [class*="duration"]');
                const coverEl = card.querySelector('img[src*="douyinpic.com/aweme/"]') as HTMLImageElement | null;

                items.push({
                  awemeId,
                  desc: desc || fullText.slice(0, 100),
                  author: { nickname },
                  cover: coverEl?.src || '',
                  duration: durationEl?.textContent?.trim() || '',
                  statistics: {
                    diggCount: stats['video-player-digg'] || '',
                    commentCount: stats['feed-comment-icon'] || '',
                    collectCount: stats['video-player-collect'] || '',
                  },
                });
              }
              return items;
            });

            for (const item of domVideos) {
              const id = s(item.awemeId);
              if (!id || seenIds.has(id)) continue;
              seenIds.add(id);
              collected.push(item);
            }

            if (collected.length > 0) {
              tips.push(`DOM 解析获取到 ${collected.length} 个结果`);
              return ok({ total: collected.length, source: 'dom', keyword: params.keyword, videos: collected }, tips);
            }
          }

          const videos = collected.map(parseVideo);
          tips.push(`搜索到 ${videos.length} 个视频`);
          return ok({ total: videos.length, source: 'api', keyword: params.keyword, videos }, tips);
        } finally {
          page.off('response', handler);
        }
      } catch (error) {
        return fail('未知错误', ['搜索视频失败']);
      }
    },
  });

  site.command('download', {
    description: '下载抖音视频（无需登录）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('视频 URL 或短链（如 https://v.douyin.com/xxx）'),
      output: z.string().optional().describe('保存路径（默认 ./douyin_{awemeId}.mp4）'),
      quality: z.enum(['auto', 'highest', 'lowest']).optional().default('auto').describe('画质选择'),
    }),
    examples: [
      { cmd: 'xbrowser douyin download --url "https://www.douyin.com/video/7xxx"', description: '下载视频' },
      { cmd: 'xbrowser douyin download --url "https://v.douyin.com/xxx" --output ~/Desktop/video.mp4', description: '指定保存路径' },
      { cmd: 'xbrowser douyin download --url "https://www.douyin.com/video/7xxx" --quality highest', description: '下载最高画质' },
    ],
    result: z.object({
      awemeId: z.string(),
      filePath: z.string(),
      fileSize: z.string(),
      desc: z.string(),
      author: z.string(),
    }),
    handler: async (params, ctx) => {
      const tips: string[] = [];
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) throw new Error('需要浏览器页面');

        let videoUrl = params.url;
        if (videoUrl.includes('v.douyin.com')) {
          tips.push('解析短链...');
          const resp = await page.request.get(videoUrl, { maxRedirects: 5 });
          videoUrl = resp.url();
          tips.push(`跳转到: ${videoUrl}`);
        }

        const idMatch = videoUrl.match(/video\/(\d+)/);
        if (!idMatch) throw new Error('无法从 URL 中提取视频 ID');
        const awemeId = idMatch[1];

        let bestUrl = '';
        let bestGear = '';
        let videoInfo: { desc: string; author: string } = { desc: '', author: '' };

        const handler = async (response: Response) => {
          if (!response.url().includes('aweme/v1/web/aweme/detail')) return;
          try {
            const json = await response.json();
            const aweme = g(json, 'aweme_detail') as Record<string, unknown> | undefined;
            if (!aweme) return;

            videoInfo = {
              desc: s(aweme.desc),
              author: s(g(aweme, 'author.nickname')),
            };

            const vid = (aweme.video ?? {}) as Record<string, unknown>;

            // bit_rate 中的 play_addr 是无水印的，download_addr 带水印
            const bitRates = vid.bit_rate as Record<string, unknown>[] | undefined;
            if (Array.isArray(bitRates) && bitRates.length > 0) {
              const sorted = [...bitRates].sort((a, b) => {
                const sizeA = n((a.play_addr as Record<string, unknown>)?.data_size);
                const sizeB = n((b.play_addr as Record<string, unknown>)?.data_size);
                return sizeB - sizeA;
              });

              if (params.quality === 'lowest') {
                const pick = sorted[sorted.length - 1];
                const url = firstUrl(pick.play_addr);
                if (url) { bestUrl = url; bestGear = s(pick.gear_name); }
              } else {
                // auto / highest: 选最大（最高画质，无水印）
                const pick = sorted[0];
                const url = firstUrl(pick.play_addr);
                if (url) { bestUrl = url; bestGear = s(pick.gear_name); }
              }
            }

            // fallback: play_addr（通常也无水印）
            if (!bestUrl) {
              bestUrl = firstUrl(vid.play_addr);
              bestGear = 'play_addr';
            }
          } catch {
            if (process.env.DEBUG) console.warn('[douyin] Failed to parse detail API response');
          }
        };

        page.on('response', handler);
        try {
          await page.goto(`${DOUYIN_BASE}/video/${awemeId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const _waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
            | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
            | undefined;
          const _hasCaptcha = await checkCaptcha(page, tips, _waitForHuman);
          if (_hasCaptcha) {
            return fail('需要完成验证码验证后重试', tips);
          }
          await page.waitForTimeout(5000);
        } finally {
          page.off('response', handler);
        }

        if (!bestUrl) {
          const videoEl = await page.$('video');
          if (videoEl) {
            const src = await videoEl.getAttribute('src');
            if (src) bestUrl = src;
          }
        }

        if (!bestUrl) {
          throw new Error('未找到视频播放地址（XHR 拦截失败）');
        }

        const outputPath = params.output || `douyin_${awemeId}.mp4`;

        tips.push(`正在下载: ${videoInfo.desc?.slice(0, 50) || awemeId}`);
        tips.push(`画质: ${bestGear}（无水印）`);

        const { execSync } = await import('node:child_process');
        const path = await import('node:path');
        const fs = await import('node:fs');

        const absPath = path.resolve(outputPath);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        execSync(
          `curl -Lf -o "${absPath}" ` +
          `-H "Referer: ${DOUYIN_BASE}/" ` +
          `-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36" ` +
          `"${bestUrl}"`,
          { timeout: 180000, stdio: 'pipe' },
        );

        const stat = fs.statSync(absPath);
        const sizeStr = stat.size > 1048576
          ? `${(stat.size / 1048576).toFixed(1)}MB`
          : `${(stat.size / 1024).toFixed(0)}KB`;

        tips.push(`下载完成: ${sizeStr}`);
        return ok({
          awemeId,
          filePath: absPath,
          fileSize: sizeStr,
          desc: videoInfo.desc,
          author: videoInfo.author,
        }, tips);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['下载视频失败', ...tips]);
      }
    },
  });

  site.command('ai-subtitle', {
    description: '通过抖音 AI 提取视频字幕',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('视频详情页 URL 或用户主页 URL'),
      videoIndex: z.number().optional().default(0).describe('第几个作品（0=第一个，仅用户主页时有效）'),
      prompt: z.string().optional().default('提取当前视频的字幕信息').describe('AI 提示词'),
      waitTimeout: z.number().optional().default(120).describe('等待 AI 响应超时（秒）'),
      manual: z.boolean().optional().default(false).describe('手动模式：由用户手动操作 AI 面板，程序仅等待并提取结果'),
    }),
    examples: [
      { cmd: 'xbrowser douyin ai-subtitle --url "https://www.douyin.com/video/7xxx"', description: '自动模式提取字幕' },
      { cmd: 'xbrowser douyin ai-subtitle --url "https://www.douyin.com/video/7xxx" --manual', description: '手动模式提取字幕' },
      { cmd: 'xbrowser douyin ai-subtitle --url "https://www.douyin.com/user/xxx" --videoIndex 0', description: '提取用户第一个作品字幕' },
    ],
    result: z.object({
      subtitle: z.string(),
      prompt: z.string(),
      videoUrl: z.string(),
      mode: z.string(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildCtxTips(ctx as Record<string, unknown>);
      const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
        | ((opts?: { reason?: string; timeout?: number }) => Promise<{ solved: boolean }>)
        | undefined;

      const FLANE_SELECTORS = [
        '[class*="flane"]',
        '[class*="f-lane"]',
        '[class*="FLane"]',
        '[data-e2e*="flane"]',
      ];

      const IFRAME_SELECTORS = [
        'iframe[class*="ai"]',
        'iframe[src*="ai"]',
        'iframe[class*="AIPanel"]',
        'iframe[class*="chat"]',
        'iframe[class*="flane"]',
      ];

      const RESPONSE_SELECTORS = [
        '[class*="message"]',
        '[class*="response"]',
        '[class*="ai-response"]',
        '[class*="content"]',
      ];

      async function navigateToVideo(): Promise<string> {
        let videoUrl = params.url;
        const isUserPage = params.url.includes('/user/');

        if (isUserPage) {
          tips.push('进入用户主页...');
          await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const _wh = waitForHuman;
          await checkCaptcha(page, tips, _wh);
          await page.waitForTimeout(3000);

          const videoSelectors = [
            'li[data-e2e="recommend-list-item"]',
            'li[class*="video-item"]',
            'div[class*="video-card"]',
            'a[href*="/video/"]',
          ];

          let videoEl: import('../types').ElementHandle | null = null;
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
          const _wh = waitForHuman;
          await checkCaptcha(page, tips, _wh);
          await page.waitForTimeout(3000);
        }

        return videoUrl;
      }

      async function findIframe(timeout: number): Promise<import('../types').FrameLocator | null> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          for (const sel of IFRAME_SELECTORS) {
            try {
              const iframeEl = page.frameLocator(sel);
              const count = await iframeEl.locator('body').count();
              if (count > 0) {
                tips.push(`已定位到 AI iframe`);
                return iframeEl;
              }
            } catch {
              // iframe not ready yet, continue trying
            }
          }

          const allIframes = await page.$$('iframe');
          for (const iframe of allIframes) {
            try {
              const src = await iframe.getAttribute('src') ?? '';
              const cls = await iframe.getAttribute('class') ?? '';
              if (src.includes('ai') || src.includes('chat') || src.includes('flane') ||
                  cls.includes('ai') || cls.includes('chat') || cls.includes('flane')) {
                const name = await iframe.getAttribute('name') ?? '';
                const id = await iframe.getAttribute('id') ?? '';
                const frameSelector = name ? `iframe[name="${name}"]` : id ? `iframe#${id}` : 'iframe';
                tips.push(`已定位到 AI iframe (src: ${src.slice(0, 80)})`);
                return page.frameLocator(frameSelector);
              }
            } catch {
              // iframe access may fail, continue searching
            }
          }

          await page.waitForTimeout(2000);
        }

        return null;
      }

      function extractTextFromFrame(frame: import('../types').FrameLocator): Promise<string> {
        return frame.locator([
          ...RESPONSE_SELECTORS,
          '[class*="markdown"]',
          '[class*="text"]',
          'article',
          'p',
        ].join(',')).last().textContent().then(t => t?.trim() ?? '');
      }

      try {
        const videoUrl = await navigateToVideo();

        if (params.manual) {
          console.log('');
          console.log('════════════════════════════════════════════════════════════');
          console.log('  手动模式已启动');
          console.log('');
          console.log('  请在浏览器中执行以下操作：');
          console.log('  1. 点击视频播放器附近的 AI 图标');
          console.log('  2. 进入 F-lane 侧边栏');
          console.log('  3. 在输入框中输入提示词（如：提取当前视频的字幕信息）');
          console.log('  4. 点击发送按钮，等待 AI 生成响应');
          console.log('');
          console.log(`  等待超时：${params.waitTimeout!} 秒`);
          console.log(`  视频 URL：${videoUrl}`);
          console.log('════════════════════════════════════════════════════════════');
          console.log('');

          tips.push('手动模式：等待用户操作 AI 面板...');

          const iframeTimeout = Math.min(params.waitTimeout! * 1000, 60000);
          tips.push(`等待 iframe 出现（最多 ${iframeTimeout / 1000} 秒）...`);
          const frame = await findIframe(iframeTimeout);

          if (!frame) {
            tips.push('未检测到 AI iframe，尝试从页面内容提取...');
            const pageText = await page.evaluate((flaneSels) => {
              const selectors = [
                ...flaneSels,
                '[class*="ai"]',
                '[class*="chat"]',
                '[class*="message"]',
                '[class*="response"]',
              ];
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent && el.textContent.trim().length > 20) {
                  return el.textContent.trim();
                }
              }
              return '';
            }, FLANE_SELECTORS);

            if (pageText) {
              tips.push('从页面元素提取到内容');
              return ok({ subtitle: pageText, prompt: '(manual mode)', videoUrl, mode: 'manual' }, [...tips, '字幕提取完成']);
            }

            throw new Error('未检测到 AI 面板，请确认已在浏览器中打开 AI 侧边栏');
          }

          tips.push('检测到 iframe，等待 AI 内容生成...');
          const startTime = Date.now();
          let lastText = '';
          let stableCount = 0;
          const pollInterval = 3000;

          while (Date.now() - startTime < params.waitTimeout! * 1000) {
            await page.waitForTimeout(pollInterval);

            let currentText = '';
            try {
              currentText = await extractTextFromFrame(frame);
            } catch {
              // iframe might still be loading, continue polling
            }

            if (currentText && currentText.length > 30) {
              if (currentText === lastText) {
                stableCount++;
              } else {
                stableCount = 0;
                lastText = currentText;
              }

              if (stableCount >= 3) {
                tips.push(`内容已稳定（${Math.round((Date.now() - startTime) / 1000)} 秒）`);
                return ok({ subtitle: lastText, prompt: '(manual mode)', videoUrl, mode: 'manual' }, [...tips, '字幕提取完成']);
              }
            }

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            if (process.env.DEBUG) {
              console.log(`[debug] Polling... ${elapsed}s, text len: ${currentText.length}, stable: ${stableCount}`);
            }
          }

          if (lastText && lastText.length > 30) {
            tips.push('超时但已提取到部分内容');
            return ok({ subtitle: lastText, prompt: '(manual mode)', videoUrl, mode: 'manual' }, [...tips, '字幕提取完成（可能不完整）']);
          }

          throw new Error(`等待 AI 响应超时（${params.waitTimeout!} 秒），请确认已在 AI 面板中发送提示词`);
        }

        const aiPrompt = params.prompt ?? "提取当前视频的字幕信息";

        const videoIdMatch = videoUrl.match(/video\/(\d+)/);
        const videoId = videoIdMatch ? videoIdMatch[1] : "";

        if (!videoId) {
          throw new Error("无法从 URL 中提取视频 ID");
        }

        tips.push("导航到视频页面...");
        await page.goto(`${DOUYIN_BASE}/jingxuan?modal_id=${videoId}`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(5000);

        tips.push("hover 视频并点击 AI 图标...");
        await page.hover("video").catch(() => {});
        await page.waitForTimeout(2000);

        await page.evaluate(() => {
          const v = document.querySelector("video");
          if (!v) return;
          const vr = v.getBoundingClientRect();
          document.querySelectorAll("[class*=semi-icon]").forEach((icon) => {
            const r = icon.getBoundingClientRect();
            if (
              r.y > vr.y + vr.height * 0.7 &&
              r.x > vr.x + vr.width * 0.3 &&
              r.x < vr.x + vr.width * 0.7
            ) {
              icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
          });
        });
        tips.push("已点击播放器底部 AI 图标");

        tips.push("等待 AI iframe...");
        let aiFrame: import('../types').Frame | null = null;
        const frameDeadline = Date.now() + 15000;
        while (Date.now() < frameDeadline && !aiFrame) {
          aiFrame = page.frames().find((f) => f.url().includes("search_ai")) ?? null;
          if (!aiFrame) await page.waitForTimeout(2000);
        }

        if (!aiFrame) {
          throw new Error("未检测到 AI iframe，请确认 AI 功能正常");
        }
        tips.push("已定位到 AI iframe");

        tips.push("尝试点击\"视频总结\"按钮...");
        let usedSummary = false;
        try {
          await aiFrame.click("text=视频总结", { timeout: 3000 });
          usedSummary = true;
          tips.push("已点击\"视频总结\"按钮");
        } catch {
          tips.push("\"视频总结\"按钮不可用，fallback 到输入框");
          const input = await aiFrame.$("[contenteditable=true], textarea");
          if (input) {
            await input.fill(aiPrompt);
            tips.push(`已输入提示词: ${aiPrompt}`);
            await input.press("Enter");
            tips.push("已按 Enter 发送");
          } else {
            throw new Error("AI 面板中未找到输入框");
          }
        }

        tips.push("等待 AI 响应...");
        let subtitle = "";
        const maxRounds = 6;
        for (let i = 1; i <= maxRounds; i++) {
          await page.waitForTimeout(5000);
          let text = "";
          try {
            text = await aiFrame.evaluate(() => document.body.innerText);
          } catch {
            continue;
          }

          if (
            text.length > 300 &&
            !text.includes("你可能想问") &&
            !text.includes("更多功能指令")
          ) {
            subtitle = text;
            tips.push(`AI 响应完成（第 ${i} 轮，${i * 5} 秒）`);
            break;
          }

          if (process.env.DEBUG) {
            console.log(`[debug] Round ${i}/${maxRounds}, len: ${text.length}`);
          }
        }

        if (!subtitle) {
          throw new Error(`AI 响应超时（${maxRounds * 5} 秒），可使用 --manual 模式重试`);
        }

        return ok({ subtitle, prompt: usedSummary ? "视频总结" : aiPrompt, videoUrl, mode: "auto" }, [...tips, "字幕提取完成"]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
