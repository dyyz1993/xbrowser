import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { wheelDelta, rand as sRand, sleep } from '../cdp-driver/stealth.js';

export const scrollCommand = registerCommand({
  name: 'scroll',
  description: 'Scroll the page or an element',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    direction: z.enum(['up', 'down', 'left', 'right']),
    distance: z.number().optional(),
    selector: z.string().optional(),
  }),
  result: z.object({
    direction: z.enum(['up', 'down', 'left', 'right']),
    distance: z.number(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const distance = p.distance ?? 500;
    const sign: Record<string, number> = { down: 1, up: -1, right: 1, left: -1 };
    const vertical = p.direction === 'down' || p.direction === 'up';
    const s = sign[p.direction];

    if (p.selector) {
      const element = ctx.page.locator(p.selector).first();
      await element.evaluate((el: Element, args: [number, number]) => {
        const [dxx, dyy] = args as [number, number];
        el.scrollBy(dxx, dyy);
      }, [vertical ? 0 : distance * s, vertical ? distance * s : 0] as [number, number]);
    } else if (process.env.XBROWSER_STEALTH !== 'off') {
      // 惯性序列（d51）：人类滚动 = 峰值起步指数衰减的一串 wheel 事件
      // （每帧一个）。旧实现单事件携带整个 distance —— 一步到位暴露。
      // wheelDelta 一直在 stealth.ts 里躺着，只是命令路径从没接入。
      let acc = 0;
      let step = 0;
      while (acc < distance && step < 60) {
        const d = Math.min(wheelDelta(step), distance - acc);
        if (d < 1) break;
        await ctx.page.mouse.wheel(
          vertical ? 0 : d * s,
          vertical ? d * s : 0,
        );
        acc += d;
        step++;
        // 帧级间隔：惯性期间浏览器每帧派发一个 wheel 事件（16.7ms 基准）
        await sleep(sRand(16, 28));
      }
    } else {
      await ctx.page.mouse.wheel(
        vertical ? 0 : distance * s,
        vertical ? distance * s : 0,
      );
    }
    return ok({ direction: p.direction, distance });
  },
});
