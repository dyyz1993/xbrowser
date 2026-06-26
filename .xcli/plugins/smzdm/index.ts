import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'smzdm',
    url: 'https://www.smzdm.com',
    description: '什么值得买 - 好价信息',
    requiresLogin: false,
  });
function gp(ctx: CommandContext): Page {
  const p = ctx.page;
  if (!p) throw new Error('需要浏览器页面，请使用 --cdp 连接');
  return p;
}

  site.command('hot', {
    description: '获取值得买好价信息',
    loginRequired: 'none',
    scope: 'page',
    parameters: z.object({
      filter: z.string().optional().default('all').describe('分类（如 all, haitao, shishang）'),
            limit: z.coerce.number().optional().default(30).describe('返回数量')
    }),
    handler: async (p, ctx) => {
      const page = gp(ctx);
            const filter = p.filter || 'all';
            const url = filter === 'all' ? 'https://www.smzdm.com/' : `https://www.smzdm.com/${filter}/`;
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000);
            const data = await page.evaluate(() => {
              const results = [];
              document.querySelectorAll('.feed-hot, .feed-row, .list-item').forEach((item, i) => {
                const titleEl = item.querySelector('.item_name a, .feed-block-title a, .z-highlight a');
                const priceEl = item.querySelector('.price, .red, .buy-btn');
                const mallEl = item.querySelector('.mall, .source, .from');
                const title = titleEl?.textContent?.trim();
                if (!title) return;
                results.push({
                  rank: i + 1,
                  title,
                  price: priceEl?.textContent?.trim() || '',
                  mall: mallEl?.textContent?.trim() || '',
                  url: titleEl?.getAttribute('href') || '',
                });
              });
              return results;
            });
            if (!data || data.length === 0) return fail('未获取到好价信息');
            return ok(data.slice(0, p.limit));
    },
  });
}
