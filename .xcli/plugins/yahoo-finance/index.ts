import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'yahoo-finance',
    url: 'https://finance.yahoo.com',
    description: 'Yahoo Finance - 股票行情、市场数据',
    requiresLogin: false,
  });
  site.command('quote', {
    description: 'Get stock quote from Yahoo Finance',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      symbol: z.string().describe('Stock symbol (e.g. "AAPL", "GOOGL", "TSLA")')
    }),
    handler: async (p, ctx) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.symbol)}?range=1d&interval=1d`;
            const data = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()) as any;
            const result = data?.chart?.result?.[0];
            const meta = result?.meta ?? {};
            const quote = result?.indicators?.quote?.[0] ?? {};
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
              open: quote.open?.[0] ?? 0,
              dayHigh: quote.high?.[0] ?? 0,
              dayLow: quote.low?.[0] ?? 0,
              volume: quote.volume?.[0] ?? 0,
              change: meta.regularMarketPrice - (meta.previousClose ?? meta.regularMarketPrice),
            });
    },
  });
}
