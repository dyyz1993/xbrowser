import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'zhihu',
    url: 'https://www.zhihu.com',
    description: '知乎 - 知识问答与内容采集 (DA 93)',
    requiresLogin: false,
  });

  site.command('search', {
    description: '搜索知乎问题、回答、文章',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      type: z.enum(['all', 'question', 'article', 'answer']).optional().default('all'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser zhihu search --query "AI 编程"', description: '搜索 AI 编程相关内容' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      const searchUrl = `https://www.zhihu.com/search?type=${params.type}&q=${encodeURIComponent(params.query)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      await page.evaluate(() => {
        document.querySelectorAll('.Modal-closeButton, [class*="close"]').forEach((el) => {
          if (el instanceof HTMLElement) el.click();
        });
      });

      const results = await page.evaluate((limit) => {
        const items: Array<{title: string; excerpt: string; author: string; link: string; type: string}> = [];
        const cards = document.querySelectorAll('.SearchResult-Card, .List-item');
        cards.forEach((card, i) => {
          if (i >= limit) return;
          const titleEl = card.querySelector('h2 a, .ContentItem-title a');
          const excerptEl = card.querySelector('.content, .RichContent-inner, span.RichText');
          const authorEl = card.querySelector('.AuthorInfo-name, .UserLink-link');
          items.push({
            title: titleEl?.textContent?.trim() || '',
            excerpt: excerptEl?.textContent?.trim()?.slice(0, 200) || '',
            author: authorEl?.textContent?.trim() || '',
            link: titleEl instanceof HTMLAnchorElement ? titleEl.href : '',
            type: card.querySelector('[class*="Question"]') ? 'question' :
                  card.querySelector('[class*="Article"]') ? 'article' : 'answer',
          });
        });
        return items;
      }, params.limit);

      return {
        data: { query: params.query, count: results.length, results },
        tips: [`找到 ${results.length} 条结果`],
      };
    },
  });

  site.command('trending', {
    description: '获取知乎热榜',
    scope: 'browser',
    parameters: z.object({
      limit: z.number().optional().default(20),
    }),
    examples: [
      { cmd: 'xbrowser zhihu trending', description: '获取知乎热榜前 20' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto('https://www.zhihu.com/hot', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const items = await page.evaluate((limit) => {
        const results: Array<{rank: number; title: string; hotScore: string; link: string}> = [];
        const hotItems = document.querySelectorAll('.HotList-list .HotItem, [class*="HotItem"]');
        hotItems.forEach((item, i) => {
          if (i >= limit) return;
          const titleEl = item.querySelector('.HotItem-title, [class*="title"]');
          const scoreEl = item.querySelector('.HotItem-metrics, [class*="metrics"]');
          const linkEl = item.querySelector('a');
          results.push({
            rank: i + 1,
            title: titleEl?.textContent?.trim() || '',
            hotScore: scoreEl?.textContent?.trim() || '',
            link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
          });
        });
        return results;
      }, params.limit);

      return {
        data: { count: items.length, items },
        tips: [`热榜 ${items.length} 条`],
      };
    },
  });

  site.command('question', {
    description: '获取知乎问题及其回答',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('知乎问题 URL'),
      limit: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser zhihu question --url "https://www.zhihu.com/question/xxx"', description: '获取问题回答' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto(params.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const data = await page.evaluate((limit) => {
        const title = document.querySelector('.QuestionHeader-title')?.textContent?.trim() || '';
        const detail = document.querySelector('.QuestionRichText-inner')?.textContent?.trim() || '';
        const answers: Array<{author: string; content: string; upvotes: string}> = [];

        document.querySelectorAll('.AnswerItem, [class*="AnswerCard"]').forEach((item, i) => {
          if (i >= limit) return;
          const authorEl = item.querySelector('.AuthorInfo-name, .UserLink-link');
          const contentEl = item.querySelector('.RichContent-inner, .RichText');
          const upvoteEl = item.querySelector('.VoteButton--up, [class*="VoteButton"]');
          answers.push({
            author: authorEl?.textContent?.trim() || '匿名',
            content: contentEl?.textContent?.trim()?.slice(0, 500) || '',
            upvotes: upvoteEl?.textContent?.trim() || '0',
          });
        });

        return { title, detail, answers };
      }, params.limit);

      return {
        data,
        tips: [`问题: ${data.title}`, `${data.answers.length} 条回答`],
      };
    },
  });
}
