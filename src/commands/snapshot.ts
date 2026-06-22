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
  description: 'Get page state: interactive @refs to operate (default); --type aria=page outline; --type text=content; --type dom=debug DOM',
  scope: 'page',
  selectorParams: ['selector'],
  examples: [
    {
      cmd: 'xbrowser snapshot',
      description: 'I want to OPERATE the page → returns clickable/fillable @refs (use click @e1, fill @e2)',
      output: '@e1 [button] "Submit"\n@e2 [textbox editable] "Email"',
    },
    {
      cmd: 'xbrowser snapshot --type aria',
      description: 'I want the page OUTLINE/skeleton (nav, heading hierarchy, regions)',
      output: 'banner:\n  navigation:\n    link "Home"\nmain:\n  heading "Welcome"',
    },
    {
      cmd: 'xbrowser snapshot --type text',
      description: 'I want the page TEXT CONTENT (extract body copy/information)',
      output: 'Welcome\nPlease enter your email\nSubmit',
    },
    {
      cmd: 'xbrowser snapshot --type dom',
      description: 'I want to DEBUG the DOM (tag names, attributes, nesting)',
    },
    {
      cmd: 'xbrowser snapshot --selectors',
      description: 'I want to operate AND need stable CSS selectors (reuse across sessions)',
      output: 'e1: #submit | e2: #email',
    },
  ],
  parameters: z.object({
    type: z.enum(['interactive', 'aria', 'text', 'dom', 'all']).default('interactive').describe(
      'Choose by intent: interactive(default)=operate page, get @refs of clickable/fillable elements; aria=page outline (nav/headings/regions); text=page text content; dom=debug DOM tags/attrs; all=everything'
    ),
    selector: z.string().optional().describe('限定到某个元素（CSS 选择器），只快照该子树'),
    depth: z.number().optional().default(6).describe('aria/dom 树的最大深度'),
    interactive: z.boolean().optional().default(false).describe('强制 interactive 模式（等同 --type interactive，兼容 -i）'),
    interactiveOnly: z.boolean().optional().default(false).describe('interactive 的别名'),
    i: z.boolean().optional().default(false).describe('interactive 的短别名'),
    compact: z.boolean().optional().default(false).describe('附带紧凑文本快照（interactive 模式默认已含）'),
    c: z.boolean().optional().default(false).describe('compact 的短别名'),
    selectors: z.boolean().optional().describe('附带 ref → CSS 选择器映射（需要稳定选择器时开）'),
    all: z.boolean().optional().default(false).describe('interactive 模式下连隐藏元素一起采集（注意：这是采集范围，不是 --type all 的合并快照）'),
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

    // Default: interactive refs. Triggered by --type interactive (default),
    // or any of the -i/--interactive/--compact/--selectors flags.
    const wantInteractive = p.type === 'interactive' || p.interactive || p.interactiveOnly || p.i || p.compact || p.c || p.selectors;
    if (wantInteractive) {
      const observation = await observePage(page, ctx.sessionId, {
        includeHidden: p.all,
      });
      if (p.selectors) observation.selectors = buildSelectorMap(observation);
      // compact is always generated for interactive mode (it's the primary human/AI-readable output)
      observation.compact = formatObservationCompact(observation, { selectors: p.selectors });
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
      const [observation, aria, text, dom] = await Promise.all([
        observePage(page, ctx.sessionId, { includeHidden: p.all }),
        captureAriaSnapshot(page, p.selector, p.depth),
        captureTextSnapshot(page, p.selector),
        captureDomSnapshot(page, p.selector, p.depth ?? 6),
      ]);
      observation.compact = formatObservationCompact(observation, { selectors: p.selectors });
      if (p.selectors) observation.selectors = buildSelectorMap(observation);
      const tips = await buildRefTips(page, aria);
      persistSemantics(url, aria);
      // all = interactive targets + aria outline + text content + dom tree
      return ok({ ...observation, aria, text, dom }, normalizeTips([
        ...tips,
        `${observation.targets.length} interactive targets + aria + text + dom combined`,
      ]));
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
  let raw: string;
  try {
    const locator = selector ? page.locator(selector).first() : page.locator('body');
    raw = await locator.ariaSnapshot();
  } catch {
    try {
      raw = await page.locator('body').ariaSnapshot();
    } catch {
      return '(aria snapshot not available)';
    }
  }
  return filterAriaNoise(raw);
}

/**
 * 过滤 Playwright ariaSnapshot() 的噪音行。
 *
 * ariaSnapshot() 会输出大量对 AI 无意义的节点：
 * - `none:` / `none: xxx`：无 ARIA 角色的容器（Chromium 内部节点）
 * - `InlineTextBox`：Chromium 布局引擎的文本片段
 * - `ListMarker: •`：列表圆点等装饰标记
 * - `xxx: `（半空行）：只有角色名没有内容/子节点的空容器
 *
 * 实测同页面噪音占比 71%（见 docs/snapshot-benchmark.md），过滤后体积降 ~70%。
 *
 * 导出供 session-recorder.ts 的 stop() 复用——录制结束时抓 aria 快照也走同一过滤，
 * 保证 `xbrowser snapshot --type aria` 命令和录制产物的快照格式一致。
 */
export function filterAriaNoise(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t === 'none:' || t.startsWith('none: ')) return false;
      if (t.includes('InlineTextBox')) return false;
      if (t.includes('ListMarker')) return false;
      // 半空行：纯角色名 + 冒号，无内容/子节点（如 "banner:" / "navigation:" / "generic:"）。
      // 注意 t 已 trim，这里测的是去掉首尾空白后的纯角色名形式。
      if (/^[a-z]+$/.test(t) || /^[a-z]+:$/.test(t)) return false;
      return true;
    })
    .join('\n');
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
