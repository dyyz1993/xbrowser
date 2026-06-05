import type { Page } from '../browser-shim.js';
import { getRefTarget, normalizeAgentRef, replaceRefs } from './ref-store.js';
import type { AgentActionInput, AgentActionResult, AgentObservation, AgentTarget, AgentTargetAction, AgentWaitInput, AgentWaitResult } from './types.js';

interface RawTarget {
  selector: string;
  role: string;
  name: string;
  tag: string;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  checked?: boolean;
  value?: string;
  box?: AgentTarget['box'];
  actions: AgentTargetAction[];
}

interface RawObservation {
  screenHash: string;
  targets: RawTarget[];
}

export interface ObserveOptions {
  includeHidden?: boolean;
  limit?: number;
}

export interface CompactObservationOptions {
  selectors?: boolean;
}

function sessionKey(sessionId?: string): string {
  return sessionId || 'default';
}

export async function observePage(
  page: Page,
  sessionId: string | undefined,
  options: ObserveOptions = {},
): Promise<AgentObservation> {
  const [title, raw] = await Promise.all([
    page.title().catch(() => ''),
    page.evaluate<RawObservation>(
      ({ includeHidden, limit }: { includeHidden: boolean; limit: number }) => {
        function hash(input: string): string {
          let h = 2166136261;
          for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return (h >>> 0).toString(16);
        }

        function cssEscape(value: string): string {
          const css = globalThis.CSS as { escape?: (v: string) => string } | undefined;
          return css?.escape ? css.escape(value) : value.replace(/["\\#.:,[\]>+~*]/g, '\\$&');
        }

        function isUnique(selector: string): boolean {
          try {
            return document.querySelectorAll(selector).length === 1;
          } catch {
            return false;
          }
        }

        function nthOfType(el: Element): string {
          const tag = el.tagName.toLowerCase();
          const parent = el.parentElement;
          if (!parent) return tag;
          const same = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
          if (same.length === 1) return tag;
          return `${tag}:nth-of-type(${same.indexOf(el) + 1})`;
        }

        function selectorFor(el: Element): string {
          const tag = el.tagName.toLowerCase();
          const id = el.getAttribute('id');
          if (id) {
            const selector = `#${cssEscape(id)}`;
            if (isUnique(selector)) return selector;
          }

          for (const attr of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label']) {
            const value = el.getAttribute(attr);
            if (!value) continue;
            const selector = `[${attr}="${cssEscape(value)}"]`;
            if (isUnique(selector)) return selector;
            const tagged = `${tag}${selector}`;
            if (isUnique(tagged)) return tagged;
          }

          const classes = Array.from(el.classList).slice(0, 3);
          for (const cls of classes) {
            const selector = `${tag}.${cssEscape(cls)}`;
            if (isUnique(selector)) return selector;
          }

          const parts: string[] = [];
          let cur: Element | null = el;
          while (cur && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
            parts.unshift(nthOfType(cur));
            const selector = parts.join(' > ');
            if (isUnique(selector)) return selector;
            cur = cur.parentElement;
          }
          return parts.join(' > ') || tag;
        }

        function roleFor(el: Element): string {
          const explicit = el.getAttribute('role');
          if (explicit) return explicit;
          const tag = el.tagName.toLowerCase();
          if (tag === 'a') return 'link';
          if (tag === 'button') return 'button';
          if (tag === 'select') return 'combobox';
          if (tag === 'textarea') return 'textbox';
          if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
            return 'textbox';
          }
          return tag;
        }

        function textName(el: Element): string {
          const input = el as HTMLInputElement;
          const direct =
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') ||
            input.value ||
            el.textContent ||
            '';
          return direct.replace(/\s+/g, ' ').trim().slice(0, 120);
        }

        function actionsFor(role: string, editable: boolean): AgentTargetAction[] {
          const actions: AgentTargetAction[] = [];
          if (editable) actions.push('fill', 'type');
          if (role === 'combobox') actions.push('select');
          if (role === 'checkbox' || role === 'radio') actions.push('check');
          actions.push('click', 'hover');
          return Array.from(new Set(actions));
        }

        const selector = [
          'a[href]',
          'button',
          'input',
          'textarea',
          'select',
          'summary',
          'label',
          '[role]',
          '[tabindex]',
          '[contenteditable="true"]',
        ].join(',');

        const candidates = Array.from(document.querySelectorAll(selector));
        const seen = new Set<string>();
        const targets: RawTarget[] = [];

        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          if (!includeHidden && !visible) continue;

          const selectorValue = selectorFor(el);
          if (!selectorValue || seen.has(selectorValue)) continue;
          seen.add(selectorValue);

          const input = el as HTMLInputElement;
          const tag = el.tagName.toLowerCase();
          const role = roleFor(el);
          const editable =
            tag === 'textarea' ||
            tag === 'select' ||
            (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio'].includes((input.type || '').toLowerCase())) ||
            (el as HTMLElement).isContentEditable;
          const enabled = !input.disabled && el.getAttribute('aria-disabled') !== 'true';
          const checked = typeof input.checked === 'boolean' && ['checkbox', 'radio'].includes((input.type || '').toLowerCase())
            ? input.checked
            : undefined;

          targets.push({
            selector: selectorValue,
            role,
            name: textName(el),
            tag,
            visible,
            enabled,
            editable,
            ...(checked !== undefined ? { checked } : {}),
            ...(editable && input.value ? { value: input.value.slice(0, 120) } : {}),
            ...(visible ? { box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } } : {}),
            actions: actionsFor(role, editable),
          });

          if (targets.length >= limit) break;
        }

        const stateText = [
          location.href,
          document.title,
          document.body?.innerText?.slice(0, 5000) || '',
        ].join('\n');

        return { screenHash: hash(stateText), targets };
      },
      { includeHidden: !!options.includeHidden, limit: options.limit ?? 80 },
    ) as Promise<RawObservation>,
  ]);

  const targets = raw.targets.map((target, index) => ({
    ref: `e${index + 1}`,
    ...target,
  }));
  replaceRefs(sessionKey(sessionId), raw.screenHash, targets);

  return {
    url: page.url(),
    title,
    screenHash: raw.screenHash,
    timestamp: new Date().toISOString(),
    targets,
  };
}

function quoteName(name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return ` "${cleaned.replace(/"/g, '\\"')}"`;
}

function targetFlags(target: AgentTarget): string {
  const flags: string[] = [target.role || target.tag];
  if (!target.enabled) flags.push('disabled');
  if (target.editable) flags.push('editable');
  if (target.checked !== undefined) flags.push(target.checked ? 'checked' : 'unchecked');
  return flags.join(' ');
}

export function buildSelectorMap(observation: AgentObservation): Record<string, string> {
  return Object.fromEntries(observation.targets.map((target) => [target.ref, target.selector]));
}

export function formatObservationCompact(
  observation: AgentObservation,
  options: CompactObservationOptions = {},
): string {
  const lines = [
    `Page: ${observation.title || '(untitled)'}`,
    `URL: ${observation.url}`,
    `Screen: ${observation.screenHash}`,
    '',
  ];

  if (observation.targets.length === 0) {
    lines.push('(no interactive targets)');
  } else {
    for (const target of observation.targets) {
      lines.push(`@${target.ref} [${targetFlags(target)}]${quoteName(target.name)}`);
    }
  }

  if (options.selectors && observation.targets.length > 0) {
    lines.push('', '## Selectors');
    lines.push(observation.targets.map((target) => `${target.ref}: ${target.selector}`).join(' | '));
  }

  return lines.join('\n');
}

export async function getPageScreenHash(page: Page): Promise<string> {
  const observation = await page.evaluate<string>(() => {
    let h = 2166136261;
    const input = [location.href, document.title, document.body?.innerText?.slice(0, 5000) || ''].join('\n');
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  });
  return observation;
}

async function actionability(page: Page, selector: string): Promise<{ ok: boolean; reason?: string; target?: AgentTarget }> {
  return await page.evaluate<{ ok: boolean; reason?: string }>((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: 'not_found' };
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    if (!visible) return { ok: false, reason: 'not_visible' };
    const input = el as HTMLInputElement;
    const enabled = !input.disabled && el.getAttribute('aria-disabled') !== 'true';
    if (!enabled) return { ok: false, reason: 'disabled' };

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      return { ok: false, reason: 'covered' };
    }
    return { ok: true };
  }, selector);
}

export async function actOnPage(
  page: Page,
  sessionId: string | undefined,
  input: AgentActionInput,
): Promise<AgentActionResult> {
  const normalizedRef = input.ref ? normalizeAgentRef(input.ref) : undefined;
  const refMatch = normalizedRef ? getRefTarget(sessionKey(sessionId), normalizedRef) : null;
  const selector = input.selector || refMatch?.target.selector;
  if (!selector) {
    return {
      action: input.action,
      selector: '',
      ref: normalizedRef,
      success: false,
      reason: input.ref ? 'unknown_ref' : 'missing_target',
      message: normalizedRef ? `Ref "${input.ref}" not found. Run observe again.` : 'Provide ref or selector.',
    };
  }

  const hash = await getPageScreenHash(page).catch(() => undefined);
  const stale = !!(refMatch && hash && hash !== refMatch.screenHash);
  if (!input.force) {
    const check = await actionability(page, selector);
    if (!check.ok) {
      return {
        action: input.action,
        selector,
        ref: normalizedRef,
        success: false,
        reason: stale ? 'stale_ref' : check.reason,
        message: stale ? `Ref "${input.ref}" may be stale. Run observe again.` : `Target is not actionable: ${check.reason}`,
        stale,
        screenHash: hash,
        target: refMatch?.target,
      };
    }
  }

  const timeout = input.timeout ?? 10000;
  try {
    switch (input.action) {
      case 'click':
        await page.locator(selector).first().click({ timeout, force: !!input.force });
        break;
      case 'fill':
        if (input.value === undefined) throw new Error('fill requires value');
        await page.locator(selector).first().fill(input.value, { timeout, force: !!input.force });
        break;
      case 'type':
        if (input.value === undefined) throw new Error('type requires value');
        await page.locator(selector).first().pressSequentially(input.value, { timeout });
        break;
      case 'press':
        if (!input.key) throw new Error('press requires key');
        await page.locator(selector).first().press(input.key, { timeout });
        break;
      case 'select':
        if (input.value === undefined) throw new Error('select requires value');
        await page.locator(selector).first().selectOption(input.value);
        break;
      case 'check':
        await page.locator(selector).first().check({ timeout });
        break;
      case 'hover':
        await page.locator(selector).first().hover({ timeout });
        break;
      default: {
        const neverAction: never = input.action;
        throw new Error(`Unsupported action: ${neverAction}`);
      }
    }
  } catch (error) {
    return {
      action: input.action,
      selector,
      ref: normalizedRef,
      success: false,
      reason: 'browser_error',
      message: (error as Error).message,
      stale,
      screenHash: hash,
      target: refMatch?.target,
    };
  }

  return {
    action: input.action,
    selector,
    ref: normalizedRef,
    success: true,
    stale,
    screenHash: hash,
    target: refMatch?.target,
  };
}

function matchUrlPattern(url: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(url);
  }
  return url.includes(pattern);
}

async function pollUntil(
  timeout: number,
  pollInterval: number,
  predicate: () => Promise<boolean>,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeout) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  return false;
}

export async function waitForPage(page: Page, input: AgentWaitInput): Promise<AgentWaitResult> {
  const timeout = input.timeout ?? 30000;
  const pollInterval = input.pollInterval ?? 200;
  const startedAt = Date.now();

  try {
    if (input.selector) {
      const state = input.state ?? 'visible';
      await page.locator(input.selector).first().waitFor({ state, timeout });
      return { success: true, matched: 'selector', timeout, elapsed: Date.now() - startedAt };
    }

    if (input.text) {
      await page.getByText(input.text).first().waitFor({ state: 'visible', timeout });
      return { success: true, matched: 'text', timeout, elapsed: Date.now() - startedAt };
    }

    if (input.url) {
      const matched = await pollUntil(timeout, pollInterval, async () => matchUrlPattern(page.url(), input.url!));
      return {
        success: matched,
        matched: 'url',
        timeout,
        elapsed: Date.now() - startedAt,
        ...(matched ? {} : { message: `Timed out waiting for URL pattern: ${input.url}` }),
      };
    }

    if (input.load) {
      await page.waitForLoadState(input.load, timeout);
      return { success: true, matched: 'load', timeout, elapsed: Date.now() - startedAt };
    }

    if (input.fn) {
      await page.waitForFunction(input.fn, undefined, { timeout });
      return { success: true, matched: 'fn', timeout, elapsed: Date.now() - startedAt };
    }

    if (input.screenHashChanged) {
      let screenHash = await getPageScreenHash(page);
      const matched = await pollUntil(timeout, pollInterval, async () => {
        screenHash = await getPageScreenHash(page);
        return screenHash !== input.screenHashChanged;
      });
      return {
        success: matched,
        matched: 'screenHashChanged',
        timeout,
        elapsed: Date.now() - startedAt,
        screenHash,
        ...(matched ? {} : { message: `Timed out waiting for screen hash to change: ${input.screenHashChanged}` }),
      };
    }
  } catch (error) {
    return {
      success: false,
      matched: input.selector ? 'selector' : input.text ? 'text' : input.url ? 'url' : input.load ? 'load' : input.fn ? 'fn' : 'screenHashChanged',
      timeout,
      elapsed: Date.now() - startedAt,
      message: (error as Error).message,
    };
  }

  return {
    success: false,
    matched: 'selector',
    timeout,
    elapsed: Date.now() - startedAt,
    message: 'Provide one wait predicate: selector, text, url, load, fn, or screenHashChanged.',
  };
}
