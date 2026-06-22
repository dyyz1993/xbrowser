import { z } from 'zod';
import { ok, fail, normalizeTips } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import type { Page } from '../browser-shim.js';
import { registerCommand } from './command-registry.js';
import { resolveSelectors } from '../utils/resolve-selector.js';
import { extractSemanticElements, extractDomain, saveSemantics, enhanceSemanticsWithLLM } from '../utils/site-semantics.js';
import { buildSelectorMap, formatObservationCompact, observePage } from '../runtime/agent-runtime.js';

export const snapshotCommand = registerCommand({
  name: 'snapshot',
  description: 'Capture a quick page state snapshot — aria tree, visible text, or DOM summary',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    type: z.enum(['aria', 'text', 'dom', 'all']).default('aria').describe('Snapshot type: aria (accessibility tree), text (visible text), dom (element summary), all (combined)'),
    selector: z.string().optional().describe('Scope to a specific element'),
    depth: z.number().optional().default(6).describe('Max depth for DOM/aria tree'),
    interactive: z.boolean().optional().default(false).describe('Return interactive agent refs only'),
    interactiveOnly: z.boolean().optional().default(false).describe('Alias for interactive'),
    i: z.boolean().optional().default(false).describe('Short alias for interactive'),
    compact: z.boolean().optional().default(false).describe('Include compact xbrowser style snapshot text'),
    c: z.boolean().optional().default(false).describe('Short alias for compact'),
    selectors: z.boolean().optional().default(false).describe('Include ref to CSS selector map'),
    all: z.boolean().optional().default(false).describe('Include hidden interactive targets when using interactive snapshot'),
  }),
  result: z.object({
    url: z.string(),
    title: z.string(),
    aria: z.string().optional(),
    text: z.string().optional(),
    dom: z.record(z.unknown()).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const page = ctx.page;

    const url = page.url();
    const title = await page.title().catch(() => '');

    if (p.interactive || p.interactiveOnly || p.i || p.compact || p.c || p.selectors) {
      const observation = await observePage(page, ctx.sessionId, {
        includeHidden: p.all,
      });
      if (p.selectors) observation.selectors = buildSelectorMap(observation);
      if (p.compact || p.c || p.interactive || p.interactiveOnly || p.i) {
        observation.compact = formatObservationCompact(observation, { selectors: p.selectors });
      }
      return ok(observation, normalizeTips([
        `refs refreshed for ${observation.targets.length} targets; use click @e1 or fill @e2 "text"`,
      ]));
    }

    if (p.type === 'aria') {
      const aria = await captureAriaSnapshot(page, p.selector, p.depth);
      const tips = await buildRefTips(page, aria);
      persistSemantics(url, aria);
      return ok({ url, title, aria }, normalizeTips(tips));
    }

    if (p.type === 'text') {
      const text = await captureTextSnapshot(page, p.selector);
      return ok({ url, title, text });
    }

    if (p.type === 'dom') {
      const dom = await captureDomSnapshot(page, p.selector, p.depth ?? 6);
      return ok({ url, title, dom });
    }

    if (p.type === 'all') {
      const [aria, text, dom] = await Promise.all([
        captureAriaSnapshot(page, p.selector, p.depth),
        captureTextSnapshot(page, p.selector),
        captureDomSnapshot(page, p.selector, p.depth ?? 6),
      ]);
      const tips = await buildRefTips(page, aria);
      persistSemantics(url, aria);
      return ok({ url, title, aria, text, dom }, normalizeTips(tips));
    }

    return fail(`Unknown snapshot type: ${p.type}`);
  },
});

function persistSemantics(url: string, aria: string | undefined): void {
  if (!aria || aria === '(aria snapshot not available)') return;
  try {
    const domain = extractDomain(url);
    const pathKey = new URL(url).pathname.replace(/\/$/, '') || '/';
    const elements = extractSemanticElements(aria);
    if (Object.keys(elements).length > 0) {
      saveSemantics(domain, pathKey, url, elements);
    }
    enhanceSemanticsWithLLM(url, aria, elements).catch(() => {});
  } catch {
    // semantics persistence is non-critical
  }
}

async function buildRefTips(page: Page, aria: string | undefined): Promise<string[]> {
  if (!aria) return [];
  try {
    const mappings = await resolveSelectors(page, aria);
    return mappings.map(m => `ref=${m.ref} => ${m.selector}  (${m.method})`);
  } catch {
    return [];
  }
}

async function captureAriaSnapshot(page: Page, selector?: string, _depth?: number): Promise<string> {
  try {
    const locator = selector ? page.locator(selector).first() : page.locator('body');
    return await locator.ariaSnapshot();
  } catch {
    try {
      return await page.locator('body').ariaSnapshot();
    } catch {
      return '(aria snapshot not available)';
    }
  }
}

async function captureTextSnapshot(page: Page, selector?: string): Promise<string> {
  if (selector) {
    return await page.locator(selector).first().innerText().catch(() => '');
  }
  return await page.evaluate<string>(() => document.body?.innerText || '').catch(() => '');
}

async function captureDomSnapshot(page: Page, selector?: string, maxDepth?: number): Promise<Record<string, unknown>> {
  return await page.evaluate<Record<string, unknown>>(
    (args: { sel: string; depth: number }) => {
      const root = args.sel ? document.querySelector(args.sel) : document.body;
      if (!root) return { tag: 'none' };

      function build(el: Element, d: number): Record<string, unknown> {
        const tag = el.tagName.toLowerCase();
        const attrs: Record<string, string> = {};
        for (const a of Array.from(el.attributes).slice(0, 10)) {
          attrs[a.name] = a.value.length > 100 ? a.value.slice(0, 100) + '...' : a.value;
        }
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;

        const node: Record<string, unknown> = {
          tag,
          visible,
          ...(visible ? { box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } } : {}),
        };
        if (Object.keys(attrs).length > 0) node.attrs = attrs;

        const text = (el.childNodes[0]?.textContent || '').trim().slice(0, 80);
        if (text) node.text = text;

        if (d > 0 && el.children.length > 0) {
          node.children = Array.from(el.children).map(c => build(c, d - 1));
        }

        return node;
      }

      return build(root, args.depth);
    },
    { sel: selector || 'body', depth: maxDepth || 6 },
  ).catch(() => ({ tag: 'error' }));
}
