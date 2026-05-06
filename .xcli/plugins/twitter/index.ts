import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'twitter',
    url: 'https://x.com',
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
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      const url = `https://x.com/search?q=${encodeURIComponent(params.query)}&src=typed_query&f=top`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const results = await page.evaluate((limit) => {
        const tweets: Array<{author: string; handle: string; text: string; time: string; likes: string; retweets: string; link: string}> = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"], [class*="tweet"]');
        articles.forEach((article, i) => {
          if (i >= limit) return;
          const userEl = article.querySelector('[data-testid="User-Name"] a, [class*="username"]');
          const textEl = article.querySelector('[data-testid="tweetText"], [class*="tweet-text"]');
          const timeEl = article.querySelector('time');
          const likeEl = article.querySelector('[data-testid="like"], [class*="like"]');
          const retweetEl = article.querySelector('[data-testid="retweet"], [class*="retweet"]');
          const linkEl = article.querySelector('a[href*="/status/"]');

          const fullName = userEl?.textContent?.trim() || '';
          const handleMatch = fullName.match(/@[\w.]+/);

          tweets.push({
            author: fullName.split('@')[0]?.trim() || '',
            handle: handleMatch?.[0] || '',
            text: textEl?.textContent?.trim() || '',
            time: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '',
            likes: likeEl?.textContent?.trim() || '0',
            retweets: retweetEl?.textContent?.trim() || '0',
            link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
          });
        });
        return tweets;
      }, params.limit);

      return {
        data: { query: params.query, count: results.length, tweets: results },
        tips: [`找到 ${results.length} 条推文`],
      };
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
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto(`https://x.com/${params.username}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(() => {
        const name = document.querySelector('[data-testid="UserName"], [class*="name"]')?.textContent?.trim() || '';
        const bio = document.querySelector('[data-testid="UserDescription"], [class*="bio"]')?.textContent?.trim() || '';
        const location = document.querySelector('[data-testid="UserLocation"], [class*="location"]')?.textContent?.trim() || '';
        const website = document.querySelector('[data-testid="UserUrl"], [class*="url"] a')?.textContent?.trim() || '';

        const stats: Record<string, string> = {};
        document.querySelectorAll('[data-testid="primaryColumn"] a[href*="following"], [data-testid="primaryColumn"] a[href*="followers"]').forEach((el) => {
          const label = el.querySelector('span:last-child')?.textContent?.trim() || '';
          const count = el.querySelector('span:first-child')?.textContent?.trim() || '';
          if (label && count) stats[label] = count;
        });

        const avatar = document.querySelector('[data-testid="TweetAvatar"] img, [class*="avatar"] img')?.getAttribute('src') || '';

        return { name, bio, location, website, stats, avatar };
      });

      return {
        data,
        tips: [`用户: ${data.name}`, `简介: ${data.bio?.slice(0, 100)}`],
      };
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
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto(`https://x.com/${params.username}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(1000);
      }

      const results = await page.evaluate((limit) => {
        const tweets: Array<{text: string; time: string; likes: string; replies: string; link: string}> = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        articles.forEach((article, i) => {
          if (i >= limit) return;
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const timeEl = article.querySelector('time');
          const likeEl = article.querySelector('[data-testid="like"]');
          const replyEl = article.querySelector('[data-testid="reply"]');
          const linkEl = article.querySelector('a[href*="/status/"]');

          tweets.push({
            text: textEl?.textContent?.trim() || '',
            time: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '',
            likes: likeEl?.textContent?.trim() || '0',
            replies: replyEl?.textContent?.trim() || '0',
            link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
          });
        });
        return tweets;
      }, params.limit);

      return {
        data: { username: params.username, count: results.length, tweets: results },
        tips: [`${params.username} 最近 ${results.length} 条推文`],
      };
    },
  });
}
