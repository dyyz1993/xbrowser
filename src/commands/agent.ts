import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { observePage, actOnPage, waitForPage, buildSelectorMap, formatObservationCompact } from '../runtime/agent-runtime.js';
import { registerCommand } from './command-registry.js';

export const observeCommand = registerCommand({
  name: 'observe',
  description: 'Observe the current page as structured agent targets with session refs',
  scope: 'page',
  parameters: z.object({
    includeHidden: z.boolean().optional().default(false).describe('Include hidden elements in the target list'),
    limit: z.number().int().positive().max(300).optional().default(80).describe('Maximum number of targets to return'),
    compact: z.boolean().optional().default(false).describe('Include compact xbrowser style snapshot text'),
    selectors: z.boolean().optional().default(false).describe('Include ref to stable CSS selector map'),
  }),
  result: z.object({
    targets: z.array(z.record(z.unknown())),
    selectors: z.record(z.unknown()).optional(),
    compact: z.string().optional(),
  }).passthrough(),
  handler: async (p, ctx: BrowserCommandContext) => {
    const observation = await observePage(ctx.page, ctx.sessionId, {
      includeHidden: p.includeHidden,
      limit: p.limit,
    });
    if (p.selectors) observation.selectors = buildSelectorMap(observation);
    if (p.compact) observation.compact = formatObservationCompact(observation, { selectors: p.selectors });
    return ok(observation, [
      `refs refreshed for ${observation.targets.length} targets; use act --ref @e1 --action click or click @e1`,
    ]);
  },
});

export const actCommand = registerCommand({
  name: 'act',
  description: 'Perform an agent action using an observe ref or explicit selector',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    action: z.enum(['click', 'fill', 'type', 'press', 'select', 'check', 'hover']).default('click'),
    ref: z.string().optional().describe('Session-scoped ref returned by observe, such as e1'),
    selector: z.string().optional().describe('CSS selector fallback when no ref is available'),
    value: z.string().optional().describe('Value for fill/type/select'),
    key: z.string().optional().describe('Key for press'),
    force: z.boolean().optional().default(false).describe('Bypass actionability checks'),
    timeout: z.number().optional().default(10000).describe('Playwright action timeout in milliseconds'),
  }).refine((p) => !!p.ref || !!p.selector, {
    message: 'Either ref or selector is required',
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const result = await actOnPage(ctx.page, ctx.sessionId, { ...p });
    if (!result.success) {
      return {
        success: false,
        data: result,
        message: result.message || result.reason || 'Action failed',
        tips: result.stale ? ['run observe again to refresh refs'] : [],
      };
    }
    return ok(result, result.stale ? ['ref screen hash changed; run observe if the next action is uncertain'] : []);
  },
});

export const waitForCommand = registerCommand({
  name: 'waitFor',
  description: 'Wait for agent predicates such as text, URL, load state, selector state, or screen hash changes',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string().optional().describe('CSS selector or observe ref to wait for'),
    state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().default('visible'),
    text: z.string().optional().describe('Visible text to wait for'),
    url: z.string().optional().describe('URL substring or glob pattern to wait for'),
    load: z.enum(['load', 'domcontentloaded', 'networkidle']).optional().describe('Load state to wait for'),
    fn: z.string().optional().describe('JavaScript predicate to wait for'),
    screenHashChanged: z.string().optional().describe('Previous screenHash from observe'),
    timeout: z.number().optional().default(30000),
    pollInterval: z.number().optional().default(200),
  }).refine((p) => [p.selector, p.text, p.url, p.load, p.fn, p.screenHashChanged].filter(Boolean).length === 1, {
    message: 'Provide exactly one wait predicate: selector, text, url, load, fn, or screenHashChanged',
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const result = await waitForPage(ctx.page, { ...p });
    if (!result.success) {
      return {
        success: false,
        data: result,
        message: result.message || `Timed out waiting for ${result.matched}`,
        tips: [],
      };
    }
    return ok(result);
  },
});
