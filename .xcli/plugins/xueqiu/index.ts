import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'xueqiu',
    url: 'https://xueqiu.com',
    description: '雪球 - 股票投资社区',
    requiresLogin: false,
  });
  site.command('quote', {
    description: '获取股票实时行情（A股/港股/美股）',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      symbol: z.string().describe('股票代码，如 "SH600519"（茅台）、"HK00700"（腾讯）、"AAPL"'),
            limit: z.coerce.number().optional().default(1).describe('返回数量')
    }),
    handler: async (p, ctx) => {
      const symbol = p.symbol.toUpperCase();
            const url = `https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=${symbol}`;
            const data = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': 'xq_a_token=guest', 'Referer': 'https://xueqiu.com/' } }).then(r => r.json()) as any;
            const quote = data?.data?.[0];
            if (!quote) return fail(`Could not fetch quote for "${symbol}"`);
            return ok({
              symbol: quote.symbol ?? symbol,
              name: quote.name ?? quote.secu_name ?? '',
              current: quote.current ?? 0,
              percent: quote.percent ?? 0,
              high: quote.high ?? 0,
              low: quote.low ?? 0,
              open: quote.open ?? 0,
              volume: quote.volume ?? 0,
              amount: quote.amount ?? 0,
              timestamp: quote.timestamp ? new Date(quote.timestamp).toISOString() : '',
            });
    },
  });
  site.command('hot', {
    description: '雪球热门股票',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('返回数量')
    }),
    handler: async (p, ctx) => {
      const url = 'https://xueqiu.com/stock/v4/stock/rank.json?type=1&_=1';
            const data = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': 'xq_a_token=guest', 'Referer': 'https://xueqiu.com/' } }).then(r => r.json()) as any;
            const list = data?.data ?? [];
            return ok(list.slice(0, p.limit || 20).map((item: any, i: number) => ({
              rank: i + 1,
              symbol: item.code ?? item.symbol ?? '',
              name: item.name ?? '',
              price: item.current ?? item.price ?? 0,
              percent: item.percent ?? item.changePercent ?? 0,
              turnover: item.turnoverRate ? `${item.turnoverRate}%` : '',
            })));
    },
  });
}
