import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'ths',
    url: 'https://www.10jqka.com.cn',
    description: '同花顺 - 热股榜、行情数据',
    requiresLogin: false,
  });
function gp(ctx: CommandContext): Page {
  const p = ctx.page;
  if (!p) throw new Error('需要浏览器页面，请使用 --cdp 连接');
  return p;
}

  site.command('hot-rank', {
    description: '同花顺热股榜',
    loginRequired: 'none',
    scope: 'page',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('返回数量')
    }),
    handler: async (p, ctx) => {
      const page = gp(ctx);
            await page.goto('https://eq.10jqka.com.cn/webpage/ths-hot-list/index.html?showStatusBar=true', { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(3000);
            const data = await page.evaluate(() => {
              const cleanText = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
              const cards = document.querySelectorAll('div.pt-22.pb-24.bgc-white.border');
              const results = [];
              const seen = new Set();
              cards.forEach((card, idx) => {
                const row = card.querySelector('div.flex.bgc-white');
                if (!row) return;
                const nameEl = row.querySelector('span.ellipsis');
                const name = cleanText(nameEl);
                if (!name || seen.has(name)) return;
                seen.add(name);
                const tagEls = card.querySelectorAll('div.tag.PFSC-R');
                const tags = Array.from(tagEls).map(t => cleanText(t)).filter(Boolean).join(',');
                const rankEl = row.querySelector('div.THSMF-M.bold');
                results.push({
                  rank: cleanText(rankEl) || String(idx + 1),
                  name,
                  changePercent: cleanText(row.querySelector('div.range')),
                  heat: cleanText(row.querySelector('div.col4 > span')),
                  tags,
                });
              });
              return results;
            });
            if (!Array.isArray(data)) return ok([]);
            return ok(data.slice(0, p.limit));
    },
  });
}
