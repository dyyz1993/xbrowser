import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import { z } from 'zod';

type Page = import('../types').Page;

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'testsuite',
    url: 'https://xbrowser.dev',
    description: 'Run sequence of test steps and report results',
  });

  site.command('testsuite', {
    description: 'Run a sequence of test steps (navigate + interact + assert) and report results',
    loginRequired: 'optional',
    scope: 'page',
    parameters: z.object({
      steps: z.array(z.object({
        action: z.enum(['goto', 'click', 'fill', 'wait', 'assert', 'screenshot', 'eval']),
        selector: z.string().optional(),
        value: z.string().optional(),
        url: z.string().optional(),
        timeout: z.number().optional(),
      })).describe('Array of test steps'),
      stopOnFailure: z.boolean().optional().default(true),
    }),
    result: z.object({
      passed: z.boolean(),
      totalSteps: z.number(),
      passedSteps: z.number(),
      failedSteps: z.number(),
      results: z.array(z.object({ step: z.number(), action: z.string(), passed: z.boolean(), message: z.string(), duration: z.number() })),
      summary: z.string(),
    }),
    handler: async (p, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page;
      const results: Array<{ step: number; action: string; passed: boolean; message: string; duration: number }> = [];
      let allPassed = true;
      for (let i = 0; i < p.steps.length; i++) {
        const step = p.steps[i]; const start = Date.now(); let passed = true; let message = '';
        try {
          switch (step.action) {
            case 'goto': await page.goto(step.url || '', { waitUntil: 'domcontentloaded' }); message = `Navigated to ${step.url}`; break;
            case 'click': await page.click(step.selector!); message = `Clicked ${step.selector}`; break;
            case 'fill': await page.fill(step.selector!, step.value || ''); message = `Filled ${step.selector} with "${step.value}"`; break;
            case 'wait': if (step.selector) { await page.waitForSelector(step.selector, { timeout: step.timeout || 30000 }); message = `Element ${step.selector} appeared`; } else { await page.waitForTimeout(Number(step.value) || 1000); message = `Waited ${step.value}ms`; } break;
            case 'assert': { const assertionType = step.value || ''; if (assertionType === 'title') { const title = await page.title(); passed = title.includes(step.selector || ''); message = `Title "${title}" ${passed ? 'contains' : 'missing'} "${step.selector}"`; } else if (assertionType === 'url') { const url = page.url(); passed = url.includes(step.selector || ''); message = `URL "${url}" ${passed ? 'contains' : 'missing'} "${step.selector}"`; } else if (assertionType === 'visible') { passed = await page.locator(step.selector!).isVisible(); message = `Element "${step.selector}" is ${passed ? 'visible' : 'hidden'}`; } break; }
            case 'screenshot': { const path = step.value || `test-step-${i}.png`; await page.screenshot({ path }); message = `Screenshot saved to ${path}`; break; }
            case 'eval': { const result = await page.evaluate(step.value || ''); message = `Eval result: ${JSON.stringify(result)}`; break; }
          }
        } catch { passed = false; message = `Error: ${(error as Error).message}`; }
        const duration = Date.now() - start;
        results.push({ step: i + 1, action: step.action, passed, message, duration });
        if (!passed) { allPassed = false; if (p.stopOnFailure) break; }
      }
      const passedCount = results.filter((r) => r.passed).length;
      return ok({ passed: allPassed, totalSteps: p.steps.length, passedSteps: passedCount, failedSteps: results.length - passedCount, results, summary: `${passedCount}/${results.length} steps passed` });
    },
  });
}
