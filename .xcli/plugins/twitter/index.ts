import { z } from 'zod/v4';
import { createHmac, randomBytes } from 'node:crypto';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type { Page } from '../types.js';

const execFileAsync = promisify(execFile);

interface TwitterMistakeRecorder {
  (input: {
    category: string;
    fingerprint?: string;
    command: string;
    message: string;
    context?: Record<string, unknown>;
  }): unknown;
}

interface ImageParameters {
  image?: string;
  images?: string;
}

interface ImageUploadResult {
  usedPaste: boolean;
  uploadMethod: 'none' | 'paste' | 'setInputFiles' | 'paste-then-setInputFiles';
  attachments: string[];
  imageCount: number;
}

type PageWithOptionalFront = Page & { bringToFront?: () => Promise<void> };

function recordTwitterMistake(
  command: 'post' | 'reply' | 'delete',
  reason: string,
  context: Record<string, unknown> = {},
): void {
  const recorder = (globalThis as Record<string, unknown>)
    .__xbrowserRecordMistake as TwitterMistakeRecorder | undefined;
  if (!recorder) return;
  const reasonCode = reason
    .replace(/\d+(?:\.\d+)?/g, '<number>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\s+/g, ' ')
    .trim();
  recorder({
    category: 'twitter-collector',
    fingerprint: `twitter-collector::${command}::${reasonCode}`,
    command: `twitter ${command}`,
    message: reason,
    context: { plugin: 'twitter', reason, ...context },
  });
}

function tweetIdOrUrl(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/status\/(\d+)/) ?? trimmed.match(/^(\d+)$/);
  const tweetId = match?.[1];
  if (!tweetId) throw new Error('无法从输入解析推文 ID');
  return tweetId;
}

interface TwitterApiCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function getTwitterApiCredentials(): TwitterApiCredentials | null {
  const credentials = {
    consumerKey: process.env.X_CONSUMER_KEY,
    consumerSecret: process.env.X_CONSUMER_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  if (
    !credentials.consumerKey ||
    !credentials.consumerSecret ||
    !credentials.accessToken ||
    !credentials.accessTokenSecret
  ) {
    return null;
  }
  return {
    consumerKey: credentials.consumerKey,
    consumerSecret: credentials.consumerSecret,
    accessToken: credentials.accessToken,
    accessTokenSecret: credentials.accessTokenSecret,
  };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function buildOauth1AuthorizationHeader(
  credentials: TwitterApiCredentials,
  method: string,
  url: string,
): string {
  const oauthParameters: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  const parameterString = Object.entries(oauthParameters)
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .sort()
    .join('&');
  const signatureBase = [
    method.toUpperCase(),
    encodeRfc3986(url),
    encodeRfc3986(parameterString),
  ].join('&');
  const signingKey = `${encodeRfc3986(credentials.consumerSecret)}&${encodeRfc3986(credentials.accessTokenSecret)}`;
  const signature = createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  return `OAuth ${[
    ...Object.entries(oauthParameters),
    ['oauth_signature', signature],
  ]
    .map(([key, value]) => `${encodeRfc3986(key)}="${encodeRfc3986(value)}"`)
    .sort()
    .join(', ')}`;
}

function collectImagePaths(params: ImageParameters): string[] {
  if (params.images !== undefined && params.images.trim() === '') {
    throw new Error('--images 不能为空');
  }

  const values = [
    ...(params.image ? [params.image] : []),
    ...(params.images ? params.images.split(',') : []),
  ];
  if (values.length === 0) return [];
  if (values.some(value => value.trim() === '')) {
    throw new Error('--images CSV 不能包含空路径');
  }
  if (values.some(value => value !== value.trim())) {
    throw new Error('--images CSV 路径不能包含首尾空格');
  }
  if (values.some(value => value.startsWith('~'))) {
    throw new Error('图片路径不支持 ~ 展开，请传绝对路径');
  }
  if (values.some(value => !path.isAbsolute(value))) {
    throw new Error('图片路径必须是绝对路径');
  }

  const unique = [...new Set(values)];
  if (unique.length > 4) throw new Error('Twitter/X 单条推文最多支持 4 张图片');

  const imageExtension = /\.(?:png|jpe?g|gif|webp)$/i;
  for (const value of unique) {
    if (!imageExtension.test(value)) throw new Error(`不是支持的图片文件: ${value}`);
    const stat = fs.statSync(value, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`图片文件不存在: ${value}`);
  }
  return unique;
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function writeClipboardImage(filePath: string): Promise<void> {
  await execFileAsync(
    'osascript',
    ['-e', `set the clipboard to (read (POSIX file "${appleScriptString(filePath)}") as \u00abclass PNGf\u00bb)`],
    { timeout: 5000 },
  );
}

async function sendPasteKeystroke(page: Page, filePath: string): Promise<void> {
  if (process.env.XBROWSER_TWITTER_TEST_PASTE === '1') {
    const bytes = await fs.promises.readFile(filePath);
    await page.evaluate(async (payload: { data: string; name: string }) => {
      const binary = atob(payload.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], payload.name, { type: 'image/png' }));
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: transfer });
      document.querySelector('[data-testid="tweetTextarea_0"]')?.dispatchEvent(event);
    }, { data: bytes.toString('base64'), name: path.basename(filePath) });
    return;
  }

  await execFileAsync(
    'osascript',
    ['-e', 'tell application "Google Chrome" to activate'],
    { timeout: 5000 },
  );
  await page.waitForTimeout(200);
  await execFileAsync(
    'osascript',
    ['-e', 'tell application "System Events" to keystroke "v" using command down'],
    { timeout: 5000 },
  );
}

async function countAttachments(page: Page): Promise<number> {
  return page.evaluate<number>(`
    document.querySelectorAll(
      '[data-testid="attachments"] [data-testid="photoSelectorPreview"], [data-testid="photoSelectorPreview"], [data-testid="attachments"] img'
    ).length
  `);
}

async function waitForAttachmentCount(
  page: Page,
  expected: number,
  timeoutMs = 10_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let current = -1;
  while (Date.now() < deadline) {
    current = await countAttachments(page);
    if (current >= expected) return current;
    await page.waitForTimeout(250);
  }
  throw new Error(`等待附件预览超时：当前 ${current}，期望 ${expected}`);
}

async function pasteImages(
  page: Page,
  filePaths: string[],
): Promise<{ ok: boolean; pasted: number; reason?: string }> {
  let pasted = 0;
  for (const filePath of filePaths) {
    try {
      await (page as PageWithOptionalFront).bringToFront?.();
      const editor = page.locator('[data-testid="tweetTextarea_0"]');
      await editor.click({ timeout: 5000 });
      if (process.env.XBROWSER_TWITTER_TEST_PASTE !== '1') {
        await writeClipboardImage(filePath);
      }
      await sendPasteKeystroke(page, filePath);
      await waitForAttachmentCount(page, pasted + 1, 12_000);
      pasted += 1;
    } catch (error) {
      return {
        ok: false,
        pasted,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true, pasted };
}

function imageMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

async function uploadViaFileInput(page: Page, filePaths: string[]): Promise<void> {
  const files = await Promise.all(filePaths.map(async filePath => ({
    name: path.basename(filePath),
    mimeType: imageMimeType(filePath),
    buffer: await fs.promises.readFile(filePath),
  })));
  await page.setInputFiles('input[type="file"]', files, { timeout: 10_000 });
}

async function uploadImages(
  page: Page,
  params: ImageParameters,
  command: 'post' | 'reply',
): Promise<ImageUploadResult> {
  const filePaths = collectImagePaths(params);
  if (filePaths.length === 0) {
    return {
      usedPaste: false,
      uploadMethod: 'none',
      attachments: [],
      imageCount: 0,
    };
  }

  const initialCount = await countAttachments(page).catch(() => 0);
  let pasted = 0;
  let pasteReason: string | undefined;
  const canPaste = process.env.XBROWSER_TWITTER_DISABLE_PASTE !== '1'
    && (
      process.platform === 'darwin'
      || process.env.XBROWSER_TWITTER_FORCE_PASTE === '1'
      || process.env.XBROWSER_TWITTER_TEST_PASTE === '1'
    );

  if (canPaste) {
    const result = await pasteImages(page, filePaths);
    pasted = result.pasted;
    pasteReason = result.reason;
    if (!result.ok && result.pasted > 0) {
      const currentCount = await countAttachments(page).catch(() => -1);
      if (currentCount !== initialCount + result.pasted) {
        const reason = `剪贴板粘贴部分成功后状态不确定: ${pasteReason}`;
        recordTwitterMistake(command, reason, {
          expectedCount: filePaths.length,
          pastedCount: result.pasted,
          currentCount,
        });
        throw new Error(reason);
      }
    }
  }

  const remaining = filePaths.slice(pasted);
  if (remaining.length > 0) {
    try {
      await uploadViaFileInput(page, remaining);
      await waitForAttachmentCount(page, initialCount + filePaths.length);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordTwitterMistake(command, reason, {
        expectedCount: filePaths.length,
        pastedCount: pasted,
        fallbackCount: remaining.length,
        pasteReason,
      });
      throw new Error(`图片上传失败: ${reason}`);
    }
  }

  const finalCount = await waitForAttachmentCount(page, initialCount + filePaths.length);
  if (finalCount !== initialCount + filePaths.length) {
    const reason = `附件数量校验失败: 当前 ${finalCount}，期望 ${initialCount + filePaths.length}`;
    recordTwitterMistake(command, reason, {
      expectedCount: filePaths.length,
      currentCount: finalCount,
    });
    throw new Error(reason);
  }

  return {
    usedPaste: pasted > 0,
    uploadMethod: pasted === 0
      ? 'setInputFiles'
      : remaining.length > 0
        ? 'paste-then-setInputFiles'
        : 'paste',
    attachments: filePaths.map(filePath => path.basename(filePath)),
    imageCount: filePaths.length,
  };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'twitter',
    url: 'https://x.com',
    description: 'X (Twitter) - 社交媒体内容采集（XHR 拦截模式，数据更丰富）',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login') || url.includes('/i/flow/login')) return false;
        const hasLoginBtn = await page.locator('a[href*="/login"], [data-testid="loginButton"]').first().isVisible().catch(() => false);
        if (hasLoginBtn) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
        if (!body) return false;
        if (body.includes('Sign in')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  const BASE = 'https://x.com';

  // ─── 工具 ──────────────────────────────────────

  function buildTips(ctx: Record<string, unknown>): string[] {
    const tips: string[] = [];
    if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
    tips.push(`Session: ${ctx.sessionId || 'default'}`);
    return tips;
  }

  // ─── 1. search ─────────────────────────────────

  site.command('search', {
    description: '搜索 X/Twitter 推文（API 拦截模式）',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser twitter search --query "OpenAI"', description: '搜索 OpenAI 相关推文' },
    ],
    result: z.object({ query: z.string(), count: z.number(), tweets: z.array(z.object({ author: z.string(), text: z.string(), time: z.string(), likes: z.string(), retweets: z.string(), replies: z.string(), link: z.string() })) }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      // 搜素 API 的 pattern 是 SearchTimeline
      // 直接用 DOM 方式，因为搜索页的 GraphQL 端点名复杂
      await page.goto(`${BASE}/search?q=${encodeURIComponent(params.query)}&src=typed_query&f=top`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);

      const results = await page.evaluate((limit) => {
        const tweets: Array<Record<string, unknown>> = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        articles.forEach((article, i) => {
          if (i >= limit) return;
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const timeEl = article.querySelector('time');
          const likeEl = article.querySelector('[data-testid="like"]');
          const retweetEl = article.querySelector('[data-testid="retweet"]');
          const replyEl = article.querySelector('[data-testid="reply"]');
          const linkEl = article.querySelector('a[href*="/status/"]');
          const nameEl = article.querySelector('[data-testid="User-Name"]');
          tweets.push({
            author: nameEl?.textContent?.trim() || '',
            text: textEl?.textContent?.trim() || '',
            time: timeEl?.getAttribute('datetime') || '',
            likes: likeEl?.textContent?.trim() || '0',
            retweets: retweetEl?.textContent?.trim() || '0',
            replies: replyEl?.textContent?.trim() || '0',
            link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
          });
        });
        return tweets;
      }, params.limit) as Array<Record<string, unknown>>;

      return ok({ query: params.query, count: results.length, tweets: results }, tips);
    },
  });

  // ─── 2. profile ────────────────────────────────

  site.command('profile', {
    description: '获取 X/Twitter 用户资料（API 拦截模式，含丰富指标）',
    scope: 'browser',
    parameters: z.object({
      username: z.string().describe('用户名（不含 @）'),
    }),
    examples: [
      { cmd: 'xbrowser twitter profile --username "elonmusk"', description: '获取 Elon Musk 资料' },
    ],
    result: z.object({ name: z.string().optional(), screenName: z.string().optional(), description: z.string().optional(), bio: z.string().optional(), location: z.string().optional(), url: z.string().optional(), followersCount: z.number().optional(), followingCount: z.number().optional(), tweetCount: z.number().optional(), avatar: z.string().optional(), source: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      // 拦截 UserByScreenName（用户信息）+ 其他端点
      let userData: Record<string, unknown> | null = null;

      page.on('response', async (resp) => {
        const url = resp.url();
        if (url.includes('UserByScreenName') || url.includes('ProfileSpotlights')) {
          try {
              const text = await resp.text();
              const json = JSON.parse(text);
              const result = (json?.data?.user?.result || json?.data?.user_result?.result || {}) as Record<string, unknown>;
            if (result?.legacy) {
              const legacy = result.legacy as Record<string, unknown>;
              userData = {
                id: result.rest_id as string,
                name: legacy.name as string,
                screenName: legacy.screen_name as string,
                description: legacy.description as string,
                location: legacy.location as string,
                url: legacy.url as string,
                followersCount: legacy.followers_count,
                followingCount: legacy.friends_count,
                tweetCount: legacy.statuses_count,
                listedCount: legacy.listed_count,
                mediaCount: legacy.media_count,
                createdAt: legacy.created_at as string,
                avatar: (legacy.profile_image_url_https as string)?.replace('_normal', ''),
                banner: legacy.profile_banner_url as string,
                verified: !!legacy.verified,
                hasCustomTimeline: result.has_custom_timelines,
                professional: !!result.is_blue_verified,
                // 额外指标
                fastFollowersCount: legacy.fast_followers_count,
                normalFollowersCount: legacy.normal_followers_count,
                favouritesCount: legacy.favourites_count,
                wantsToBeNotified: legacy.wants_to_be_notified,
              };
            }
          } catch (e) {
            if (process.env.DEBUG) console.warn('[twitter] response parse error:', (e as Error).message);
          }
        }
      });

      await page.goto(`${BASE}/${params.username}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);

      if (!userData) {
        // DOM 兜底
        userData = await page.evaluate(() => {
          const name = document.querySelector('[data-testid="UserName"]')?.textContent?.trim() || '';
          const bio = document.querySelector('[data-testid="UserDescription"]')?.textContent?.trim() || '';
          return { name, bio, source: 'dom' };
        }) as Record<string, unknown>;
      }

      return ok(userData, [...tips, `用户: ${userData?.name || params.username}`]);
    },
  });

  // ─── 3. timeline ───────────────────────────────

  site.command('timeline', {
    description: '获取 X/Twitter 用户最新推文（API 拦截模式，含 views/bookmarks 等）',
    scope: 'browser',
    parameters: z.object({
      username: z.string().describe('用户名（不含 @）'),
      limit: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser twitter timeline --username "elonmusk"', description: '获取 Elon Musk 最新推文' },
    ],
    result: z.object({ username: z.string(), count: z.number(), tweets: z.array(z.record(z.string(), z.any())), source: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);
      const capturedTweets: Array<Record<string, unknown>> = [];

      // 用 waitForResponse 等 UserTweets API 返回（可能在 SSR 后通过滚动触发）
      const responsePromise = page.waitForResponse(
        resp => resp.url().includes('UserTweets') && resp.status() === 200,
        { timeout: 25000 }
      ).catch(() => null);

      await page.goto(`${BASE}/${params.username}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollBy(0, 600));

      const apiResp = await responsePromise;
      if (apiResp) {
        const text = await apiResp.text();
        try {
          const json = JSON.parse(text);
          const instructions = (json?.data?.user?.result?.timeline_v2?.timeline?.instructions || []) as Array<Record<string, unknown>>;
          for (const inst of instructions) {
            const entries = (inst?.entries || []) as Array<Record<string, unknown>>;
            for (const entry of entries) {
              const content = entry?.content as Record<string, unknown> | undefined;
              const itemContent = content?.itemContent as Record<string, unknown> | undefined;
              const tweetResults = itemContent?.tweet_results as Record<string, unknown> | undefined;
              const result = (tweetResults?.result || {}) as Record<string, unknown>;
              if (!result?.legacy || capturedTweets.length >= params.limit) continue;
              const legacy = result.legacy as Record<string, unknown>;
              const extEntities = legacy.extended_entities as Record<string, unknown> | undefined;
              const extMedia = (extEntities?.media || []) as Array<Record<string, unknown>>;
              capturedTweets.push({
                id: result.rest_id,
                text: (legacy.full_text as string || ''),
                likes: Number(legacy.favorite_count) || 0,
                retweets: Number(legacy.retweet_count) || 0,
                mediaUrls: extMedia.map((m: Record<string, unknown>) => (m.media_url_https as string) || ''),
              });
            }
          }
        } catch { /* ignore parse errors */ }
      }

      const tweets = capturedTweets.slice(0, params.limit);
      await page.waitForTimeout(2000);

      // API 没捕获到时 DOM 兜底
      if (tweets.length === 0) {
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(2000);
        const domTweets = await page.evaluate((limit) => {
          const items: Array<Record<string, string>> = [];
          document.querySelectorAll('article[data-testid="tweet"]').forEach((a, i) => {
            if (i >= limit) return;
            items.push({
              text: (a.querySelector('[data-testid="tweetText"]')?.textContent || '').trim(),
              time: (a.querySelector('time')?.getAttribute('datetime') || ''),
              likes: (a.querySelector('[data-testid="like"]')?.textContent || '').trim(),
            });
          });
          return items;
        }, params.limit) as Array<Record<string, string>>;
        return ok({ username: params.username, count: domTweets.length, tweets: domTweets, source: 'dom(api fallback)' }, tips);
      }

      return ok({ username: params.username, count: tweets.length, tweets, source: 'api' }, [...tips, `${params.username} 最近 ${tweets.length} 条推文（API 模式）`]);
    },
  });

  // ─── 4. replies ────────────────────────────────

  site.command('replies', {
    description: '获取推文的回复（API 拦截模式）',
    scope: 'browser',
    parameters: z.object({
      id: z.string().describe('推文 ID'),
      limit: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser twitter replies --id "123456789"', description: '获取推文回复' },
    ],
    result: z.object({ tweetId: z.string(), count: z.number(), replies: z.array(z.record(z.string(), z.any())) }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);
      const captured: Array<Record<string, unknown>> = [];

      page.on('response', async (resp) => {
        const url = resp.url();
        if (!url.includes('TweetDetail')) return;
        try {
          const json = JSON.parse(await resp.text());
          const entries = (json?.data?.threaded_conversation_with_injections_v2?.instructions?.[0]?.entries || []) as Array<Record<string, unknown>>;
          for (const entry of entries) {
            const content = (entry?.content as Record<string, unknown>) ?? {};
            const itemContent = content.itemContent as Record<string, unknown> | undefined;
            const tweetResults = itemContent?.tweet_results as Record<string, unknown> | undefined;
            const result = (tweetResults?.result) as Record<string, unknown> | undefined;
            if (!result?.legacy || captured.length >= params.limit) continue;
            const legacy = result.legacy as Record<string, unknown>;
            captured.push({
              id: result.rest_id as string,
              text: legacy.full_text as string,
              user: (legacy.user_id_str as string),
              createdAt: legacy.created_at as string,
              likes: legacy.favorite_count,
              retweets: legacy.retweet_count,
              replies: legacy.reply_count,
              lang: legacy.lang,
            });
          }
        } catch (e) {
          if (process.env.DEBUG) console.warn('[twitter] response parse error:', (e as Error).message);
        }
      });

      await page.goto(`${BASE}/i/status/${params.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);

      const replies = captured.slice(0, params.limit);
      tips.push(`找到 ${replies.length} 条回复`);

      return ok({ tweetId: params.id, count: replies.length, replies }, tips);
    },
  });

  // ─── 5. liked ──────────────────────────────────

  site.command('liked', {
    description: '获取用户点赞的推文',
    scope: 'browser',
    parameters: z.object({
      username: z.string().describe('用户名（不含 @）'),
      limit: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser twitter liked --username "elonmusk"', description: '获取 Elon Musk 点赞' },
    ],
    result: z.object({ username: z.string(), count: z.number(), tweets: z.array(z.object({ author: z.string(), text: z.string(), time: z.string(), likes: z.string() })) }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      await page.goto(`${BASE}/${params.username}/likes`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(2000);

      const tweets = await page.evaluate((limit) => {
        const items: Array<Record<string, string>> = [];
        document.querySelectorAll('article[data-testid="tweet"]').forEach((a, i) => {
          if (i >= limit) return;
          const textEl = a.querySelector('[data-testid="tweetText"]');
          const timeEl = a.querySelector('time');
          const likeEl = a.querySelector('[data-testid="like"]');
          const nameEl = a.querySelector('[data-testid="User-Name"]');
          items.push({
            author: nameEl?.textContent?.trim() || '',
            text: textEl?.textContent?.trim() || '',
            time: timeEl?.getAttribute('datetime') || '',
            likes: likeEl?.textContent?.trim() || '0',
          });
        });
        return items;
      }, params.limit) as Array<Record<string, string>>;

      return ok({ username: params.username, count: tweets.length, tweets }, tips);
    },
  });

  // ─── 6. search-image ───────────────────────────

  site.command('search-image', {
    description: 'Twitter/X 图片搜索',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
      timeout: z.number().optional().default(20000),
    }),
    result: z.object({ query: z.string(), engine: z.string(), results: z.array(z.object({ title: z.string(), thumbnailUrl: z.string(), sourceUrl: z.string(), originalUrl: z.string(), width: z.number(), height: z.number(), format: z.string(), sourceSite: z.string() })), total: z.number(), timestamp: z.number() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        await page.goto(`https://x.com/search?q=${encodeURIComponent(params.query)}%20filter%3Aimages&f=live`, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(5000);
        for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await page.waitForTimeout(600); }
        const results = await page.evaluate((limit) => {
          const imgs: Array<Record<string, unknown>> = [];
          document.querySelectorAll('img[src*="pbs.twimg"]').forEach((img) => {
            if (imgs.length >= limit) return;
            const el = img as HTMLImageElement;
            if (el.width < 80) return;
            const src = el.src || '';
            imgs.push({
              title: el.alt || '', thumbnailUrl: src, sourceUrl: el.closest('a')?.href || '',
              originalUrl: src.replace(/name=\w+/, 'name=orig'), width: el.naturalWidth || 0,
              height: el.naturalHeight || 0, format: 'jpg', sourceSite: 'twitter',
            });
          });
          return imgs;
        }, params.limit) as Array<Record<string, unknown>>;
        return ok({ query: params.query, engine: 'twitter', results, total: results.length, timestamp: Date.now() }, [`Twitter "${params.query}"，共 ${results.length} 张`]);
      } catch (error) { return fail(error instanceof Error ? error.message : '未知错误'); }
    },
  });

  // ─── 7. post (发推) ───────────────────────────

  site.command('post', {
    description: '在 X/Twitter 发布推文',
    scope: 'browser',
    parameters: z.object({
      text: z.string().min(1).max(280).describe('推文内容（最多280字符）'),
      image: z.string().optional().describe('单张图片的绝对路径'),
      images: z.string().optional().describe('多张图片的绝对路径 CSV（最多4张）'),
    }),
    examples: [
      { cmd: 'xbrowser twitter post --text "Hello World!"', description: '发布一条推文' },
    ],
    result: z.object({
      posted: z.boolean(),
      text: z.string(),
      usedPaste: z.boolean(),
      uploadMethod: z.enum(['none', 'paste', 'setInputFiles', 'paste-then-setInputFiles']),
      attachments: z.array(z.string()),
      imageCount: z.number(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click the compose box
        const editor = page.locator('[data-testid="tweetTextarea_0"]');
        await editor.waitFor({ state: 'visible', timeout: 10000 });
        await editor.click();
        await page.waitForTimeout(500);

        // Type the text
        await page.keyboard.type(params.text, { delay: 30 });
        await page.waitForTimeout(500);

        const upload = await uploadImages(page, params, 'post');

        // Click tweet button
        const tweetBtn = page.locator('[data-testid="tweetButton"]');
        await tweetBtn.waitFor({ state: 'visible', timeout: 5000 });
        await tweetBtn.click();
        await page.waitForTimeout(3000);

        return ok({
          posted: true,
          text: params.text,
          usedPaste: upload.usedPaste,
          uploadMethod: upload.uploadMethod,
          attachments: upload.attachments,
          imageCount: upload.imageCount,
        }, ['推文已发布', ...tips]);
      } catch (error) {
        if (error instanceof Error) recordTwitterMistake('post', error.message, { command: 'post' });
        return fail(error instanceof Error ? error.message : '发布失败');
      }
    },
  });

  // ─── 12. post-api (OAuth 1.0a) ───────────────

  site.command('post-api', {
    description: '通过 X API v2 发布推文（适合 CI）',
    scope: 'cli',
    parameters: z.object({
      text: z.string().min(1).max(280).describe('推文内容（最多280字符）'),
      image: z.string().optional().describe('单张图片绝对路径（JPEG/PNG/GIF/WEBP）'),
    }),
    examples: [
      { cmd: 'xbrowser twitter post-api --text "Release ready"', description: '通过 API 发布版本推文' },
    ],
    result: z.object({
      posted: z.boolean(),
      id: z.string(),
      text: z.string(),
    }).passthrough(),
    handler: async params => {
      const credentials = getTwitterApiCredentials();
      if (!credentials) {
        return fail('缺少 X API 环境变量', [
          '需要 X_CONSUMER_KEY / X_CONSUMER_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET',
        ]);
      }

      try {
        let mediaId: string | undefined;
        if (params.image) {
          if (!path.isAbsolute(params.image)) {
            return fail('图片路径必须是绝对路径');
          }
          const media = await fs.promises.readFile(params.image);
          const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
          const uploadForm = new FormData();
          uploadForm.append('media_data', media.toString('base64'));
          const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: buildOauth1AuthorizationHeader(credentials, 'POST', uploadUrl),
            },
            body: uploadForm,
          });
          const uploadResult = await uploadResponse.json() as {
            media_id_string?: string;
            errors?: Array<{ message?: string }>;
          };
          if (!uploadResponse.ok || !uploadResult.media_id_string) {
            return fail(uploadResult.errors?.[0]?.message || `图片上传失败 (HTTP ${uploadResponse.status})`);
          }
          mediaId = uploadResult.media_id_string;
        }

        const tweetUrl = 'https://api.twitter.com/2/tweets';
        const response = await fetch(tweetUrl, {
          method: 'POST',
          headers: {
            Authorization: buildOauth1AuthorizationHeader(credentials, 'POST', tweetUrl),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: params.text,
            ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
          }),
        });
        const result = await response.json() as {
          data?: { id?: string; text?: string };
          title?: string;
          detail?: string;
        };
        if (!response.ok || !result.data?.id) {
          return fail(result.detail || result.title || `发布推文失败 (HTTP ${response.status})`);
        }

        return ok({
          posted: true,
          id: result.data.id,
          text: result.data.text || params.text,
        }, ['推文已通过 X API 发布']);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        recordTwitterMistake('post', reason, { command: 'post-api' });
        return fail(reason);
      }
    },
  });

  // ─── 8. reply (回复推文) ───────────────────────

  site.command('reply', {
    description: '回复指定推文',
    scope: 'browser',
    parameters: z.object({
      tweetUrl: z.string().describe('推文 URL（如 https://x.com/user/status/123）'),
      text: z.string().min(1).max(280).describe('回复内容'),
      image: z.string().optional().describe('单张图片的绝对路径'),
      images: z.string().optional().describe('多张图片的绝对路径 CSV（最多4张）'),
    }),
    examples: [
      { cmd: 'xbrowser twitter reply --tweetUrl "https://x.com/user/status/123" --text "Great!"', description: '回复推文' },
    ],
    result: z.object({
      replied: z.boolean(),
      text: z.string(),
      usedPaste: z.boolean(),
      uploadMethod: z.enum(['none', 'paste', 'setInputFiles', 'paste-then-setInputFiles']),
      attachments: z.array(z.string()),
      imageCount: z.number(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.tweetUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click the reply box
        const editor = page.locator('[data-testid="tweetTextarea_0"]');
        await editor.waitFor({ state: 'visible', timeout: 10000 });
        await editor.click();
        await page.waitForTimeout(500);

        await page.keyboard.type(params.text, { delay: 30 });
        await page.waitForTimeout(500);

        const upload = await uploadImages(page, params, 'reply');

        const replyBtn = page.locator('[data-testid="tweetButton"]');
        await replyBtn.waitFor({ state: 'visible', timeout: 5000 });
        await replyBtn.click();
        await page.waitForTimeout(3000);

        return ok({
          replied: true,
          text: params.text,
          usedPaste: upload.usedPaste,
          uploadMethod: upload.uploadMethod,
          attachments: upload.attachments,
          imageCount: upload.imageCount,
        }, ['回复已发布', ...tips]);
      } catch (error) {
        if (error instanceof Error) recordTwitterMistake('reply', error.message, { command: 'reply' });
        return fail(error instanceof Error ? error.message : '回复失败');
      }
    },
  });

  // ─── 9. retweet (转发) ─────────────────────────

  site.command('retweet', {
    description: '转发指定推文',
    scope: 'browser',
    parameters: z.object({
      tweetUrl: z.string().describe('推文 URL'),
      quote: z.boolean().optional().default(false).describe('是否引用转发（默认普通转发）'),
      quoteText: z.string().max(280).optional().describe('引用转发时的文字'),
    }),
    examples: [
      { cmd: 'xbrowser twitter retweet --tweetUrl "https://x.com/user/status/123"', description: '转发推文' },
      { cmd: 'xbrowser twitter retweet --tweetUrl "..." --quote --quoteText "My comment"', description: '引用转发' },
    ],
    result: z.object({ retweeted: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.tweetUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click retweet button
        const retweetBtn = page.locator('[data-testid="retweet"]');
        await retweetBtn.waitFor({ state: 'visible', timeout: 10000 });
        await retweetBtn.click();
        await page.waitForTimeout(1000);

        if (params.quote) {
          // Click "Quote" option
          const quoteBtn = page.locator('a[href*="/compose/post"], [role="menuitem"]').filter({ hasText: /Quote/i });
          await quoteBtn.first().click();
          await page.waitForTimeout(2000);

          if (params.quoteText) {
            const editor = page.locator('[data-testid="tweetTextarea_0"]');
            await editor.click();
            await page.keyboard.type(params.quoteText, { delay: 30 });
            await page.waitForTimeout(500);
          }

          const postBtn = page.locator('[data-testid="tweetButton"]');
          await postBtn.click();
        } else {
          // Click "Repost" confirmation
          const confirmBtn = page.locator('[data-testid="retweetConfirm"]');
          await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
          await confirmBtn.click();
        }

        await page.waitForTimeout(3000);
        return ok({ retweeted: true }, ['转发成功', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '转发失败');
      }
    },
  });

  // ─── 10. like (点赞) ───────────────────────────

  site.command('like', {
    description: '点赞指定推文',
    scope: 'browser',
    parameters: z.object({
      tweetUrl: z.string().describe('推文 URL'),
    }),
    examples: [
      { cmd: 'xbrowser twitter like --tweetUrl "https://x.com/user/status/123"', description: '点赞推文' },
    ],
    result: z.object({ liked: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.tweetUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const likeBtn = page.locator('[data-testid="like"]').first();
        await likeBtn.waitFor({ state: 'visible', timeout: 10000 });
        await likeBtn.click();
        await page.waitForTimeout(2000);

        return ok({ liked: true }, ['点赞成功', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '点赞失败');
      }
    },
  });

  // ─── 11. delete (删除推文) ────────────────────

  site.command('delete', {
    description: '删除指定推文',
    scope: 'browser',
    loginRequired: 'required',
    parameters: z.object({
      tweet: z.string().describe('推文 ID 或推文 URL'),
    }),
    examples: [
      { cmd: 'xbrowser twitter delete --tweet 1234567890', description: '按 ID 删除推文' },
      { cmd: 'xbrowser twitter delete --tweet "https://x.com/user/status/1234567890"', description: '按 URL 删除推文' },
    ],
    result: z.object({ deleted: z.boolean(), tweetId: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        const tweetId = tweetIdOrUrl(params.tweet);
        await page.goto(`${BASE}/i/status/${tweetId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        const article = page.locator('article[data-testid="tweet"]').first();
        try {
          await article.waitFor({ state: 'visible', timeout: 10_000 });
        } catch {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          if (/页面不存在|post (?:does not|doesn't) exist|post is unavailable/i.test(bodyText)) {
            throw new Error('目标推文不存在或不可访问');
          }
          throw new Error('目标推文未能加载，未执行删除');
        }

        // First tweet on a status page is the target tweet; open its action menu.
        const menu = page.locator('article[data-testid="tweet"] [data-testid="caret"]').first();
        await menu.waitFor({ state: 'visible', timeout: 5000 });
        await menu.click();
        await page.waitForTimeout(500);

        const deleteItem = page.locator('[role="menuitem"]').first();
        await deleteItem.waitFor({ state: 'visible', timeout: 5000 });
        const deleteLabel = (await deleteItem.innerText()).trim();
        if (!/^(delete|删除)$/i.test(deleteLabel)) {
          throw new Error('目标推文不属于当前账号，或菜单中没有删除选项');
        }
        await deleteItem.click();
        await page.waitForTimeout(500);

        const confirm = page.locator('button[data-testid="confirmationSheetConfirm"]');
        await confirm.waitFor({ state: 'visible', timeout: 5000 });
        await confirm.click();
        await page.waitForTimeout(4000);

        const currentUrl = await page.evaluate<string>('location.href');
        const remainsOnTweet = currentUrl.includes(`/status/${tweetId}`);
        const tweetStillVisible = await page.evaluate<boolean>((args: unknown[]) => {
          const id = String(args[0] ?? '');
          return [...document.querySelectorAll('article[data-testid="tweet"]')].some(article =>
            [...article.querySelectorAll('a[href]')].some(link =>
              new URL((link as HTMLAnchorElement).href, location.href).pathname
                .split('/').some((segment, index, segments) => segment === 'status' && segments[index + 1] === id),
            ),
          );
        }, [tweetId]);
        if (remainsOnTweet || tweetStillVisible) {
          throw new Error('X 未离开目标推文页面，无法确认删除成功');
        }

        return ok({ deleted: true, tweetId }, ['推文已删除', ...tips]);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        recordTwitterMistake('delete', reason, { tweet: params.tweet });
        return fail(`删除推文失败：${reason}`);
      }
    },
  });

  // ─── login/logout ──────────────────────────────

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page | undefined;
    console.log('⚠️  请使用 --cdp 参数连接到已登录 X.com 的浏览器');
    console.log('     xbrowser twitter timeline --username elonmusk --cdp http://localhost:9221');
    if (page) {
      await page.goto('https://x.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  });

  site.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出 X.com');
  });
}
