import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';


const quoteResult = z.object({
  symbol: z.string(),
  shortName: z.string(),
  longName: z.string(),
  price: z.number(),
  previousClose: z.number(),
  currency: z.string(),
  exchangeName: z.string(),
  marketState: z.string(),
  open: z.number(),
  dayHigh: z.number(),
  dayLow: z.number(),
  volume: z.number(),
  change: z.number(),
});

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'yahoo-finance',
    url: 'https://finance.yahoo.com',
    description: 'Yahoo Finance - 股票行情、市场数据',
    requiresLogin: false,
  });
  site.command('quote', {
    description: 'Get stock quote from Yahoo Finance',
    result: quoteResult,
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      symbol: z.string().describe('Stock symbol (e.g. "AAPL", "GOOGL", "TSLA")')
    }),
    handler: async (p, _ctx) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.symbol)}?range=1d&interval=1d`;
            const data = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }) as JsonObject;
            const result = ((data?.chart as Record<string, unknown> | undefined)?.result as Array<Record<string, unknown>> | undefined)?.[0];
            const meta = (result?.meta as Record<string, unknown> | undefined) ?? {};
            const quote = ((result?.indicators as Record<string, unknown> | undefined)?.quote as Array<Record<string, unknown>> | undefined)?.[0] ?? {} as Record<string, unknown>;
            if (!meta.regularMarketPrice) return fail(`Could not fetch quote for "${p.symbol}"`);
            return ok({
              symbol: p.symbol.toUpperCase(),
              shortName: meta.shortName ?? '',
              longName: meta.longName ?? '',
              price: meta.regularMarketPrice,
              previousClose: meta.previousClose ?? 0,
              currency: meta.currency ?? 'USD',
              exchangeName: meta.exchangeName ?? '',
              marketState: meta.marketState ?? '',
              open: (quote.open as number[] | undefined)?.[0] ?? 0,
              dayHigh: (quote.high as number[] | undefined)?.[0] ?? 0,
              dayLow: (quote.low as number[] | undefined)?.[0] ?? 0,
              volume: (quote.volume as number[] | undefined)?.[0] ?? 0,
              change: (meta.regularMarketPrice as number) - ((meta.previousClose as number | undefined) ?? (meta.regularMarketPrice as number)),
            });
    },
  });
}
