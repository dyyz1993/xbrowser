import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'tdx',
    url: 'https://www.tdx.com.cn',
    description: '通达信 - 股票行情数据',
    requiresLogin: false,
  });

  // ─── quote — 获取股票实时行情 ─────────────────────

  site.command('quote', {
    description: '获取 A 股实时行情（通过新浪财经 API）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({
      symbol: z.string().describe('股票代码，如 "sh600519"（上证）、"sz000001"（深证）'),
    }),
    examples: [
      { cmd: 'xbrowser tdx quote --symbol sh600519', description: '查看贵州茅台行情' },
      { cmd: 'xbrowser tdx quote --symbol sz000001', description: '查看平安银行行情' },
    ],
    result: z.object({
      symbol: z.string(),
      name: z.string(),
      open: z.number(),
      previousClose: z.number(),
      current: z.number(),
      high: z.number(),
      low: z.number(),
      volume: z.number(),
      amount: z.number(),
      buy: z.number(),
      sell: z.number(),
      date: z.string(),
      time: z.string(),
    }).passthrough(),
    handler: async (params) => {
      try {
        const symbol = params.symbol.toLowerCase();
        const url = `https://hq.sinajs.cn/list=${symbol}`;
        const resp = await fetch(url, {
          headers: {
            'Referer': 'https://finance.sina.com.cn',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          },
        });
        const text = await resp.text();
        // 返回格式: var hq_str_sh600519="贵州茅台,1799.00,1800.00,...";
        const match = text.match(/"([^"]+)"/);
        if (!match) return fail('无法解析行情数据，请检查股票代码');

        const parts = match[1].split(',');
        if (parts.length < 10) return fail('行情数据不完整');

        return ok({
          symbol,
          name: parts[0] || '',
          open: parseFloat(parts[1]) || 0,
          previousClose: parseFloat(parts[2]) || 0,
          current: parseFloat(parts[3]) || 0,
          high: parseFloat(parts[4]) || 0,
          low: parseFloat(parts[5]) || 0,
          volume: parseFloat(parts[8]) || 0,
          amount: parseFloat(parts[9]) || 0,
          buy: parseFloat(parts[6]) || 0,
          sell: parseFloat(parts[7]) || 0,
          date: parts[30] || '',
          time: parts[31] || '',
        }, [`已获取 ${symbol} 实时行情`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '获取行情失败');
      }
    },
  });
}
