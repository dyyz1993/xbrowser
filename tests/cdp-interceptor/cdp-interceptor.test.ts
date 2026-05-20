import { describe, it, expect } from 'vitest';
import type { RuleContext, DecisionResult } from '../../src/cdp-interceptor/types.js';
import { extractUserCode } from '../../src/cdp-interceptor/rules/shared.js';
import { createRuleEngine } from '../../src/cdp-interceptor/rules-engine.js';
import { domMutationRule } from '../../src/cdp-interceptor/rules/dom-mutation.js';
import { automationSignalsRule } from '../../src/cdp-interceptor/rules/automation-signals.js';
import { fingerprintingRule } from '../../src/cdp-interceptor/rules/fingerprinting.js';
import { eventSimulationRule } from '../../src/cdp-interceptor/rules/event-simulation.js';
import { inputKeystrokeRule } from '../../src/cdp-interceptor/rules/input-keystroke.js';
import { emulationOverrideRule } from '../../src/cdp-interceptor/rules/emulation-override.js';
import { networkAnomalyRule } from '../../src/cdp-interceptor/rules/network-anomaly.js';
import { pageLifecycleRule } from '../../src/cdp-interceptor/rules/page-lifecycle.js';
import { formatBlockMessage, advise } from '../../src/cdp-interceptor/advisor.js';

function makeCtx(method: string, params: Record<string, unknown> = {}): RuleContext {
  return {
    method,
    params,
    sessionId: 'test-session',
    direction: 'client→browser',
    sessionState: new Map(),
  };
}

describe('extractUserCode (shared.ts)', () => {
  it('Runtime.evaluate with user expression returns the expression', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'document.querySelector("#name")' });
    expect(extractUserCode(ctx)).toBe('document.querySelector("#name")');
  });

  it('Runtime.evaluate with Playwright internal __commonJS returns null', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'var __commonJS = (e, t) => { const r = {}; __export(r, t); };',
    });
    expect(extractUserCode(ctx)).toBeNull();
  });

  it('Runtime.evaluate with Playwright internal module.exports returns null', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'module.exports = { foo: 1 };',
    });
    expect(extractUserCode(ctx)).toBeNull();
  });

  it('Runtime.callFunctionOn with utilityScript.evaluate extracts strings from args', () => {
    const ctx = makeCtx('Runtime.callFunctionOn', {
      functionDeclaration: 'function utilityScript.evaluate() { [native code] }',
      arguments: [
        { value: { objectId: '1' } },
        { value: 'document.querySelector("#search")' },
        { value: false },
        { value: 'el.value = "hello world"' },
      ],
    });
    const result = extractUserCode(ctx);
    expect(result).toContain('document.querySelector("#search")');
    expect(result).toContain('el.value = "hello world"');
  });

  it('Runtime.callFunctionOn without utilityScript returns functionDeclaration', () => {
    const ctx = makeCtx('Runtime.callFunctionOn', {
      functionDeclaration: '() => el.value = "test"',
      arguments: [],
    });
    expect(extractUserCode(ctx)).toBe('() => el.value = "test"');
  });

  it('non-matching method returns null', () => {
    const ctx = makeCtx('Page.navigate', { url: 'https://example.com' });
    expect(extractUserCode(ctx)).toBeNull();
  });
});

describe('Rule Engine (rules-engine.ts)', () => {
  it('createRuleEngine() without custom rules uses all 9 built-in rules', () => {
    const engine = createRuleEngine();
    engine.start();
    const dom = makeCtx('Runtime.evaluate', { expression: 'el.value = "test"' });
    const decision = engine.evaluate(dom);
    expect(decision).not.toBeNull();
    engine.stop();
  });

  it('rules are sorted by priority', () => {
    const engine = createRuleEngine();
    const dom = makeCtx('Runtime.evaluate', { expression: 'el.value = "x"' });
    const decision = engine.evaluate(dom);
    expect(decision?.ruleId).toBe('dom-mutation');
    expect(decision?.severity).toBe('danger');
  });

  it('canHandle returns false → rule is skipped', () => {
    const ctx = makeCtx('Page.navigate', { url: 'https://example.com' });
    expect(domMutationRule.canHandle?.(ctx)).toBe(false);
    expect(automationSignalsRule.canHandle?.(ctx)).toBe(false);
  });

  it('first blocking rule wins', () => {
    const engine = createRuleEngine();
    engine.start();
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'navigator.webdriver',
    });
    const decision = engine.evaluate(ctx);
    expect(decision).not.toBeNull();
    expect(decision?.action).toBe('block');
    engine.stop();
  });

  it('pass action does NOT stop evaluation (later rules can still match)', () => {
    const engine = createRuleEngine();
    engine.start();
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'el.innerHTML = "<b>hi</b>"',
    });
    const decision = engine.evaluate(ctx);
    expect(decision).toBeNull();
    engine.stop();
  });

  it('start() and stop() lifecycle clears state', () => {
    const engine = createRuleEngine();
    engine.start();
    engine.stop();
    engine.start();
    const ctx = makeCtx('Page.printToPDF', {});
    const decision = engine.evaluate(ctx);
    expect(decision).not.toBeNull();
    expect(decision?.ruleId).toBe('page-lifecycle');
    engine.stop();
  });
});

describe('dom-mutation rule', () => {
  it('.value = "hello" → blocked (danger)', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'el.value = "hello"' });
    const d = domMutationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
    expect(d?.ruleId).toBe('dom-mutation');
  });

  it('.checked = true → blocked (danger)', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'checkbox.checked = true' });
    const d = domMutationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('.selectedIndex = 2 → blocked (danger)', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'select.selectedIndex = 2' });
    const d = domMutationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('.innerHTML = → pass (info)', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'el.innerHTML = "<b>bold</b>"' });
    const d = domMutationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('pass');
    expect(d?.severity).toBe('info');
  });

  it('.style.setProperty() → pass (info)', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'el.style.setProperty("color", "red")',
    });
    const d = domMutationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('pass');
    expect(d?.severity).toBe('info');
  });

  it('.className = → pass (info)', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'el.className = "active"' });
    const d = domMutationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('pass');
    expect(d?.severity).toBe('info');
  });

  it('reading .value (no assignment) → not matched', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'const v = el.value' });
    const d = domMutationRule.evaluate(ctx);
    expect(d).toBeNull();
  });

  it('document.querySelector("#name").value → NOT matched (it is a read)', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'document.querySelector("#name").value',
    });
    const d = domMutationRule.evaluate(ctx);
    expect(d).toBeNull();
  });

  it('via Runtime.evaluate with Playwright internal __commonJS → NOT matched (filtered)', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'var __commonJS = {}; el.value = "hello";',
    });
    const d = domMutationRule.evaluate(ctx);
    expect(d).toBeNull();
  });
});

describe('automation-signals rule', () => {
  it('navigator.webdriver → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'navigator.webdriver',
    });
    const d = automationSignalsRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('window.__playwright__ → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'window.__playwright__',
    });
    const d = automationSignalsRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
  });

  it('chrome.runtime → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'chrome.runtime',
    });
    const d = automationSignalsRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
  });

  it('normal code like document.title → not matched', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'document.title',
    });
    const d = automationSignalsRule.evaluate(ctx);
    expect(d).toBeNull();
  });
});

describe('fingerprinting rule', () => {
  it('canvas.toDataURL() → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'canvas.toDataURL()',
    });
    const d = fingerprintingRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('gl.getParameter(gl.VENDOR) → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'gl.getParameter(gl.VENDOR)',
    });
    const d = fingerprintingRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
  });

  it('new AudioContext() → not matched (AudioContext constructor itself is not in patterns)', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'new AudioContext()',
    });
    const d = fingerprintingRule.evaluate(ctx);
    expect(d).toBeNull();
  });

  it('normal DOM access → not matched', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'document.querySelector("#app")',
    });
    const d = fingerprintingRule.evaluate(ctx);
    expect(d).toBeNull();
  });
});

describe('event-simulation rule', () => {
  it('el.click() → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'el.click()' });
    const d = eventSimulationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('el.dispatchEvent(new Event("click")) → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'el.dispatchEvent(new Event("click"))',
    });
    const d = eventSimulationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('el.focus() → blocked', () => {
    const ctx = makeCtx('Runtime.evaluate', { expression: 'el.focus()' });
    const d = eventSimulationRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('normal property access → not matched', () => {
    const ctx = makeCtx('Runtime.evaluate', {
      expression: 'const x = el.textContent',
    });
    const d = eventSimulationRule.evaluate(ctx);
    expect(d).toBeNull();
  });
});

describe('input-keystroke rule', () => {
  it('Input.insertText → pass (info, NOT block)', () => {
    const ctx = makeCtx('Input.insertText', { text: 'hello' });
    const d = inputKeystrokeRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('pass');
    expect(d?.severity).toBe('info');
    expect(d?.ruleId).toBe('input-keystroke');
  });

  it('Input.dispatchKeyEvent with normal timing → not matched (need 4+ samples)', () => {
    const state = new Map<string, unknown>();
    const ctx1: RuleContext = {
      method: 'Input.dispatchKeyEvent',
      params: { type: 'keyDown', code: 'KeyH', key: 'h' },
      sessionId: 'test',
      direction: 'client→browser',
      sessionState: state,
    };
    const d = inputKeystrokeRule.evaluate(ctx1);
    expect(d).toBeNull();
  });

  it('action is pass for Input.insertText', () => {
    const ctx = makeCtx('Input.insertText', { text: 'test text' });
    const d = inputKeystrokeRule.evaluate(ctx);
    expect(d?.action).toBe('pass');
  });
});

describe('emulation-override rule', () => {
  it('Emulation.setUserAgentOverride → blocked', () => {
    const ctx = makeCtx('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0' });
    expect(emulationOverrideRule.canHandle?.(ctx)).toBe(true);
    const d = emulationOverrideRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('Emulation.setGeolocationOverride → blocked', () => {
    const ctx = makeCtx('Emulation.setGeolocationOverride', {
      latitude: 40.7128,
      longitude: -74.006,
    });
    expect(emulationOverrideRule.canHandle?.(ctx)).toBe(true);
    const d = emulationOverrideRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
  });

  it('Emulation.setDeviceMetricsOverride → NOT blocked (excluded for Playwright viewport)', () => {
    const ctx = makeCtx('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
    });
    expect(emulationOverrideRule.canHandle?.(ctx)).toBe(false);
    const d = emulationOverrideRule.evaluate(ctx);
    expect(d).toBeNull();
  });

  it('Emulation.setFocusEmulationEnabled → NOT blocked (excluded)', () => {
    const ctx = makeCtx('Emulation.setFocusEmulationEnabled', { enabled: true });
    expect(emulationOverrideRule.canHandle?.(ctx)).toBe(false);
    const d = emulationOverrideRule.evaluate(ctx);
    expect(d).toBeNull();
  });
});

describe('network-anomaly rule', () => {
  it('Network.clearBrowserCache → blocked', () => {
    const ctx = makeCtx('Network.clearBrowserCache', {});
    expect(networkAnomalyRule.canHandle?.(ctx)).toBe(true);
    const d = networkAnomalyRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.ruleId).toBe('network-anomaly');
  });

  it('Network.setBlockedURLs → blocked', () => {
    const ctx = makeCtx('Network.setBlockedURLs', { patterns: ['*fonts*'] });
    expect(networkAnomalyRule.canHandle?.(ctx)).toBe(true);
    const d = networkAnomalyRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
  });
});

describe('page-lifecycle rule', () => {
  it('Page.printToPDF → blocked', () => {
    const ctx = makeCtx('Page.printToPDF', {});
    expect(pageLifecycleRule.canHandle?.(ctx)).toBe(true);
    const d = pageLifecycleRule.evaluate(ctx);
    expect(d).not.toBeNull();
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
    expect(d?.ruleId).toBe('page-lifecycle');
  });
});

describe('advisor (advisor.ts)', () => {
  it('formatBlockMessage with dom-mutation decision contains required fields', () => {
    const decision: DecisionResult = {
      ruleId: 'dom-mutation',
      action: 'block',
      severity: 'danger',
      reason: 'Direct DOM property setter: ".value =". This bypasses framework event systems.',
      suggestion: 'Use page.fill(selector, value).',
      errorCode: -32001,
      errorMessage: '[CDP Firewall] .value = blocked',
    };
    const msg = formatBlockMessage(decision, 'Runtime.evaluate');
    expect(msg).toContain('rule=dom-mutation');
    expect(msg).toContain('reason=');
    expect(msg).toContain('suggestion=');
    expect(msg).toContain('code-example=');
  });

  it('formatBlockMessage with input-keystroke + Input.insertText does NOT contain code-example', () => {
    const decision: DecisionResult = {
      ruleId: 'input-keystroke',
      action: 'pass',
      severity: 'info',
      reason: 'Input.insertText bypasses native keyboard events.',
      suggestion: 'Prefer page.type() with variable delay.',
      errorCode: -32004,
      errorMessage: '[CDP Firewall] Input.insertText detected',
    };
    const msg = formatBlockMessage(decision, 'Input.insertText');
    expect(msg).not.toContain('code-example=');
  });

  it('formatBlockMessage with input-keystroke + Input.dispatchKeyEvent contains code-example with randomized delay', () => {
    const decision: DecisionResult = {
      ruleId: 'input-keystroke',
      action: 'block',
      severity: 'danger',
      reason: 'All keystroke intervals are exactly 50ms.',
      suggestion: 'Add random variation to your typing delay.',
      errorCode: -32004,
      errorMessage: '[CDP Firewall] Constant keystroke timing detected',
    };
    const msg = formatBlockMessage(decision, 'Input.dispatchKeyEvent');
    expect(msg).toContain('code-example=');
    expect(msg).toContain('random');
  });

  it('advise returns correct structure', () => {
    const decision: DecisionResult = {
      ruleId: 'automation-signals',
      action: 'block',
      severity: 'danger',
      reason: 'Automation marker detected.',
      suggestion: 'Remove this pattern.',
      errorCode: -32040,
      errorMessage: '[CDP Firewall] blocked',
    };
    const result = advise(decision, 'Runtime.evaluate');
    expect(result).toHaveProperty('ruleId', 'automation-signals');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('detail');
    expect(result).toHaveProperty('codeExample');
    expect(typeof result.title).toBe('string');
    expect(typeof result.detail).toBe('string');
    expect(typeof result.codeExample).toBe('string');
  });
});
