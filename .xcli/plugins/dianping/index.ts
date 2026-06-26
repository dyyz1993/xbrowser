import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'dianping',
    url: 'https://www.dianping.com',
    description: '大众点评 - 商户搜索和评价',
    requiresLogin: false,
  });
function gp(ctx: CommandContext): Page {
  const p = ctx.page;
  if (!p) throw new Error('需要浏览器页面，请使用 --cdp 连接');
  return p;
}

  site.command('search', {
    description: '搜索大众点评商户',
    loginRequired: 'none',
    scope: 'page',
    parameters: z.object({
      keyword: z.string().describe('搜索关键词（如 "火锅"、"海底捞"）'),
            cityId: z.coerce.number().optional().default(10).describe('城市 ID（10=北京）'),
            limit: z.coerce.number().optional().default(20).describe('返回数量')
    }),
    handler: async (p, ctx) => {
      const page = gp(ctx);
            const url = `https://www.dianping.com/search/keyword/${p.cityId || 10}/0_${encodeURIComponent(p.keyword)}`;
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000);
            const data = await page.evaluate(() => {
              const results: any[] = [];
              document.querySelectorAll('.shop-wrap, .shop-list li, .business-list .item').forEach((item, i) => {
                const nameEl = item.querySelector('.shop-name a, .shop-title a, a[data-click-name]');
                const reviewEl = item.querySelector('.review-num, .comment-count, .review-tag');
                const priceEl = item.querySelector('.price, .mean-price, .price-text');
                const name = nameEl?.textContent?.trim() || '';
                if (!name) return;
                results.push({ rank: i + 1, name, reviews: reviewEl?.textContent?.trim() || '', price: priceEl?.textContent?.trim() || '', url: nameEl?.getAttribute('href') || '' });
              });
              return results;
            });
            if (!data || data.length === 0) return fail(`未找到 "${p.keyword}" 的商户`);
            return ok(data.slice(0, p.limit));
    },
  });
}
