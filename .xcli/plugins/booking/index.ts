import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';

/**
 * booking 插件 — Booking.com 酒店搜索（S189 复醒实现）
 *
 * 中国区访问会被重定向到 PIPL 同意页——search 自动处理 consent
 * （找"同意"按钮 → click → 等跳转 → 继续）。
 *
 * 搜索结果提取：[data-testid=property-card]（S189 探针确认）。
 * 结构探针于 2026-08-31，站点改版需复测选择器。
 */

const CARD_SEL = '[data-testid="property-card"]';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'booking',
    url: 'https://www.booking.com',
    description: 'Booking.com 酒店搜索',
    requiresLogin: false,
  });

  site.command('search', {
    description: '搜索 Booking.com 酒店，返回名称/评分/价格',
    scope: 'browser',
    parameters: z.object({
      destination: z.string().describe('目的地（城市名，如 Tokyo）'),
      limit: z.number().optional().describe('返回条数上限（默认 10）'),
      checkin: z.string().optional().describe('入住日期 YYYY-MM-DD'),
      checkout: z.string().optional().describe('退房日期 YYYY-MM-DD'),
    }),
    examples: [
      { cmd: 'xbrowser booking search --destination Tokyo', description: '搜索东京酒店' },
      { cmd: 'xbrowser booking search --destination Tokyo --checkin 2026-10-01 --checkout 2026-10-03', description: '带日期搜索' },
    ],
    handler: async (params: { destination: string; limit?: number; checkin?: string; checkout?: string }, ctx: { page?: any }) => {
      const page = ctx?.page;
      if (!page) throw new Error('需要浏览器页面');

      // 构造搜索 URL（checkin/checkout 可选）
      let url = 'https://www.booking.com/searchresults.html?ss=' + encodeURIComponent(params.destination);
      if (params.checkin && params.checkout) {
        url += '&checkin=' + params.checkin + '&checkout=' + params.checkout;
      }

      await page.goto(url);
      await page.waitForTimeout(4000);

      // PIPL/GDPR consent 自动处理：最多 2 轮（有的站点 consent 套 consent）
      for (let round = 0; round < 2; round++) {
        const onConsent = await page.evaluate(`(function(){
          return /pipl_consent|consent\\.html/i.test(location.href) ||
            !!Array.from(document.querySelectorAll('button')).find(function(b){ return /同意|Accept/i.test((b.textContent||'').trim()) && b.getBoundingClientRect().width > 0 });
        })()`);
        if (!onConsent) break;
        await page.evaluate(`(function(){
          var btn = Array.from(document.querySelectorAll('button')).find(function(b){
            return /同意|Accept/i.test((b.textContent||'').trim()) && b.getBoundingClientRect().width > 0;
          });
          if (btn) btn.click();
        })()`);
        await page.waitForTimeout(4000);
      }

      // 等待搜索结果卡片渲染
      const cards = await page
        .waitForSelector(CARD_SEL, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!cards) throw new Error('搜索结果未渲染（可能触发机器人验证或站点改版）');

      // 提取属性卡
      const limit = params.limit ?? 10;
      const raw = await page.evaluate(
        `(function(){
          var limit = ${limit};
          var items = document.querySelectorAll('${CARD_SEL}');
          var out = [];
          for (var i = 0; i < Math.min(items.length, limit); i++) {
            var t = items[i].querySelector('[data-testid="title"]');
            var pr = items[i].querySelector('[data-testid="price-and-discounted-price"] span');
            var sc = items[i].querySelector('[data-testid="review-score"] div');
            var ln = items[i].querySelector('a');
            out.push({
              name: t ? t.textContent.trim() : '',
              price: pr ? pr.textContent.trim() : '',
              score: sc ? sc.textContent.trim().slice(0, 3) : '',
              url: ln ? ln.href : ''
            });
          }
          return JSON.stringify(out);
        })()`,
      );
      let hotels: Array<{ name: string; price: string; score: string; url: string }> = [];
      try { const parsed = JSON.parse(String(raw)); if (Array.isArray(parsed)) hotels = parsed; } catch { hotels = []; }

      return { destination: params.destination, count: hotels.length, hotels };
    },
  });
}
