import { z } from 'zod';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import type { Page } from 'playwright';

const TWITTER_BASE = 'https://x.com';

interface TweetData {
  author: string;
  handle: string;
  text: string;
  time: string;
  link: string;
}

interface TweetWithStats extends TweetData {
  likes: string;
  retweets: string;
  replies: string;
  id: string;
}

interface TweetDetail extends TweetWithStats {
  retweets: string;
  quotes: string;
  images: string[];
  videos: string[];
}

interface BrowserCtx extends CommandContext {
  page?: Page;
  cdpEndpoint?: string;
  sessionId?: string;
}

const HIGH_PROFILE_USERS = new Set(['elonmusk', 'realdonaldtrump', 'realdonaldtrump_backup']);

const HIGH_PROFILE_CONFIG = {
  waitTimeout: 20000,
  scrollIterations: 8,
  scrollDelay: 1500,
  retryAttempts: 3,
};

const NORMAL_CONFIG = {
  waitTimeout: 15000,
  scrollIterations: 5,
  scrollDelay: 1000,
  retryAttempts: 1,
};

function getPage(ctx: CommandContext): Page {
  const browserCtx = ctx as BrowserCtx;
  const page = browserCtx.page;
  if (!page) throw new Error('需要浏览器页面');
  return page;
}

function getSessionId(ctx: CommandContext): string {
  return (ctx as BrowserCtx).sessionId || 'default';
}

function hasCdp(ctx: CommandContext): boolean {
  return !!(ctx as BrowserCtx).cdpEndpoint;
}

async function waitForContent(page: Page, selector: string, timeout = 10000): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout, state: 'attached' });
  } catch {
    console.warn(`Selector ${selector} not found, continuing anyway`);
  }
}

async function simulateHumanScroll(page: Page): Promise<void> {
  const shouldScrollBack = Math.random() < 0.15;
  if (shouldScrollBack) {
    await page.evaluate(() => window.scrollBy(0, -(Math.random() * 200 + 100)));
    await page.waitForTimeout(Math.random() * 500 + 200);
  }
  const scrollAmount = Math.random() * 500 + 500;
  await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
  await page.waitForTimeout(Math.random() * 1000 + 500);
}

const TWEET_EXTRACT_SCRIPT = () => {
  function smartSelect(el: Element | Document, sels: string[]): Element | null {
    for (const s of sels) {
      const found = el.querySelector(s);
      if (found) return found;
    }
    return null;
  }

  function extractTweetId(url: string): string {
    const m = url.match(/\/status\/(\d+)/);
    return m ? m[1] : '';
  }

  function parseUserInfo(userEl: Element | null): { author: string; handle: string } {
    const fullName = userEl?.textContent?.trim() || '';
    const handleMatch = fullName.match(/@[\w.]+/);
    return {
      author: fullName.split('@')[0]?.trim() || '',
      handle: handleMatch?.[0] || '',
    };
  }

  function parseTime(timeEl: Element | null): string {
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  }

  window.__tw = { smartSelect, extractTweetId, parseUserInfo, parseTime };
};

declare global {
  interface Window {
    __tw?: {
      smartSelect: (el: Element | Document, sels: string[]) => Element | null;
      extractTweetId: (url: string) => string;
      parseUserInfo: (userEl: Element | null) => { author: string; handle: string };
      parseTime: (timeEl: Element | null) => string;
    };
  }
}

async function injectHelpers(page: Page): Promise<void> {
  await page.evaluate(TWEET_EXTRACT_SCRIPT);
}

function buildCdpWarning(): string {
  return '建议使用 --cdp 9221 参数连接到 Chrome 浏览器';
}

function buildCdpMissingResult(tips: string[]) {
  return { data: null, tips, message: '未检测到 CDP 连接，可能无法获取登录态数据' };
}

function buildErrorResult(tip: string, error: unknown) {
  return { data: null, tips: [tip], message: error instanceof Error ? error.message : '未知错误' };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'twitter',
    url: TWITTER_BASE,
    description: 'X (Twitter) - 社交媒体内容采集',
    requiresLogin: false,
  });

  site.command('search', {
    description: '搜索 X/Twitter 推文',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser twitter search --query "OpenAI"', description: '搜索 OpenAI 相关推文' },
    ],
    handler: async (params, ctx) => {
      try {
        const tips: string[] = [];
        if (!hasCdp(ctx)) return buildCdpMissingResult([buildCdpWarning()]);
        tips.push(`Session: ${getSessionId(ctx)}`);
        const page = getPage(ctx);

        const url = `${TWITTER_BASE}/search?q=${encodeURIComponent(params.query)}&src=typed_query&f=top`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await waitForContent(page, 'article[data-testid="tweet"]', 15000);
        await injectHelpers(page);

        const results = await page.evaluate((limit) => {
          const tw = window.__tw!;
          const tweets: Array<TweetData & { likes: string; retweets: string }> = [];
          const articles = document.querySelectorAll('article[data-testid="tweet"], [class*="tweet"]');

          articles.forEach((article, i) => {
            if (i >= limit) return;
            const userEl = tw.smartSelect(article, ['[data-testid="User-Name"] a', '[class*="username"]', 'a[href*="/"][tabindex="-1"]']);
            const textEl = tw.smartSelect(article, ['[data-testid="tweetText"]', '[class*="tweet-text"]', '[class*="css-901oao"]']);
            const timeEl = tw.smartSelect(article, ['time', '[class*="time"]', 'span[class*="timestamp"]']);
            const likeEl = tw.smartSelect(article, ['[data-testid="like"]', '[class*="like"]']);
            const retweetEl = tw.smartSelect(article, ['[data-testid="retweet"]', '[class*="retweet"]']);
            const linkEl = article.querySelector('a[href*="/status/"]');
            const user = tw.parseUserInfo(userEl);
            const link = linkEl instanceof HTMLAnchorElement ? linkEl.href : '';
            const tweet: TweetData & { likes: string; retweets: string } = {
              author: user.author,
              handle: user.handle,
              text: textEl?.textContent?.trim() || '',
              time: tw.parseTime(timeEl),
              likes: likeEl?.textContent?.trim() || '0',
              retweets: retweetEl?.textContent?.trim() || '0',
              link,
            };
            if (tweet.author && tweet.handle && tweet.text && tweet.time && tweet.link) {
              tweets.push(tweet);
            }
          });
          return tweets;
        }, params.limit);

        tips.push(`找到 ${results.length} 条推文`);
        return { data: { query: params.query, count: results.length, tweets: results }, tips };
      } catch (error) {
        return buildErrorResult('搜索失败', error);
      }
    },
  });

  site.command('profile', {
    description: '获取 X/Twitter 用户资料',
    scope: 'browser',
    parameters: z.object({
      username: z.string().describe('用户名（不含 @）'),
    }),
    examples: [
      { cmd: 'xbrowser twitter profile --username "elonmusk"', description: '获取 Elon Musk 的资料' },
    ],
    handler: async (params, ctx) => {
      try {
        const tips: string[] = [];
        if (!hasCdp(ctx)) return buildCdpMissingResult([buildCdpWarning()]);
        tips.push(`Session: ${getSessionId(ctx)}`);
        const page = getPage(ctx);

        await page.goto(`${TWITTER_BASE}/${params.username}`, { waitUntil: 'domcontentloaded' });
        await waitForContent(page, '[data-testid="UserName"], [class*="name"]', 15000);
        await injectHelpers(page);

        const data = await page.evaluate(() => {
          const tw = window.__tw!;
          const name = tw.smartSelect(document.body, ['[data-testid="UserName"]', '[class*="name"]', 'h2[class*="css-901oao"]'])?.textContent?.trim() || '';
          const bio = tw.smartSelect(document.body, ['[data-testid="UserDescription"]', '[class*="bio"]'])?.textContent?.trim() || '';
          const location = tw.smartSelect(document.body, ['[data-testid="UserLocation"]', '[class*="location"]'])?.textContent?.trim() || '';
          const websiteEl = tw.smartSelect(document.body, ['[data-testid="UserUrl"]', '[class*="url"]']);
          const website = websiteEl?.querySelector('a')?.textContent?.trim() || '';
          const stats: Record<string, string> = {};
          const statElements = document.querySelectorAll(
            '[data-testid="primaryColumn"] a[href*="following"], [data-testid="primaryColumn"] a[href*="followers"], a[href*="/following"], a[href*="/followers"]'
          );
          statElements.forEach((el) => {
            const label = el.querySelector('span:last-child')?.textContent?.trim() || '';
            const count = el.querySelector('span:first-child')?.textContent?.trim() || '';
            if (label && count) stats[label] = count;
          });
          const avatar = tw.smartSelect(document.body, ['[data-testid="TweetAvatar"]', '[class*="avatar"]'])?.querySelector('img')?.getAttribute('src') || '';
          return { name, bio, location, website, stats, avatar };
        });

        tips.push(`用户: ${data.name}`);
        tips.push(`简介: ${data.bio?.slice(0, 100)}${data.bio?.length > 100 ? '...' : ''}`);
        return { data, tips };
      } catch (error) {
        return buildErrorResult('获取用户资料失败', error);
      }
    },
  });

  site.command('timeline', {
    description: '获取 X/Twitter 用户最新推文',
    scope: 'browser',
    parameters: z.object({
      username: z.string().describe('用户名（不含 @）'),
      limit: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser twitter timeline --username "elonmusk"', description: '获取 Elon Musk 最新推文' },
    ],
    handler: async (params, ctx) => {
      try {
        const tips: string[] = [];
        if (!hasCdp(ctx)) return buildCdpMissingResult([buildCdpWarning()]);
        tips.push(`Session: ${getSessionId(ctx)}`);
        const page = getPage(ctx);

        await page.goto(`${TWITTER_BASE}/${params.username}`, { waitUntil: 'domcontentloaded' });
        await waitForContent(page, 'article[data-testid="tweet"]', 15000);
        await injectHelpers(page);

        const tweetIds = new Set<string>();
        const tweets: TweetWithStats[] = [];
        const maxIterations = Math.max(5, Math.ceil(params.limit / 5) + 2);

        for (let i = 0; i < maxIterations; i++) {
          await simulateHumanScroll(page);

          const currentTweets = await page.evaluate((existingIds: string[]) => {
            const tw = window.__tw!;
            const newTweets: Array<{ text: string; time: string; likes: string; replies: string; link: string; id: string }> = [];
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const idSet = new Set(existingIds);

            articles.forEach((article) => {
              const linkEl = article.querySelector('a[href*="/status/"]');
              if (!linkEl || !(linkEl instanceof HTMLAnchorElement)) return;
              const id = tw.extractTweetId(linkEl.href);
              if (!id || idSet.has(id)) return;
              const textEl = tw.smartSelect(article, ['[data-testid="tweetText"]', '[class*="tweet-text"]']);
              const timeEl = tw.smartSelect(article, ['time', '[class*="time"]']);
              const likeEl = tw.smartSelect(article, ['[data-testid="like"]', '[class*="like"]']);
              const replyEl = tw.smartSelect(article, ['[data-testid="reply"]', '[class*="reply"]']);
              newTweets.push({
                text: textEl?.textContent?.trim() || '',
                time: tw.parseTime(timeEl),
                likes: likeEl?.textContent?.trim() || '0',
                replies: replyEl?.textContent?.trim() || '0',
                link: linkEl.href,
                id,
              });
            });
            return newTweets;
          }, [...tweetIds]);

          currentTweets.forEach((tweet) => {
            if (tweets.length < params.limit && !tweetIds.has(tweet.id)) {
              tweetIds.add(tweet.id);
              tweets.push({ ...tweet, author: '', handle: '', retweets: '0' });
            }
          });

          if (tweets.length >= params.limit) break;
        }

        tips.push(`${params.username} 最近 ${tweets.length} 条推文`);
        return { data: { username: params.username, count: tweets.length, tweets }, tips };
      } catch (error) {
        return buildErrorResult('获取推文时间线失败', error);
      }
    },
  });

  site.command('timeline-advanced', {
    description: '获取高影响力账号的完整时间线（增强版）',
    scope: 'browser',
    parameters: z.object({
      username: z.string().describe('用户名（不含 @）'),
      limit: z.number().optional().default(20),
      useLogin: z.boolean().optional().default(false),
    }),
    examples: [
      { cmd: 'xbrowser twitter timeline-advanced --username "elonmusk" --limit 30', description: '获取 Elon Musk 的 30 条推文' },
      { cmd: 'xbrowser twitter timeline-advanced --username "realDonaldTrump" --useLogin', description: '使用登录态获取川普的推文' },
    ],
    handler: async (params, ctx) => {
      try {
        const tips: string[] = [];
        if (params.useLogin && !hasCdp(ctx)) {
          return { data: null, tips: ['需要使用登录态，建议使用 --cdp 9221 参数连接到 Chrome 浏览器'], message: '未检测到 CDP 连接，无法获取登录态数据' };
        }
        tips.push(`Session: ${getSessionId(ctx)}`);

        const isHighProfile = HIGH_PROFILE_USERS.has(params.username.toLowerCase());
        const config = isHighProfile ? HIGH_PROFILE_CONFIG : NORMAL_CONFIG;
        if (isHighProfile) tips.push('检测到高影响力账号，使用增强配置');

        const page = getPage(ctx);
        const url = `${TWITTER_BASE}/${params.username}`;
        let lastError: Error | null = null;
        const allTweets: TweetWithStats[] = [];
        const tweetIds = new Set<string>();

        for (let attempt = 0; attempt < config.retryAttempts; attempt++) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.waitTimeout });

            const protectedEl = await page.$('[data-testid="protected"]');
            if (protectedEl) {
              return { data: null, tips: [], message: '该账号已被保护，无法查看推文' };
            }

            await waitForContent(page, 'article[data-testid="tweet"]', config.waitTimeout);
            await injectHelpers(page);

            const maxScrolls = Math.max(config.scrollIterations, Math.ceil(params.limit / 5) + 2);
            for (let i = 0; i < maxScrolls; i++) {
              await simulateHumanScroll(page);
              await page.waitForTimeout(config.scrollDelay);
            }

            const currentTweets = await page.evaluate((existingIds: string[]) => {
              const tw = window.__tw!;
              const tweets: Array<TweetWithStats> = [];
              const articles = document.querySelectorAll('article[data-testid="tweet"]');
              const idSet = new Set(existingIds);

              articles.forEach((article) => {
                const linkEl = article.querySelector('a[href*="/status/"]');
                if (!linkEl || !(linkEl instanceof HTMLAnchorElement)) return;
                const id = tw.extractTweetId(linkEl.href);
                if (!id || idSet.has(id)) return;
                const textEl = tw.smartSelect(article, ['[data-testid="tweetText"]', '[class*="tweet-text"]']);
                const timeEl = tw.smartSelect(article, ['time', '[class*="time"]']);
                const likeEl = tw.smartSelect(article, ['[data-testid="like"]', '[class*="like"]']);
                const replyEl = tw.smartSelect(article, ['[data-testid="reply"]', '[class*="reply"]']);
                const retweetEl = tw.smartSelect(article, ['[data-testid="retweet"]', '[class*="retweet"]']);
                const userEl = tw.smartSelect(article, ['[data-testid="User-Name"] a', '[class*="username"]']);
                const user = tw.parseUserInfo(userEl);
                tweets.push({
                  author: user.author,
                  handle: user.handle,
                  text: textEl?.textContent?.trim() || '',
                  time: tw.parseTime(timeEl),
                  likes: likeEl?.textContent?.trim() || '0',
                  replies: replyEl?.textContent?.trim() || '0',
                  retweets: retweetEl?.textContent?.trim() || '0',
                  link: linkEl.href,
                  id,
                });
              });
              return tweets;
            }, [...tweetIds]);

            currentTweets.forEach((tweet) => {
              if (!tweetIds.has(tweet.id)) {
                tweetIds.add(tweet.id);
                allTweets.push(tweet);
              }
            });

            if (allTweets.length >= params.limit) break;
            await page.waitForTimeout(2000);
          } catch (error) {
            lastError = error as Error;
            if (attempt < config.retryAttempts - 1) {
              tips.push(`第 ${attempt + 1} 次尝试失败，重试中...`);
              await page.waitForTimeout(3000);
            }
          }
        }

        const result = allTweets.slice(0, params.limit);
        tips.push(`成功获取 ${result.length} 条推文`);
        if (lastError && result.length === 0) {
          return buildErrorResult('获取高级时间线失败', lastError);
        }
        return { data: { username: params.username, count: result.length, tweets: result }, tips };
      } catch (error) {
        return buildErrorResult('获取高级时间线失败', error);
      }
    },
  });

  site.command('tweets', {
    description: '获取单条推文详情',
    scope: 'browser',
    parameters: z.object({
      tweetId: z.string().describe('推文 ID（从 URL 中提取）'),
    }),
    examples: [
      { cmd: 'xbrowser twitter tweets --tweetId "1234567890"', description: '获取推文详情' },
    ],
    handler: async (params, ctx) => {
      try {
        const tips: string[] = [];
        if (!hasCdp(ctx)) tips.push(buildCdpWarning());
        tips.push(`Session: ${getSessionId(ctx)}`);
        const page = getPage(ctx);

        const url = `${TWITTER_BASE}/i/status/${params.tweetId}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await waitForContent(page, 'article[data-testid="tweet"]', 15000);
        await injectHelpers(page);

        const tweet = await page.evaluate((tweetId: string) => {
          const tw = window.__tw!;
          const article = document.querySelector('article[data-testid="tweet"]');
          if (!article) return null;
          const textEl = tw.smartSelect(article, ['[data-testid="tweetText"]', '[class*="tweet-text"]']);
          const timeEl = tw.smartSelect(article, ['time', '[class*="time"]']);
          const likeEl = tw.smartSelect(article, ['[data-testid="like"]', '[class*="like"]']);
          const replyEl = tw.smartSelect(article, ['[data-testid="reply"]', '[class*="reply"]']);
          const retweetEl = tw.smartSelect(article, ['[data-testid="retweet"]', '[class*="retweet"]']);
          const quoteEl = tw.smartSelect(article, ['[data-testid="quoteTweet"]', 'a[href*="/status/"][role="link"]', '[class*="quote-tweet"]']);
          const userEl = tw.smartSelect(article, ['[data-testid="User-Name"] a', '[class*="username"]']);
          const user = tw.parseUserInfo(userEl);
          const images: string[] = [];
          article.querySelectorAll('img[src*="pbs.twimg.com"]').forEach((img) => {
            const src = img.getAttribute('src');
            if (src && !images.includes(src)) images.push(src);
          });
          const videos: string[] = [];
          article.querySelectorAll('video').forEach((video) => {
            const src = video.querySelector('source')?.getAttribute('src') || video.getAttribute('src');
            if (src && !videos.includes(src)) videos.push(src);
          });
          return {
            id: tweetId,
            link: `https://x.com/i/status/${tweetId}`,
            author: user.author,
            handle: user.handle,
            text: textEl?.textContent?.trim() || '',
            time: tw.parseTime(timeEl),
            stats: {
              likes: likeEl?.textContent?.trim() || '0',
              replies: replyEl?.textContent?.trim() || '0',
              retweets: retweetEl?.textContent?.trim() || '0',
              quotes: quoteEl?.textContent?.trim() || '0',
            },
            media: { images, videos },
          };
        }, params.tweetId);

        if (!tweet) return { data: null, tips: [], message: '未找到该推文' };
        tips.push('获取推文成功');
        if (tweet.media.images.length > 0) tips.push(`包含 ${tweet.media.images.length} 张图片`);
        if (tweet.media.videos.length > 0) tips.push(`包含 ${tweet.media.videos.length} 个视频`);
        return { data: tweet, tips };
      } catch (error) {
        return buildErrorResult('获取推文详情失败', error);
      }
    },
  });

  site.command('replies', {
    description: '获取推文的回复',
    scope: 'browser',
    parameters: z.object({
      tweetId: z.string().describe('推文 ID'),
      maxPages: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser twitter replies --tweetId "1234567890"', description: '获取推文回复' },
      { cmd: 'xbrowser twitter replies --tweetId "1234567890" --maxPages 10', description: '获取更多回复（滚动10次）' },
    ],
    handler: async (params, ctx) => {
      try {
        const tips: string[] = [];
        if (!hasCdp(ctx)) tips.push(buildCdpWarning());
        tips.push(`Session: ${getSessionId(ctx)}`);
        const page = getPage(ctx);

        const url = `${TWITTER_BASE}/i/status/${params.tweetId}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await waitForContent(page, 'article[data-testid="tweet"]', 15000);
        await injectHelpers(page);

        const replyIds = new Set<string>();
        const replies: Array<TweetData & { id: string; likes: string }> = [];

        for (let i = 0; i < params.maxPages; i++) {
          await simulateHumanScroll(page);

          const currentReplies = await page.evaluate((mainTweetId: string, existingIds: string[]) => {
            const tw = window.__tw!;
            const newReplies: Array<{ id: string; author: string; handle: string; text: string; time: string; likes: string; link: string }> = [];
            const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
            const idSet = new Set(existingIds);

            const filtered = articles.filter((article) => {
              const allLinks = article.querySelectorAll('a[href*="/status/"]');
              for (const linkEl of allLinks) {
                if (linkEl instanceof HTMLAnchorElement) {
                  const id = tw.extractTweetId(linkEl.href);
                  if (id === mainTweetId) return false;
                }
              }
              return true;
            });

            filtered.forEach((article) => {
              const linkEl = article.querySelector('a[href*="/status/"]');
              if (!linkEl || !(linkEl instanceof HTMLAnchorElement)) return;
              const id = tw.extractTweetId(linkEl.href);
              if (!id || id === mainTweetId || idSet.has(id)) return;
              const textEl = tw.smartSelect(article, ['[data-testid="tweetText"]', '[class*="tweet-text"]']);
              const timeEl = tw.smartSelect(article, ['time', '[class*="time"]']);
              const likeEl = tw.smartSelect(article, ['[data-testid="like"]', '[class*="like"]']);
              const userEl = tw.smartSelect(article, ['[data-testid="User-Name"] a', '[class*="username"]']);
              const user = tw.parseUserInfo(userEl);
              newReplies.push({
                id,
                author: user.author,
                handle: user.handle,
                text: textEl?.textContent?.trim() || '',
                time: tw.parseTime(timeEl),
                likes: likeEl?.textContent?.trim() || '0',
                link: linkEl.href,
              });
            });
            return newReplies;
          }, params.tweetId, [...replyIds]);

          currentReplies.forEach((reply) => {
            if (!replyIds.has(reply.id)) {
              replyIds.add(reply.id);
              replies.push(reply);
            }
          });
        }

        tips.push(`找到 ${replies.length} 条回复`);
        return { data: { tweetId: params.tweetId, count: replies.length, replies }, tips };
      } catch (error) {
        return buildErrorResult('获取回复失败', error);
      }
    },
  });
}
