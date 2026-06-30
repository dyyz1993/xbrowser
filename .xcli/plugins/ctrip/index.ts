import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'ctrip',
    url: 'https://www.ctrip.com',
    description: '携程 - 酒店、机票、旅游',
    requiresLogin: false,
  });

  // ─── search — 搜索酒店 ────────────────────────────

  site.command('search', {
    description: '搜索携程酒店，返回酒店名称、评分、价格、地址',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      query: z.string().describe('搜索关键词（城市/酒店名）'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser ctrip search --query "上海"', description: '搜索上海酒店' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      results: z.array(z.object({
        name: z.string(),
        rating: z.string(),
        price: z.string(),
        address: z.string(),
        link: z.string(),
        image: z.string(),
      }).passthrough()),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        const url = `https://hotels.ctrip.com/hotel/${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const results = await page.evaluate((limit) => {
          const items: Array<{ name: string; rating: string; price: string; address: string; link: string; image: string }> = [];
          const cards = document.querySelectorAll('.hotel-list-item, [class*="hotelItem"], .hotelitem, [class*="hotel_card"]');
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const nameEl = card.querySelector('.hotel-name-link, [class*="hotelName"] a, [class*="name"] a, h3 a, h3');
            const ratingEl = card.querySelector('[class*="rating"], [class*="score"], [class*="rate"] span, .hotel-score');
            const priceEl = card.querySelector('[class*="price"], [class*="Price"], span[class*="price"]');
            const addressEl = card.querySelector('[class*="address"], [class*="addr"]');
            const imageEl = card.querySelector('img[src*="ctrip"], img[src*="c-ctrip"], img[class*="pic"]');
            const linkEl = nameEl?.closest('a') || card.querySelector('a[href*="hotel/"]');

            items.push({
              name: nameEl?.textContent?.trim() || '',
              rating: ratingEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              address: addressEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              image: imageEl instanceof HTMLImageElement ? (imageEl.src || '') : '',
            });
          });
          return items;
        }, params.limit) as Array<{ name: string; rating: string; price: string; address: string; link: string; image: string }>;

        return ok(
          { query: params.query, count: results.length, results },
          [...tips, `找到 ${results.length} 家酒店`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });
}
