/**
 * Rule: DOM Property Mutation — Comprehensive Edition
 *
 * Detects ALL direct DOM property setters via Runtime.evaluate / Runtime.callFunctionOn.
 * Each pattern bypasses framework reactivity (React setter, Vue proxy, Angular zone.js).
 *
 * Severity tiers:
 *   danger  → hard block (100% automation signal)
 *   warn    → soft block (likely automation, some legitimate uses)
 *   info    → log only (could be context-dependent)
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';
import { extractUserCode } from './shared.js';

interface DomPattern {
  pattern: RegExp;
  name: string;
  severity: 'danger' | 'warn' | 'info';
  action: 'block' | 'pass';
  errorCode: number;
  suggestion: string;
}

const DOM_PATTERNS: DomPattern[] = [
  // ── P0: Value/Checked (bypasses React onChange) ────────────
  { pattern: /\.value\s*=\s*(?!["'\s]*$)/, name: '.value =', severity: 'danger', action: 'block', errorCode: -32001, suggestion: 'Use page.fill(selector, value) which dispatches proper input/change events.' },
  { pattern: /\.checked\s*=\s*(?:true|false)/, name: '.checked =', severity: 'danger', action: 'block', errorCode: -32001, suggestion: 'Use page.check(selector) or page.uncheck(selector).' },
  { pattern: /\.indeterminate\s*=\s*true/, name: '.indeterminate =', severity: 'warn', action: 'block', errorCode: -32021, suggestion: 'No human can set indeterminate state — remove this call.' },
  { pattern: /\.valueAsDate\s*=/, name: '.valueAsDate =', severity: 'warn', action: 'block', errorCode: -32022, suggestion: 'Use page.fill() with formatted date string instead.' },
  { pattern: /\.valueAsNumber\s*=/, name: '.valueAsNumber =', severity: 'warn', action: 'block', errorCode: -32022, suggestion: 'Use page.fill() with numeric string instead.' },

  // ── P1: Select/Option (bypasses React onChange on select) ─
  { pattern: /\.selectedIndex\s*=\s*\d+/, name: '.selectedIndex =', severity: 'danger', action: 'block', errorCode: -32003, suggestion: 'Use page.selectOption(selector, value).' },
  { pattern: /(?:options|children)\s*\[[^\]]*\]\s*\.\s*selected\s*=\s*(?:true|false)/, name: 'options[N].selected =', severity: 'danger', action: 'block', errorCode: -32003, suggestion: 'Use page.selectOption(selector, value).' },
  { pattern: /\.value\s*=\s*["'][^"']*["']\s*[;)]?\s*$/, name: 'selectElement.value =', severity: 'warn', action: 'block', errorCode: -32023, suggestion: 'For select elements, use page.selectOption(selector, value).' },

  // ── P2: Content properties (bypasses virtual DOM diffing) ──
  { pattern: /\.innerHTML\s*=/, name: '.innerHTML =', severity: 'info', action: 'pass', errorCode: -32007, suggestion: '.innerHTML bypasses React/Vue diffing. Use component state or page.setContent().' },
  { pattern: /\.outerHTML\s*=/, name: '.outerHTML =', severity: 'info', action: 'pass', errorCode: -32007, suggestion: 'outerHTML replacement destroys React fiber tree. Use page.setContent().' },
  { pattern: /\.innerText\s*=/, name: '.innerText =', severity: 'warn', action: 'block', errorCode: -32024, suggestion: 'Framework components should be updated via state, not innerText.' },
  { pattern: /\.textContent\s*=/, name: '.textContent =', severity: 'warn', action: 'block', errorCode: -32024, suggestion: 'textContent bypasses React/Vue diffing. Use component state instead.' },
  { pattern: /\.outerText\s*=/, name: '.outerText =', severity: 'warn', action: 'block', errorCode: -32024, suggestion: 'Non-standard property — use proper framework update methods.' },
  { pattern: /nodeValue\s*=/, name: 'node.nodeValue =', severity: 'info', action: 'block', errorCode: -32025, suggestion: 'Direct text node mutation. Use textContent instead if needed.' },

  // ── P3: Style properties ──────────────────────────────────
  { pattern: /\.style\s*=\s*["']/, name: '.style = (string override)', severity: 'info', action: 'pass', errorCode: -32008, suggestion: 'Setting style as a string overwrites CSSStyleDeclaration. Use element.style.prop = "value".' },
  { pattern: /\.style\.cssText\s*=/, name: '.style.cssText =', severity: 'info', action: 'pass', errorCode: -32008, suggestion: 'style.cssText replacement destroys inline styles — use individual property set.' },
  { pattern: /\.style\.setProperty\s*\(/, name: '.style.setProperty()', severity: 'info', action: 'pass', errorCode: -32008, suggestion: 'Direct style property set bypasses CSS transitions.' },
  { pattern: /\.style\.removeProperty\s*\(/, name: '.style.removeProperty()', severity: 'info', action: 'pass', errorCode: -32026, suggestion: 'Style removal without user interaction is suspicious.' },
  { pattern: /\.style\.animation\s*=/, name: '.style.animation =', severity: 'info', action: 'pass', errorCode: -32027, suggestion: 'Forcing animation state via CDP is detectable.' },
  { pattern: /\.style\.transition\s*=/, name: '.style.transition =', severity: 'info', action: 'pass', errorCode: -32027, suggestion: 'Manipulating CSS transitions is rare in normal browsing.' },

  // ── P4: Class/Attribute properties ────────────────────────
  { pattern: /\.className\s*=/, name: '.className =', severity: 'info', action: 'pass', errorCode: -32009, suggestion: 'Use component state or a Playwright locator instead.' },
  { pattern: /\.classList\.add\s*\(/, name: '.classList.add()', severity: 'info', action: 'pass', errorCode: -32009, suggestion: 'classList manipulation via CDP bypasses framework state tracking.' },
  { pattern: /\.classList\.remove\s*\(/, name: '.classList.remove()', severity: 'info', action: 'pass', errorCode: -32009, suggestion: 'Use component state or attribute selectors instead.' },
  { pattern: /\.classList\.toggle\s*\(/, name: '.classList.toggle()', severity: 'info', action: 'pass', errorCode: -32009, suggestion: 'Toggle without user interaction is detectable.' },
  { pattern: /\.classList\.replace\s*\(/, name: '.classList.replace()', severity: 'info', action: 'pass', errorCode: -32028, suggestion: 'Rare operation — likely automated.' },

  // ── P5: Attribute manipulation ────────────────────────────
  { pattern: /\.setAttribute\s*\(/, name: '.setAttribute()', severity: 'info', action: 'pass', errorCode: -32010, suggestion: 'setAttribute bypasses framework attribute tracking. Use component state.' },
  { pattern: /\.removeAttribute\s*\(/, name: '.removeAttribute()', severity: 'info', action: 'pass', errorCode: -32010, suggestion: 'Attribute removal without user interaction is suspicious.' },
  { pattern: /\.toggleAttribute\s*\(/, name: '.toggleAttribute()', severity: 'info', action: 'pass', errorCode: -32029, suggestion: 'Attribute toggling via CDP is detectable.' },
  { pattern: /\.dataset\.\w+\s*=/, name: '.dataset.* =', severity: 'info', action: 'pass', errorCode: -32030, suggestion: 'dataset mutations via evaluate bypass native mutation observers.' },

  // ── P6: Focus/Selection properties ────────────────────────
  { pattern: /\.selectionStart\s*=/, name: '.selectionStart =', severity: 'info', action: 'pass', errorCode: -32011, suggestion: 'Setting cursor position without focus is detectable.' },
  { pattern: /\.selectionEnd\s*=/, name: '.selectionEnd =', severity: 'info', action: 'pass', errorCode: -32011, suggestion: 'Selection range manipulation without user input is suspicious.' },
  { pattern: /\.selectionDirection\s*=/, name: '.selectionDirection =', severity: 'info', action: 'pass', errorCode: -32031, suggestion: 'Selection direction changes normally via mouse drag.' },

  // ── P7: Boolean properties ────────────────────────────────
  { pattern: /\.disabled\s*=/, name: '.disabled =', severity: 'info', action: 'pass', errorCode: -32012, suggestion: 'Disabling elements via CDP mid-interaction is detectable.' },
  { pattern: /\.readOnly\s*=/, name: '.readOnly =', severity: 'info', action: 'pass', errorCode: -32032, suggestion: 'readOnly changes without user action.' },
  { pattern: /\.hidden\s*=/, name: '.hidden =', severity: 'info', action: 'pass', errorCode: -32012, suggestion: 'Hiding elements is a common scraper tactic — detectable.' },
  { pattern: /\.required\s*=/, name: '.required =', severity: 'info', action: 'pass', errorCode: -32032, suggestion: 'Validation constraint changes mid-session.' },
  { pattern: /\.multiple\s*=/, name: '.multiple =', severity: 'info', action: 'pass', errorCode: -32032, suggestion: 'Multiple attribute toggle is rare in normal browsing.' },
  { pattern: /\.autofocus\s*=/, name: '.autofocus =', severity: 'info', action: 'pass', errorCode: -32032, suggestion: 'autofocus changes mid-session are suspicious.' },

  // ── P8: Frame/Navigation properties ───────────────────────
  { pattern: /\.src\s*=/, name: '.src = (on img/iframe/script)', severity: 'info', action: 'pass', errorCode: -32013, suggestion: 'Changing src via CDP bypasses user interaction. Use page.click() on the element.' },
  { pattern: /\.href\s*=/, name: '.href =', severity: 'info', action: 'pass', errorCode: -32033, suggestion: 'Changing anchor href via evaluate — use page.click() instead.' },
  { pattern: /\.action\s*=/, name: 'form.action =', severity: 'info', action: 'pass', errorCode: -32034, suggestion: 'Changing form action URL is highly suspicious.' },
  { pattern: /\.method\s*=/, name: 'form.method =', severity: 'info', action: 'pass', errorCode: -32034, suggestion: 'Form method changes without user interaction.' },
  { pattern: /\.target\s*=/, name: 'link/area.target =', severity: 'info', action: 'pass', errorCode: -32034, suggestion: 'Link target manipulation via CDP.' },

  // ── P9: Media properties ──────────────────────────────────
  { pattern: /\.currentTime\s*=/, name: 'media.currentTime = (seeking)', severity: 'info', action: 'pass', errorCode: -32014, suggestion: 'Video seeking without user interaction — common scraper pattern.' },
  { pattern: /\.playbackRate\s*=/, name: 'media.playbackRate =', severity: 'info', action: 'pass', errorCode: -32014, suggestion: 'Changing playback speed is detectable automation signal.' },
  { pattern: /\.volume\s*=/, name: 'media.volume =', severity: 'info', action: 'pass', errorCode: -32035, suggestion: 'Volume setting via evaluate is suspicious.' },
  { pattern: /\.muted\s*=/, name: 'media.muted =', severity: 'info', action: 'pass', errorCode: -32035, suggestion: 'Muting media without user click is suspicious.' },

  // ── P10: Element geometry ─────────────────────────────────
  { pattern: /\.scrollTop\s*=/, name: '.scrollTop =', severity: 'info', action: 'pass', errorCode: -32015, suggestion: 'Programmatic scroll without user gesture. Use page.mouse.wheel().' },
  { pattern: /\.scrollLeft\s*=/, name: '.scrollLeft =', severity: 'info', action: 'pass', errorCode: -32015, suggestion: 'Horizontal scroll without user gesture.' },
  { pattern: /\.scrollTo\s*\(/, name: '.scrollTo()', severity: 'info', action: 'pass', errorCode: -32015, suggestion: 'ScrollTo bypasses user scroll detection.' },
  { pattern: /\.scrollBy\s*\(/, name: '.scrollBy()', severity: 'info', action: 'pass', errorCode: -32015, suggestion: 'ScrollBy without user gesture.' },
  { pattern: /\.scrollIntoView\s*\(/, name: '.scrollIntoView()', severity: 'info', action: 'pass', errorCode: -32015, suggestion: 'scrollIntoView is a common bot pattern. Let Playwright handle scrolling.' },

  // ── P11: Shadow DOM ───────────────────────────────────────
  { pattern: /\.shadowRoot\s*=/, name: '.shadowRoot = (override)', severity: 'info', action: 'block', errorCode: -32036, suggestion: 'ShadowRoot is read-only — this set attempt is detectable.' },

  // ── P12: Force reflow / layout thrashing ──────────────────
  { pattern: /\.offsetHeight\b(?!\s*===?\s*)/, name: '.offsetHeight read (forced reflow)', severity: 'warn', action: 'pass', errorCode: -32016, suggestion: 'Reading offsetHeight triggers forced reflow — anti-crawlers detect this as layout probing.' },
  { pattern: /\.offsetWidth\b(?!\s*===?\s*)/, name: '.offsetWidth read (forced reflow)', severity: 'warn', action: 'pass', errorCode: -32016, suggestion: 'Reading offsetWidth triggers forced reflow — detectable.' },
  { pattern: /getBoundingClientRect\s*\(/, name: 'getBoundingClientRect()', severity: 'warn', action: 'pass', errorCode: -32037, suggestion: 'getBoundingClientRect triggers reflow. Minimize calls.' },
  { pattern: /getComputedStyle\s*\(/, name: 'getComputedStyle()', severity: 'info', action: 'pass', errorCode: -32038, suggestion: 'getComputedStyle can trigger style recalculation.' },
  { pattern: /\.clientHeight\b/, name: '.clientHeight read', severity: 'info', action: 'pass', errorCode: -32038, suggestion: 'clientHeight read triggers layout.' },
  { pattern: /\.clientWidth\b/, name: '.clientWidth read', severity: 'info', action: 'pass', errorCode: -32038, suggestion: 'clientWidth read triggers layout.' },
];

export const domMutationRule: CDPInterceptorRule = {
  id: 'dom-mutation',
  name: 'DOM Property Mutation Detection (50+ setters)',
  priority: 10,

  canHandle(ctx: RuleContext): boolean {
    return ctx.method === 'Runtime.evaluate' || ctx.method === 'Runtime.callFunctionOn';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    const userCode = extractUserCode(ctx);
    if (!userCode) return null;

    for (const p of DOM_PATTERNS) {
      if (p.pattern.test(userCode)) {
        return {
          ruleId: 'dom-mutation',
          action: p.action,
          severity: p.severity,
          reason: `Direct DOM property setter: "${p.name}". This bypasses framework event systems and is detectable as automation.`,
          suggestion: p.suggestion,
          errorCode: p.errorCode,
          errorMessage: p.severity === 'danger'
            ? `[CDP Firewall] ${p.name} blocked — bypasses framework reactivity`
            : `[CDP Firewall] ${p.name} detected — use proper interaction API`,
        };
      }
    }

    return null;
  },
};
