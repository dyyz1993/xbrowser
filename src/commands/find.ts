import { z } from 'zod';
import { ok, fail, normalizeTips } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import type { Locator, Page } from '../browser-shim.js';

const actionSchema = z.enum(['click', 'fill', 'type', 'select', 'hover', 'check']);

export const findCommand = registerCommand({
  name: 'find',
  description: 'Find elements by semantic strategy (text/role/label/placeholder/testid) and optionally perform an action',
  scope: 'page',
  parameters: z.object({
    strategy: z.enum(['text', 'role', 'label', 'placeholder', 'testid', 'alt', 'title', 'first', 'last', 'nth']),
    value: z.string(),
    name: z.string().optional(),
    exact: z.boolean().optional().default(false),
    operation: z.string().optional().describe('Trailing operation syntax, e.g. click, fill "text", type "text"'),
    action: actionSchema.optional().describe('Action to perform when not using trailing operation syntax'),
    actionValue: z.string().optional().describe('Value for fill/type/select when using action'),
    index: z.number().int().optional().describe('Index for nth strategy'),
    click: z.boolean().optional().default(false),
    fill: z.string().optional(),
    type: z.string().optional(),
    select: z.string().optional(),
    hover: z.boolean().optional().default(false),
    check: z.boolean().optional().default(false),
    timeout: z.number().optional().default(10000),
  }),
  result: z.object({
    matched: z.number(),
    selector: z.string(),
    action: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const page = ctx.page;
    const normalized = normalizeFindParams({ ...p });
    const parsedOperation = parseOperation(normalized.operation);
    const actionName = parsedOperation.action || p.action || inferLegacyAction(p);
    const actionValue = parsedOperation.value ?? p.actionValue ?? p.fill ?? p.type ?? p.select;

    const locator = buildLocator(page, normalized.strategy, normalized.value, {
      name: p.name,
      exact: p.exact,
      index: normalized.index,
    });

    const count = await locator.count();
    if (count === 0) {
      return fail(`No element found with ${p.strategy}="${p.value}"`);
    }

    const tips: string[] = [];
    const target = selectTarget(locator, p.strategy);

    if (count > 1) {
      tips.push(`⚠️ Matched ${count} elements, used first match. Use 'find nth <index> ${normalized.strategy} "${normalized.value}" ${actionName || 'click'}' for a specific match.`);
    }

    const selector = describeSelector(normalized.strategy, normalized.value, p.name);

    if (actionName === 'click') {
      await target.click({ timeout: p.timeout, force: true });
      return okWithTips({ matched: count, selector, action: 'click' }, tips);
    } else if (actionName === 'fill') {
      if (actionValue === undefined) return fail('find fill requires a value');
      await target.fill(actionValue, { timeout: p.timeout, force: true });      return okWithTips({ matched: count, selector, action: `fill("${actionValue}")` }, tips);
    } else if (actionName === 'type') {
      if (actionValue === undefined) return fail('find type requires a value');
      await target.type(actionValue, { delay: 10, timeout: p.timeout });
      return okWithTips({ matched: count, selector, action: `type("${actionValue}")` }, tips);
    } else if (actionName === 'select') {
      if (actionValue === undefined) return fail('find select requires a value');
      await target.selectOption(actionValue);
      return okWithTips({ matched: count, selector, action: `select("${actionValue}")` }, tips);
    } else if (actionName === 'hover') {
      await target.hover({ timeout: p.timeout, force: true });
      return okWithTips({ matched: count, selector, action: 'hover' }, tips);
    } else if (actionName === 'check') {
      await target.check({ timeout: p.timeout });
      return okWithTips({ matched: count, selector, action: 'check' }, tips);
    }

    return okWithTips({ matched: count, selector }, tips);
  },
});

function okWithTips(data: { matched: number; selector: string; action?: string }, tips: string[]) {
  const result = ok(data);
  if (tips.length > 0) result.tips = normalizeTips(tips);
  return result;
}

function parseOperation(operation?: string): { action?: z.infer<typeof actionSchema>; value?: string } {
  if (!operation) return {};
  const match = operation.trim().match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) return {};
  const maybeAction = match[1];
  const parsed = actionSchema.safeParse(maybeAction);
  if (!parsed.success) return {};
  const rawValue = match[2];
  const value = rawValue?.replace(/^["']|["']$/g, '');
  return { action: parsed.data, ...(value !== undefined ? { value } : {}) };
}

function normalizeFindParams(p: {
  strategy: 'text' | 'role' | 'label' | 'placeholder' | 'testid' | 'alt' | 'title' | 'first' | 'last' | 'nth';
  value: string;
  operation?: string;
  index?: number;
}): {
  strategy: typeof p.strategy;
  value: string;
  operation?: string;
  index?: number;
} {
  if (p.strategy !== 'nth') return { strategy: p.strategy, value: p.value, operation: p.operation, index: p.index };

  const parsedIndex = Number(p.value);
  if (!Number.isInteger(parsedIndex) || !p.operation) {
    return { strategy: p.strategy, value: p.value, operation: p.operation, index: p.index };
  }

  const match = p.operation.trim().match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) {
    return { strategy: p.strategy, value: p.value, operation: p.operation, index: parsedIndex };
  }

  return {
    strategy: p.strategy,
    value: match[1].replace(/^["']|["']$/g, ''),
    ...(match[2] ? { operation: match[2] } : {}),
    index: parsedIndex,
  };
}

function inferLegacyAction(p: {
  click?: boolean;
  fill?: string;
  type?: string;
  select?: string;
  hover?: boolean;
  check?: boolean;
}): z.infer<typeof actionSchema> | undefined {
  if (p.click) return 'click';
  if (p.fill !== undefined) return 'fill';
  if (p.type !== undefined) return 'type';
  if (p.select !== undefined) return 'select';
  if (p.hover) return 'hover';
  if (p.check) return 'check';
  return undefined;
}

function buildLocator(
  page: Page,
  strategy: string,
  value: string,
  opts: { name?: string; exact?: boolean; index?: number },
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
    case 'alt':
      return page.getByAltText(value, { exact: opts.exact });
    case 'title':
      return page.getByTitle(value, { exact: opts.exact });
    case 'first':
      return page.locator(value).first();
    case 'last':
      return page.locator(value).last();
    case 'nth':
      return page.locator(value).nth(opts.index ?? 0);
    default:
      return page.getByText(value, { exact: opts.exact });
  }
}

function selectTarget(locator: Locator, strategy: string): Locator {
  if (strategy === 'first' || strategy === 'last' || strategy === 'nth') return locator;
  return locator.first();
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
    case 'alt':
      return `getByAltText("${value}")`;
    case 'title':
      return `getByTitle("${value}")`;
    case 'first':
      return `first("${value}")`;
    case 'last':
      return `last("${value}")`;
    case 'nth':
      return `nth("${value}")`;
    default:
      return `${strategy}("${value}")`;
  }
}
