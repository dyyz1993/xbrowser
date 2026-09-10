import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const quoteResult = z.object({
  symbol: z.string(),
  name: z.string(),
  current: z.number(),
  percent: z.number(),
  high: z.number(),
  low: z.number(),
  open: z.number(),
  volume: z.number(),
  amount: z.number(),
  timestamp: z.string(),
});

const hotResult = z.array(z.object({
  rank: z.number(),
  symbol: z.string(),
  name: z.string(),
  price: z.number(),
  percent: z.number(),
  turnover: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'xueqiu',
    url: 'https://xueqiu.com',
    description: '雪球 - 股票投资社区',
    requiresLogin: false,
  });
  site.command('quote', {
    description: '获取股票实时行情（A股/港股/美股）',
    result: quoteResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      symbol: z.string().describe('股票代码，如 "SH600519"（茅台）、"HK00700"（腾讯）、"AAPL"'),
            limit: z.coerce.number().optional().default(1).describe('返回数量')
    }),
    handler: async (p, _ctx) => {
      const symbol = p.symbol.toUpperCase();
            const url = `https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=${symbol}`;
            const data = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': 'xq_a_token=guest', 'Referer': 'https://xueqiu.com/' } }) as JsonObject;
            const quote = (data?.data as unknown[] | undefined)?.[0];
            if (!quote) return fail(`Could not fetch quote for "${symbol}"`);
            return ok({
              symbol: (quote as Record<string, unknown>).symbol ?? symbol,
              name: (quote as Record<string, unknown>).name ?? (quote as Record<string, unknown>).secu_name ?? '',
              current: (quote as Record<string, unknown>).current ?? 0,
              percent: (quote as Record<string, unknown>).percent ?? 0,
              high: (quote as Record<string, unknown>).high ?? 0,
              low: (quote as Record<string, unknown>).low ?? 0,
              open: (quote as Record<string, unknown>).open ?? 0,
              volume: (quote as Record<string, unknown>).volume ?? 0,
              amount: (quote as Record<string, unknown>).amount ?? 0,
              timestamp: (quote as Record<string, unknown>).timestamp ? new Date((quote as Record<string, unknown>).timestamp as number).toISOString() : '',
            });
    },
  });
  site.command('hot', {
    description: '雪球热门股票',
    result: hotResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      limit: z.coerce.number().optional().default(20).describe('返回数量')
    }),
    handler: async (p, _ctx) => {
      const url = 'https://xueqiu.com/stock/v4/stock/rank.json?type=1&_=1';
            const data = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': 'xq_a_token=guest', 'Referer': 'https://xueqiu.com/' } }) as JsonObject;
            const list = (data?.data as Record<string, unknown>[] | undefined) ?? [];
            interface QuoteRow { code?: string; symbol?: string; name?: string; current?: number; price?: number; percent?: number; changePercent?: number; turnoverRate?: number }
            return ok(list.slice(0, p.limit || 20).map((item: QuoteRow, i: number) => ({
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
