import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createRuleEngine } from '../cdp-interceptor/rules-engine.js';

export const evaluateCommand = registerCommand({
  name: 'eval',
  description: 'Evaluate JavaScript expression in the browser',
  scope: 'page',
  parameters: z.object({
    expression: z.string(),
    output: z.string().optional().describe('写入此文件而非 stdout（避免大结果被 stdout 截断，如 base64/大 JSON）'),
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

    const result = await ctx.page.evaluate(p.expression) as unknown;

    // 指定 --output 时写文件，避开 stdout 对大结果的截断
    if (p.output) {
      const fs = await import('fs');
      const path = await import('path');
      const absPath = path.resolve(p.output);
      const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content);
      const response = ok({ result: `已写入 ${absPath} (${content.length} 字节)`, path: absPath, size: content.length });
      if (decision && decision.severity === 'danger') {
        response.tips = [
          `⚠️ CDP Firewall: ${decision.reason}`,
          `💡 Fix: ${decision.suggestion}`,
        ];
      }
      return response;
    }

    const response = ok({ result });
    if (decision && decision.severity === 'danger') {
      response.tips = [
        `⚠️ CDP Firewall: ${decision.reason}`,
        `💡 Fix: ${decision.suggestion}`,
      ];
    }
    return response;
  },
});
