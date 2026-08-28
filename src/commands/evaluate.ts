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
    expression: z.string().optional(),
    frame: z.string().optional().describe('在 URL 含此子串的 iframe 里执行（同进程用 contextId，跨域 OOPIF 用 Target auto-attach）'),
    // Internal: base64url-encoded script set by the router for `eval <js...>`,
    // so multiline/semicolon JS survives chain parsing (which splits on ';'
    // and whitespace). Not intended for direct CLI use.
    'script-b64': z.string().optional().describe('Internal: base64url script set by the CLI router; do not pass directly'),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const rawScript = p['script-b64'];
    const expression = rawScript
      ? Buffer.from(rawScript, 'base64url').toString('utf8')
      : p.expression;
    if (!expression || !expression.trim()) {
      return { ok: false, error: 'eval: expression is required' };
    }
    const engine = createRuleEngine();
    engine.start();
    const decision = engine.evaluate({
      method: 'Runtime.evaluate',
      params: { expression },
      sessionId: 'eval-check',
      direction: 'client→browser' as const,
    });
    engine.stop();

    const result = p.frame
      ? await ctx.page.evaluateInFrame(p.frame, expression)
      : await ctx.page.evaluate(expression);
    const response = ok({ result });
    if (decision && decision.severity === 'danger') {
      // Only show fix suggestion as tip (the full warning is verbose for batch execution)
      response.tips = normalizeTips([`${decision.suggestion}`]);
    }
    return response;
  },
});
