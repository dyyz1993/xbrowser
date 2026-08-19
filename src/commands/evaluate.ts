import { z } from 'zod';
import { ok, normalizeTips } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createRuleEngine } from '../cdp-interceptor/rules-engine.js';

export const evaluateCommand = registerCommand({
  name: 'eval',
  description: 'Evaluate JavaScript expression in the browser (--frame <url-substring> 可定向到 iframe 上下文，跨域 iframe 亦可)',
  scope: 'page',
  parameters: z.object({
    expression: z.string(),
    frame: z.string().optional().describe('在 URL 含此子串的 iframe 里执行（同进程用 contextId，跨域 OOPIF 用 Target auto-attach）'),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const engine = createRuleEngine();
    engine.start();
    const decision = engine.evaluate({
      method: 'Runtime.evaluate',
      params: { expression: p.expression },
      sessionId: 'eval-check',
      direction: 'client→browser' as const,
    });
    engine.stop();

    const result = p.frame
      ? await ctx.page.evaluateInFrame(p.frame, p.expression)
      : await ctx.page.evaluate(p.expression);
    const response = ok({ result });
    if (decision && decision.severity === 'danger') {
      // Only show fix suggestion as tip (the full warning is verbose for batch execution)
      response.tips = normalizeTips([`${decision.suggestion}`]);
    }
    return response;
  },
});
