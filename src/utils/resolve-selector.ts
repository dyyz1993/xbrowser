import type { Page } from 'playwright';
import { getRefTarget, normalizeAgentRef } from '../runtime/ref-store.js';

export interface RefMapping {
  ref: string;
  ariaLine: string;
  selector: string;
  method: string;
}

export function buildElementSelector(el: Element): string {
  function isUnique(sel: string): boolean {
    try { return document.querySelectorAll(sel).length === 1; } catch { return false; }
  }

  function nthIndex(element: Element): number {
    const par = element.parentElement;
    if (!par) return 1;
    const sibs = Array.from(par.children as HTMLCollectionOf<Element>).filter((c: Element) => c.tagName === element.tagName);
    return sibs.indexOf(element) + 1;
  }

  function isOnlyOfType(element: Element): boolean {
    const par = element.parentElement;
    if (!par) return true;
    return Array.from(par.children as HTMLCollectionOf<Element>).filter((c: Element) => c.tagName === element.tagName).length === 1;
  }

  function isLastOfType(element: Element): boolean {
    const par = element.parentElement;
    if (!par) return true;
    const sibs = Array.from(par.children as HTMLCollectionOf<Element>).filter((c: Element) => c.tagName === element.tagName);
    return sibs.indexOf(element) === sibs.length - 1;
  }

  function shortTag(element: Element): string {
    const tag = element.tagName.toLowerCase();
    if (isOnlyOfType(element)) return tag;
    if (isLastOfType(element)) return tag + ':last-of-type';
    return tag + ':nth-of-type(' + nthIndex(element) + ')';
  }

  function anchorSelector(element: Element): string | null {
    if (element === document.body || element === document.documentElement) return null;
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    const tag = element.tagName.toLowerCase();
    const classes = Array.from(element.classList);
    for (const cls of classes) {
      const sel = tag + '.' + CSS.escape(cls);
      if (isUnique(sel)) return sel;
    }
    const testId = element.getAttribute('data-testid');
    if (testId && isUnique('[data-testid="' + CSS.escape(testId) + '"]')) return '[data-testid="' + CSS.escape(testId) + '"]';
    return null;
  }

  function findNearestAnchor(element: Element): { anchor: Element | null; selector: string | null; depth: number } {
    let cur: Element | null = element.parentElement;
    let depth = 1;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const sel = anchorSelector(cur);
      if (sel) return { anchor: cur, selector: sel, depth };
      cur = cur.parentElement;
      depth++;
    }
    return { anchor: null, selector: null, depth };
  }

  function pathBetween(ancestor: Element | null, ancestorSel: string | null, descendant: Element): string {
    if (!ancestor || !ancestorSel) {
      const parts: string[] = [];
      let cur: Element | null = descendant;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        parts.unshift(shortTag(cur));
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    const parts: string[] = [ancestorSel];
    let cur: Element | null = descendant;
    const stack: Element[] = [];
    while (cur && cur !== ancestor) {
      stack.unshift(cur);
      cur = cur.parentElement;
    }
    for (const node of stack) parts.push(shortTag(node));
    return parts.join(' > ');
  }

  function shortenPath(fullPath: string): string {
    const segments = fullPath.split(' > ');
    for (let drop = 1; drop < segments.length; drop++) {
      const shortened = segments.slice(drop).join(' > ');
      if (isUnique(shortened)) return shortened;
    }
    return fullPath;
  }

  const candidates: string[] = [];

  if (el.id) {
    const sel = '#' + CSS.escape(el.id);
    if (isUnique(sel)) candidates.push(sel);
  }

  const name = el.getAttribute('name');
  if (name) {
    const sel = '[name="' + CSS.escape(name) + '"]';
    if (isUnique(sel)) candidates.push(sel);
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = '[aria-label="' + CSS.escape(ariaLabel) + '"]';
    if (isUnique(sel)) candidates.push(sel);
  }

  const testId = el.getAttribute('data-testid');
  if (testId) {
    const sel = '[data-testid="' + CSS.escape(testId) + '"]';
    if (isUnique(sel)) candidates.push(sel);
  }

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .map(cls => ({ cls, sel: tag + '.' + CSS.escape(cls), count: document.querySelectorAll(tag + '.' + CSS.escape(cls)).length }))
    .sort((a, b) => a.count - b.count);

  for (const { sel } of classes) {
    if (isUnique(sel)) candidates.push(sel);
  }
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const sel = tag + '.' + CSS.escape(classes[i].cls) + '.' + CSS.escape(classes[j].cls);
      if (isUnique(sel)) candidates.push(sel);
    }
  }

  if (el.children.length === 0) {
    const text = (el.textContent || '').trim();
    if (text && text.length <= 80) {
      const sel = tag + ':has-text("' + text.slice(0, 50).replace(/"/g, '\\"') + '")';
      if (isUnique(sel)) candidates.push(sel);
    }
  }

  const { anchor, selector: anchorSel } = findNearestAnchor(el);
  const anchoredPath = pathBetween(anchor, anchorSel, el);
  if (isUnique(anchoredPath)) candidates.push(anchoredPath);

  const fullPath = pathBetween(null, null, el);
  if (fullPath && isUnique(fullPath)) {
    candidates.push(shortenPath(fullPath));
  }

  if (candidates.length === 0) return tag;

  return candidates.reduce((best, cur) => cur.length < best.length ? cur : best);
}

export function extractRefs(ariaSnapshot: string): Array<{ ref: string; line: string }> {
  const results: Array<{ ref: string; line: string }> = [];
  const lines = ariaSnapshot.split('\n');
  for (const line of lines) {
    const match = line.match(/\[ref=(e\d+)\]/);
    if (match) {
      results.push({ ref: match[1], line: line.trim() });
    }
  }
  return results;
}

function detectMethod(selector: string): string {
  if (selector.startsWith('#')) return 'id';
  if (/^\[name=/.test(selector)) return 'name';
  if (/^\[(aria-|role=)/.test(selector)) return 'aria';
  if (/^\[data-testid=/.test(selector)) return 'testid';
  if (selector.includes(':has-text(')) return 'text';
  if (selector.includes(':nth-child') || selector.includes('>')) return 'path';
  if (selector.includes('.')) return 'class';
  return 'tag';
}

export async function resolveSelectors(page: Page, ariaSnapshot: string): Promise<RefMapping[]> {
  const refs = extractRefs(ariaSnapshot);
  if (refs.length === 0) return [];

  const results: RefMapping[] = [];

  for (const { ref, line } of refs) {
    try {
      const locator = page.locator(`internal:ref=${ref}`);
      const count = await locator.count();
      if (count === 0) continue;

      const selector = await locator.first().evaluate(buildElementSelector).catch(() => '');

      if (selector) {
        results.push({ ref, ariaLine: line, selector, method: detectMethod(selector) });
      }
    } catch {
      // ref may be stale or element detached
    }
  }

  return results;
}

export function formatRefMappings(mappings: RefMapping[]): string {
  if (mappings.length === 0) return '';
  return mappings.map(m => `  ref=${m.ref} => ${m.selector}  (${m.method})`).join('\n');
}

const REF_ONLY = /^@?(e\d+)$/;

const refCache = new Map<string, string>();

export function clearRefCache(): void {
  refCache.clear();
}

export async function resolveRefParams(
  page: Page,
  params: Record<string, unknown>,
  selectorKeys: string[],
  cache?: Map<string, string>,
  sessionId?: string,
): Promise<{ params: Record<string, unknown>; tips: string[] }> {
  const tips: string[] = [];
  const newParams = { ...params };

  if (!selectorKeys || selectorKeys.length === 0) {
    return { params: newParams, tips };
  }

  for (const key of selectorKeys) {
    const val = params[key];
    if (typeof val !== 'string' || !REF_ONLY.test(val)) continue;

    const match = val.match(REF_ONLY);
    if (!match) continue;
    const ref = normalizeAgentRef(match[1]);

    if (sessionId) {
      const runtimeTarget = getRefTarget(sessionId, ref);
      if (runtimeTarget) {
        tips.push(`ref=@${ref} (${key}) => ${runtimeTarget.target.selector}  (observe)`);
        newParams[key] = runtimeTarget.target.selector;
        continue;
      }
    }

    const activeCache = cache ?? refCache;
    const cached = activeCache.get(ref);
    if (cached) {
      tips.push(`ref=${ref} (${key}) => ${cached}  (cached)`);
      newParams[key] = cached;
      continue;
    }

    try {
      const locator = page.locator(`internal:ref=${ref}`);
      const count = await locator.count();
      if (count === 0) {
        tips.push(`ref=${ref} (${key}) => ⚠️ element not found`);
        continue;
      }

      const selector = await locator.first().evaluate(buildElementSelector).catch(() => '');

      if (selector) {
        const method = detectMethod(selector);
        tips.push(`ref=${ref} (${key}) => ${selector}  (${method})`);
        activeCache.set(ref, selector);
        newParams[key] = selector;
      }
    } catch {
      // ref stale
    }
  }

  return { params: newParams, tips };
}
