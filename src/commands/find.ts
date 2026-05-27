import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import type { Locator } from 'playwright';

export const findCommand = registerCommand({
  name: 'find',
  description: 'Find elements by semantic strategy (text/role/label/placeholder/testid) and optionally perform an action',
  scope: 'page',
  parameters: z.object({
    strategy: z.enum(['text', 'role', 'label', 'placeholder', 'testid']),
    value: z.string(),
    name: z.string().optional(),
    exact: z.boolean().optional().default(false),
    click: z.boolean().optional().default(false),
    fill: z.string().optional(),
    type: z.string().optional(),
    select: z.string().optional(),
    timeout: z.number().optional().default(10000),
  }),
  result: z.object({
    matched: z.number(),
    selector: z.string(),
    action: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const page = ctx.page;

    const locator = buildLocator(page, p.strategy, p.value, {
      name: p.name,
      exact: p.exact,
    });

    const count = await locator.count();
    if (count === 0) {
      return fail(`No element found with ${p.strategy}="${p.value}"`);
    }

    const tips: string[] = [];
    const target = locator.first();

    if (count > 1) {
      tips.push(`⚠️ Matched ${count} elements, using first`);
    }

    const selector = describeSelector(p.strategy, p.value, p.name);
    let action: string | undefined;

    if (p.click) {
      await target.click({ timeout: p.timeout, force: true });
      action = 'click';
    } else if (p.fill !== undefined) {
      await target.fill(p.fill, { timeout: p.timeout, force: true });
      action = `fill("${p.fill}")`;
    } else if (p.type !== undefined) {
      await target.type(p.type, { delay: 10, timeout: p.timeout });
      action = `type("${p.type}")`;
    } else if (p.select !== undefined) {
      await target.selectOption(p.select, { timeout: p.timeout, force: true });
      action = `select("${p.select}")`;
    }

    const result = ok({ matched: count, selector, action });
    if (tips.length > 0) result.tips = tips;
    return result;
  },
});

function buildLocator(
  page: import('playwright').Page,
  strategy: string,
  value: string,
  opts: { name?: string; exact?: boolean },
): Locator {
  switch (strategy) {
    case 'text':
      return page.getByText(value, { exact: opts.exact });
    case 'role':
      return page.getByRole(value as 'button', { name: opts.name, exact: opts.exact });
    case 'label':
      return page.getByLabel(value, { exact: opts.exact });
    case 'placeholder':
      return page.getByPlaceholder(value, { exact: opts.exact });
    case 'testid':
      return page.getByTestId(value);
    default:
      return page.getByText(value, { exact: opts.exact });
  }
}

function describeSelector(strategy: string, value: string, name?: string): string {
  switch (strategy) {
    case 'role':
      return name ? `getByRole("${value}", name="${name}")` : `getByRole("${value}")`;
    case 'text':
      return `getByText("${value}")`;
    case 'label':
      return `getByLabel("${value}")`;
    case 'placeholder':
      return `getByPlaceholder("${value}")`;
    case 'testid':
      return `getByTestId("${value}")`;
    default:
      return `${strategy}("${value}")`;
  }
}
