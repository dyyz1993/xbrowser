import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'tieba',
    url: 'https://tieba.baidu.com',
    description: '百度贴吧 - 搜索、热帖',
    requiresLogin: false,
  });
function gp(ctx: CommandContext): Page {
  const p = ctx.page;
  if (!p) throw new Error('需要浏览器页面，请使用 --cdp 连接');
  return p;
}

  site.command('hot', {
    description: '获取贴吧热帖',
    loginRequired: 'none',
    scope: 'page',
    parameters: z.object({
      name: z.string().optional().describe('贴吧名称（如 "崩坏3rd"，不传则取热帖榜）'),
            limit: z.coerce.number().optional().default(20).describe('返回数量')
    }),
    handler: async (p, ctx) => {
      const page = gp(ctx);
            const url = p.name ? `https://tieba.baidu.com/f?kw=${encodeURIComponent(p.name)}` : 'https://tieba.baidu.com/hottopic/browse/topicList';
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000);
            const data = await page.evaluate(() => {
              const results = [];
              const items = document.querySelectorAll('.threadlist_title a.j_th_tit, .topic_name a, .topic-link');
              items.forEach((item, i) => {
                const title = item.textContent?.trim();
                if (!title) return;
                results.push({
                  rank: i + 1,
                  title,
                  url: item.getAttribute('href') || '',
                });
              });
              return results;
            });
            if (!data || data.length === 0) return fail('未获取到贴吧内容');
            return ok(data.slice(0, p.limit));
    },
  });
}
