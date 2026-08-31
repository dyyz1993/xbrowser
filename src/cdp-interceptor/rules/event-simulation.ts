/**
 * Rule: Event Simulation Detection
 *
 * Detects CDP calls that simulate user interaction events via
 * evaluate/callFunctionOn, bypassing the browser's trusted event system.
 *
 * Key distinction:
 *   - Input.dispatchMouseEvent / Input.dispatchKeyEvent → isTrusted=true ✓
 *   - element.click() / element.dispatchEvent(new Event(...)) → isTrusted=false ✗
 *
 * Any event with isTrusted=false is immediately detectable by anti-crawler
 * systems that check the event's isTrusted property.
 *
 * This rule covers:
 *   1. Direct method calls (el.click(), el.focus(), el.submit(), etc.)
 *   2. dispatchEvent with synthetic event objects
 *   3. Dialog/modal/fullscreen programmatic triggers
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';
import { extractUserCode, isProbeMarked } from './shared.js';

interface EventPattern {
  pattern: RegExp;
  name: string;
  severity: 'danger' | 'warn' | 'info';
  errorCode: number;
  suggestion: string;
}

const EVENT_PATTERNS: EventPattern[] = [
  // ── Direct method calls (all isTrusted=false) ─────────
  { pattern: /\.click\s*\(\s*\)/, name: 'el.click()', severity: 'danger', errorCode: -32070, suggestion: 'el.click() fires isTrusted=false events. Use page.click(selector) which uses Input.dispatchMouseEvent (isTrusted=true).' },
  { pattern: /\.focus\s*\(\s*\)/, name: 'el.focus()', severity: 'warn', errorCode: -32071, suggestion: 'el.focus() without user interaction is detectable. Use page.click(selector) which naturally focuses.' },
  { pattern: /\.blur\s*\(\s*\)/, name: 'el.blur()', severity: 'danger', errorCode: -32071, suggestion: 'el.blur() without user interaction. Avoid in automation scripts.' },
  { pattern: /\.submit\s*\(\s*\)/, name: 'el.submit()', severity: 'danger', errorCode: -32072, suggestion: 'form.submit() bypasses onSubmit handlers. Click the submit button: page.click(\'button[type="submit"]\').' },
  { pattern: /\.reset\s*\(\s*\)/, name: 'el.reset()', severity: 'danger', errorCode: -32072, suggestion: 'form.reset() without user action. Let the user clear fields manually.' },
  { pattern: /\.select\s*\(\s*\)/, name: 'el.select()', severity: 'warn', errorCode: -32073, suggestion: 'input.select() selects text without user interaction. Use page.click(selector) instead.' },
  { pattern: /dialog\.close\s*\(\s*\)|showModal\(\)/, name: 'dialog.showModal()/close()', severity: 'danger', errorCode: -32074, suggestion: 'dialog.showModal() requires user gesture. Let the user open the dialog naturally.' },
  { pattern: /\.showPopover\s*\(\s*\)/, name: 'el.showPopover()', severity: 'warn', errorCode: -32073, suggestion: 'Popover.show() requires user gesture. Simulate a click on the popover trigger.' },
  { pattern: /\.hidePopover\s*\(\s*\)/, name: 'el.hidePopover()', severity: 'warn', errorCode: -32073, suggestion: 'Hiding popovers via CDP is detectable.' },
  { pattern: /\.requestFullscreen\s*\(\s*\)/, name: 'el.requestFullscreen()', severity: 'danger', errorCode: -32074, suggestion: 'Fullscreen requests require user gesture. Cannot be triggered by automation.' },
  { pattern: /\.requestPointerLock\s*\(\s*\)/, name: 'el.requestPointerLock()', severity: 'danger', errorCode: -32074, suggestion: 'Pointer lock requires user gesture. Blocked in automation.' },
  { pattern: /\.setSelectionRange\s*\(/, name: 'el.setSelectionRange()', severity: 'warn', errorCode: -32073, suggestion: 'Setting selection range without user interaction is suspicious.' },
  { pattern: /\.setRangeText\s*\(/, name: 'el.setRangeText()', severity: 'info', errorCode: -32076, suggestion: 'Range text replacement without user input is detectable.' },
  { pattern: /\.showPicker\s*\(\s*\)/, name: 'HTMLInputElement.showPicker()', severity: 'info', errorCode: -32076, suggestion: 'Date/color picker shown without click — detectable.' },
  { pattern: /\.reportValidity\s*\(\s*\)/, name: 'el.reportValidity()', severity: 'info', errorCode: -32076, suggestion: 'Validity reporting without form submission attempt.' },

  // ── dispatchEvent with synthetic events (isTrusted=false) ──
  { pattern: /dispatchEvent\s*\(\s*new\s+(?:Event|CustomEvent)\s*\(/, name: 'dispatchEvent(new Event/CustomEvent)', severity: 'warn', errorCode: -32077, suggestion: 'Synthetic events have isTrusted=false. Use Input.dispatch* CDP methods for trusted events.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+MouseEvent\s*\(/, name: 'dispatchEvent(new MouseEvent)', severity: 'danger', errorCode: -32077, suggestion: 'Synthetic mouse events (isTrusted=false). Use Input.dispatchMouseEvent CDP method.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+KeyboardEvent\s*\(/, name: 'dispatchEvent(new KeyboardEvent)', severity: 'danger', errorCode: -32077, suggestion: 'Synthetic keyboard events (isTrusted=false). Use Input.dispatchKeyEvent CDP method.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+FocusEvent\s*\(/, name: 'dispatchEvent(new FocusEvent)', severity: 'warn', errorCode: -32078, suggestion: 'Synthetic focus events bypass user interaction.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+InputEvent\s*\(/, name: 'dispatchEvent(new InputEvent)', severity: 'danger', errorCode: -32077, suggestion: 'Synthetic input events (isTrusted=false). Use page.fill() or page.type().' },
  { pattern: /dispatchEvent\s*\(\s*new\s+(?:Event)\s*\(\s*["'](?:input|change|submit|reset)/, name: 'dispatchEvent("input"/"change"/"submit")', severity: 'danger', errorCode: -32077, suggestion: 'Synthetic input/change/submit events are trusted=false. Always detectable.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+PointerEvent\s*\(/, name: 'dispatchEvent(new PointerEvent)', severity: 'danger', errorCode: -32077, suggestion: 'Synthetic pointer events bypass the trusted input pipeline.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+TouchEvent\s*\(/, name: 'dispatchEvent(new TouchEvent)', severity: 'danger', errorCode: -32077, suggestion: 'Synthetic touch events on mobile are detectable.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+WheelEvent\s*\(/, name: 'dispatchEvent(new WheelEvent)', severity: 'warn', errorCode: -32078, suggestion: 'Synthetic scroll events (isTrusted=false). Use Input.dispatchMouseEvent with wheel type.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+ClipboardEvent\s*\(/, name: 'dispatchEvent(new ClipboardEvent)', severity: 'warn', errorCode: -32078, suggestion: 'Synthetic clipboard events are detectable.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+DragEvent\s*\(/, name: 'dispatchEvent(new DragEvent)', severity: 'warn', errorCode: -32078, suggestion: 'Synthetic drag events bypass real user interaction.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+CompositionEvent\s*\(/, name: 'dispatchEvent(new CompositionEvent)', severity: 'info', errorCode: -32079, suggestion: 'Synthetic IME composition events — detectable pattern.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+AnimationEvent\s*\(/, name: 'dispatchEvent(new AnimationEvent)', severity: 'info', errorCode: -32079, suggestion: 'Forcing animation state transitions via fake events.' },
  { pattern: /dispatchEvent\s*\(\s*new\s+TransitionEvent\s*\(/, name: 'dispatchEvent(new TransitionEvent)', severity: 'info', errorCode: -32079, suggestion: 'Forcing CSS transition end via fake events.' },
];

export const eventSimulationRule: CDPInterceptorRule = {
  id: 'event-simulation',
  name: 'Event Simulation Detection (30+ patterns)',
  priority: 40,

  canHandle(ctx: RuleContext): boolean {
    return ctx.method === 'Runtime.evaluate' || ctx.method === 'Runtime.callFunctionOn';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    const userCode = extractUserCode(ctx);
    if (!userCode) return null;

    // S190: 探针标记跳过——stealth-probe 等测试流量需验证伪装行为本身，
    // 字面量拦截会误伤观测/测试基建（生产流量不受影响，标记不显式声明）。
    if (isProbeMarked(userCode)) return null;

    for (const p of EVENT_PATTERNS) {
      if (p.pattern.test(userCode)) {
        return {
          ruleId: 'event-simulation',
          // danger 级硬拦（el.click 等 100% 暴露的模式）；
          // warning 级放行+提示（dispatchEvent 在部分合法场景如 DataTransfer paste 使用）
          action: p.severity === 'danger' ? 'block' : 'pass',
          severity: p.severity,
          reason: `Event simulation detected: "${p.name}". Synthetic events have isTrusted=false and are 100% detectable.`,
          suggestion: p.suggestion,
          errorCode: p.errorCode,
          errorMessage: p.severity === 'danger'
            ? `[CDP Firewall] ${p.name} blocked — synthetic event (isTrusted=false)`
            : `[CDP Firewall] ${p.name} detected — event simulation`,
        };
      }
    }

    return null;
  },
};
