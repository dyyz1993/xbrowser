import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import { z } from 'zod';

type Page = import('../types').Page;

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'assert',
    url: 'https://xbrowser.dev',
    description: 'Assert page state — check text, visibility, URL, title, element count',
  });

  site.command('assert', {
    description: 'Assert page state — check text, visibility, URL, title, element count',
    scope: 'page',
    parameters: z.object({
      type: z.enum(['text', 'visible', 'hidden', 'url', 'title', 'count', 'attribute', 'css', 'enabled', 'checked']).describe('Assertion type'),
      selector: z.string().optional().describe('CSS selector for element assertions'),
      value: z.string().optional().describe('Expected value'),
      expected: z.union([z.string(), z.number()]).optional().describe('Expected value (for count/type comparisons)'),
      timeout: z.number().optional().default(5000).describe('Max wait time in ms'),
    }),
    result: z.object({
      passed: z.boolean(),
      type: z.string(),
      actual: z.string(),
      message: z.string(),
      expected: z.string().optional(),
    }),
    handler: async (p, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page;
      let passed = false;
      let actual: string | number | boolean | null = null;
      let message = '';
      try {
        switch (p.type) {
          case 'text': { const text = await page.textContent('body'); actual = text || ''; passed = actual.includes(p.value || ''); message = `Page text ${passed ? 'contains' : 'does not contain'} "${p.value}"`; break; }
          case 'visible': { const locator = page.locator(p.selector!); await locator.waitFor({ state: 'visible', timeout: p.timeout }); passed = true; actual = 'visible'; message = `Element "${p.selector}" is visible`; break; }
          case 'hidden': { const locator = page.locator(p.selector!); await locator.waitFor({ state: 'hidden', timeout: p.timeout }); passed = true; actual = 'hidden'; message = `Element "${p.selector}" is hidden`; break; }
          case 'url': { actual = page.url(); passed = actual.includes(p.value || ''); message = `URL ${passed ? 'contains' : 'does not contain'} "${p.value}"`; break; }
          case 'title': { actual = await page.title(); passed = actual.includes(p.value || ''); message = `Title ${passed ? 'contains' : 'does not contain'} "${p.value}"`; break; }
          case 'count': { const elements = await page.locator(p.selector!).count(); actual = elements; passed = elements === Number(p.expected); message = `Element count: ${elements} ${passed ? '==' : '!='} ${p.expected}`; break; }
          case 'attribute': { const element = page.locator(p.selector!).first(); const attrValue = await element.getAttribute(p.value || ''); actual = attrValue || ''; passed = actual === String(p.expected || ''); message = `Attribute "${p.value}": "${actual}" ${passed ? '==' : '!='} "${p.expected}"`; break; }
          case 'css': { const element = page.locator(p.selector!).first(); actual = await element.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), p.value || ''); passed = actual === String(p.expected || ''); message = `CSS "${p.value}": "${actual}" ${passed ? '==' : '!='} "${p.expected}"`; break; }
          case 'enabled': { const element = page.locator(p.selector!).first(); passed = await element.isEnabled(); actual = passed; message = `Element "${p.selector}" is ${passed ? 'enabled' : 'disabled'}`; break; }
          case 'checked': { const element = page.locator(p.selector!).first(); passed = await element.isChecked(); actual = passed; message = `Element "${p.selector}" is ${passed ? 'checked' : 'unchecked'}`; break; }
        }
      } catch (error) { passed = false; message = `Assertion failed: ${(error as Error).message}`; }
      if (!passed) return ok({ passed: false, type: p.type, actual: String(actual), expected: p.value ?? String(p.expected ?? ''), message });
      return ok({ passed: true, type: p.type, actual: String(actual), message });
    },
  });
}
