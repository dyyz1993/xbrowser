import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'eastmoney',
    url: 'https://www.eastmoney.com',
    description: '东方财富 - 股票行情、财经数据',
    requiresLogin: false,
  });

  // ─── stock — 股票行情 ────────────────────────────

  site.command('stock', {
    description: '获取 A 股实时行情（东方财富）',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      symbol: z.string().describe('股票代码，如 "600519"（上证）、"000001"（深证）'),
    }),
    examples: [
      { cmd: 'xbrowser eastmoney stock --symbol 600519', description: '查看贵州茅台行情' },
    ],
    result: z.object({
      symbol: z.string(),
      name: z.string(),
      current: z.string(),
      changePercent: z.string(),
      high: z.string(),
      low: z.string(),
      open: z.string(),
      volume: z.string(),
      amount: z.string(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        const url = `https://quote.eastmoney.com/${params.symbol}.html`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const data = await page.evaluate((sym) => {
          const nameEl = document.querySelector('.stock-name, [class*="stockName"], [class*="name"], h1');
          const priceEl = document.querySelector('.stock-current, [class*="current"], [class*="price"] strong, #price9');
          const changeEl = document.querySelector('.stock-change, [class*="change"], [class*="percent"]');
          const highEl = document.querySelector('.stock-high, [class*="high"]');
          const lowEl = document.querySelector('.stock-low, [class*="low"]');
          const openEl = document.querySelector('.stock-open, [class*="open"]');
          const volumeEl = document.querySelector('.stock-volume, [class*="volume"], [class*="vol"]');
          const amountEl = document.querySelector('.stock-amount, [class*="amount"], [class*="amt"]');

          return {
            symbol: sym,
            name: nameEl?.textContent?.trim() || '',
            current: priceEl?.textContent?.trim() || '',
            changePercent: changeEl?.textContent?.trim() || '',
            high: highEl?.textContent?.trim() || '',
            low: lowEl?.textContent?.trim() || '',
            open: openEl?.textContent?.trim() || '',
            volume: volumeEl?.textContent?.trim() || '',
            amount: amountEl?.textContent?.trim() || '',
          };
        }, params.symbol) as { symbol: string; name: string; current: string; changePercent: string; high: string; low: string; open: string; volume: string; amount: string };

        return ok(data, [...tips, `已获取 ${data.name || params.symbol} 行情`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── news — 财经新闻 ──────────────────────────────

  site.command('news', {
    description: '获取东方财富最新财经新闻',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser eastmoney news', description: '查看最新财经新闻' },
    ],
    result: z.object({
      count: z.number(),
      results: z.array(z.object({
        title: z.string(),
        summary: z.string(),
        date: z.string(),
        link: z.string(),
      }).passthrough()),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        await page.goto('https://www.eastmoney.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ title: string; summary: string; date: string; link: string }> = [];
          const articles = document.querySelectorAll('[class*="news-item"], [class*="article-item"], [class*="focus-item"]');
          articles.forEach((article, i) => {
            if (i >= limit) return;
            const titleEl = article.querySelector('a[class*="title"], a[class*="link"], h3 a, h3');
            const summaryEl = article.querySelector('[class*="desc"], [class*="summary"], [class*="info"]');
            const dateEl = article.querySelector('[class*="time"], [class*="date"], time');
            const linkEl = titleEl?.closest('a') || article.querySelector('a[href*="eastmoney"]');

            items.push({
              title: titleEl?.textContent?.trim() || '',
              summary: summaryEl?.textContent?.trim().slice(0, 200) || '',
              date: dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
            });
          });
          return items;
        }, params.limit) as Array<{ title: string; summary: string; date: string; link: string }>;

        return ok(
          { count: results.length, results },
          [...tips, `获取 ${results.length} 条新闻`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
