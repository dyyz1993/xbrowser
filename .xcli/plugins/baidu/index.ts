import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

async function dismissBaiduDialogs(page: import('playwright').Page) {
  const dismissSelectors = [
    '.ec_wise_ad_popup_close',
    '#closeBtn',
    '.close-btn',
    '[class*="consent"] button',
    '.dialog-close',
  ];
  for (const sel of dismissSelectors) {
    await page.click(sel, { timeout: 1000 }).catch(() => {});
  }
  await page.evaluate(() => {
    document
      .querySelectorAll('[class*="mask"], [class*="overlay"], [class*="popup"]')
      .forEach((el) => {
        if (el instanceof HTMLElement) el.style.display = 'none';
      });
  });
}

export default function (xcli: XCLIAPI): void {
  const baidu = xcli.createSite({
    name: 'baidu',
    url: 'https://www.baidu.com',
    description: '百度搜索 - 真实浏览器操作',
    requiresLogin: false,
  });

  baidu.command('search', {
    description: '百度搜索并提取多页结果',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      pages: z.number().optional().default(1).describe('采集页数，默认1页'),
      limit: z.number().optional().describe('结果数量上限，默认全部'),
    }),
    examples: [
      { cmd: 'xbrowser baidu search --query "AI"', description: '搜索 AI 相关内容' },
      { cmd: 'xbrowser baidu search --query "编程" --pages 3', description: '搜索编程并采集前3页' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const { query, pages, limit } = params;
      const allResults: Array<{
        title: string;
        url: string;
        snippet: string;
        source: string;
        page: number;
        position: number;
      }> = [];

      await page.goto(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(3000);
      await dismissBaiduDialogs(page);

      for (let pageNum = 1; pageNum <= pages; pageNum++) {
        if (pageNum > 1) {
          const nextBtn = page.locator('a.n:has-text("下一页")').first();
          const hasNext = await nextBtn.isVisible().catch(() => false);
          if (!hasNext) break;
          await nextBtn.click();
          await page.waitForLoadState('domcontentloaded');
          await dismissBaiduDialogs(page);
          await page.waitForTimeout(1500);
        }

        const pageResults = await page.evaluate((pNum: number) => {
          const results: Array<{
            title: string;
            url: string;
            snippet: string;
            source: string;
            page: number;
            position: number;
          }> = [];

          const containers = document.querySelectorAll('.result, .c-container');
          containers.forEach((container, idx) => {
            const titleEl = container.querySelector('h3 a, .t a');
            const snippetEl = container.querySelector(
              '.c-abstract, [class*="abstract"], .c-span-last'
            );
            const sourceEl = container.querySelector(
              '.c-showurl, [class*="showurl"], .c-color-gray'
            );

            const title = titleEl?.textContent?.trim() || '';
            const url = titleEl?.getAttribute('href') || '';
            const snippet = snippetEl?.textContent?.trim().slice(0, 300) || '';
            const source = sourceEl?.textContent?.trim() || '';

            if (title) {
              results.push({ title, url, snippet, source, page: pNum, position: idx + 1 });
            }
          });

          return results;
        }, pageNum);

        allResults.push(...pageResults);
      }

      const finalResults = limit ? allResults.slice(0, limit) : allResults;

      return {
        data: finalResults,
        tips: [
          `关键词: "${query}"`,
          `采集 ${pages} 页，共 ${allResults.length} 条结果${limit ? `，截取前 ${limit} 条` : ''}`,
        ],
      };
    },
  });

  baidu.command('hotsearch', {
    description: '获取百度热搜榜',
    scope: 'browser',
    parameters: z.object({
      category: z
        .enum(['hot', 'entertainment', 'sports', 'car', 'finance', 'tech'])
        .optional()
        .default('hot')
        .describe('热搜分类'),
    }),
    examples: [{ cmd: 'xbrowser baidu hotsearch', description: '获取热搜榜单' }],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const categoryMap: Record<string, string> = {
        hot: 'https://top.baidu.com/board?tab=realtime',
        entertainment: 'https://top.baidu.com/board?tab=movie',
        sports: 'https://top.baidu.com/board?tab=sports',
        car: 'https://top.baidu.com/board?tab=car',
        finance: 'https://top.baidu.com/board?tab=finance',
        tech: 'https://top.baidu.com/board?tab=technology',
      };

      const url = categoryMap[params.category] || categoryMap.hot;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const items = await page.evaluate(() => {
        const results: Array<{
          rank: number;
          title: string;
          url: string;
          heat: string;
          tag: string;
        }> = [];

        const cards = document.querySelectorAll('.category-wrap_iQLoo');
        cards.forEach((card, idx) => {
          const titleEl = card.querySelector('.c-single-text-ellipsis');
          const linkEl = card.querySelector('a[href]');
          const heatEl = card.querySelector('.hot-index_1Bl1a');
          const tagEl = card.querySelector('.hot-tag_1G0TR');

          const title = titleEl?.textContent?.trim() || '';
          if (title) {
            results.push({
              rank: idx + 1,
              title,
              url: linkEl?.getAttribute('href') || '',
              heat: heatEl?.textContent?.trim() || '',
              tag: tagEl?.textContent?.trim() || '',
            });
          }
        });

        return results;
      });

      return {
        data: items,
        tips: [`分类: ${params.category}`, `共获取 ${items.length} 条热搜`],
      };
    },
  });

  baidu.command('suggest', {
    description: '获取百度搜索建议/联想词',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('输入关键词'),
    }),
    examples: [
      { cmd: 'xbrowser baidu suggest --query "编程"', description: '获取编程的搜索建议' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto(`https://suggestion.baidu.com/su?wd=${encodeURIComponent(params.query)}`);
      const text = await page.evaluate(
        () => document.body.innerText || document.body.textContent || ''
      );

      const match = text.match(/s:\[([^\]]*)\]/);
      const items = match
        ? match[1]
            .split(',')
            .map((s) => s.trim().replace(/^"|"$/g, ''))
            .filter((s) => s.length > 0)
        : [];

      return {
        data: items,
        tips: [`关键词 "${params.query}" 的搜索建议共 ${items.length} 条`],
      };
    },
  });

  baidu.command('news', {
    description: '获取百度新闻资讯',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('新闻关键词'),
      limit: z.number().optional().default(10).describe('结果数量'),
    }),
    examples: [{ cmd: 'xbrowser baidu news --query "AI"', description: '获取 AI 相关新闻' }],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const url = `https://www.baidu.com/s?wd=${encodeURIComponent(params.query)}&tn=news`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle');

      const news = await page.evaluate((maxItems: number) => {
        const items: Array<{
          title: string;
          url: string;
          source: string;
          time: string;
          snippet: string;
        }> = [];

        const cards = document.querySelectorAll('.result-op');
        cards.forEach((card) => {
          const titleEl = card.querySelector('.news-title-font_1xS-F a, h3 a');
          const sourceEl = card.querySelector('.c-color-gray, .source-name');
          const timeEl = card.querySelector('.c-color-gray2, .c-font-normal');
          const snippetEl = card.querySelector('.c-gap-top-small');

          const title = titleEl?.textContent?.trim() || '';
          if (title) {
            items.push({
              title,
              url: titleEl?.getAttribute('href') || '',
              source: sourceEl?.textContent?.trim() || '',
              time: timeEl?.textContent?.trim() || '',
              snippet: snippetEl?.textContent?.trim().slice(0, 200) || '',
            });
          }
        });

        return items.slice(0, maxItems);
      }, params.limit);

      return {
        data: news,
        tips: [`关键词 "${params.query}" 获取 ${news.length} 条新闻`],
      };
    },
  });

  baidu.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
    if (!page) return;
    await page.goto('https://www.baidu.com');
    await page.click('#s-top-loginbtn').catch(() => {});
    await page.waitForTimeout(3000);
    await ctx.storage.set('baidu_token', { loggedIn: true, at: Date.now() });
  });

  baidu.logout(async (ctx) => {
    await ctx.storage.delete('baidu_token');
  });
}
