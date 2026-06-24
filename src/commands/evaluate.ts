import { z } from 'zod';
import { ok, normalizeTips } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createRuleEngine } from '../cdp-interceptor/rules-engine.js';

export const evaluateCommand = registerCommand({
  name: 'eval',
  description: 'Evaluate JavaScript expression in the browser',
  scope: 'page',
  parameters: z.object({
    expression: z.string(),
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

    const result = await ctx.page.evaluate(p.expression);
    const response = ok({ result });
    if (decision && decision.severity === 'danger') {
      // Only show fix suggestion as tip (the full warning is verbose for batch execution)
      response.tips = normalizeTips([`${decision.suggestion}`]);
    }
    return response;
  },
});
