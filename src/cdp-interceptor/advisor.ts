/**
 * CDP Interceptor — Advisor
 *
 * Generates actionable suggestions when rules flag a message.
 * Designed to be LLM-friendly: any AI agent reading the error
 * should know exactly what to do instead.
 */

import type { DecisionResult } from './types.js';

export interface AdvisoryResult {
  ruleId: string;
  title: string;
  detail: string;
  codeExample?: string;
}

/**
 * Format a blocked CDP call into a structured, LLM-readable error message.
 * The LLM should be able to self-correct based on this output.
 */
export function formatBlockMessage(decision: DecisionResult, method: string): string {
  const adv = advise(decision, method);

  const lines: string[] = [
    `[CDP-FIREWALL-BLOCK] rule=${decision.ruleId}`,
    `method=${method}`,
    `reason=${decision.reason}`,
    `suggestion=${decision.suggestion ?? adv.detail}`,
  ];

  if (adv.codeExample) {
    lines.push(`code-example=`);
    lines.push(adv.codeExample);
  }

  return lines.join('\n');
}

/**
 * Generate an advisory message from a rule decision.
 */
export function advise(decision: DecisionResult, originalMethod: string): AdvisoryResult {
  const baseAdvice = getBaseAdvice(decision, originalMethod);
  return {
    ruleId: decision.ruleId,
    title: baseAdvice.title,
    detail: decision.suggestion ?? baseAdvice.detail,
    codeExample: baseAdvice.codeExample,
  };
}

function getBaseAdvice(decision: DecisionResult, method: string): { title: string; detail: string; codeExample?: string } {
  switch (decision.ruleId) {
    case 'dom-mutation':
      return {
        title: 'Direct DOM property mutation blocked',
        detail: `Your ${method} call tried to set a DOM property directly. In React/Vue/Angular, this bypasses the framework's virtual DOM completely meaning onChange/onInput never fires. The website CAN detect this mismatch as automation.`,
        codeExample: [
          '# ❌ BLOCKED — what you tried to do:',
          `page.evaluate(\`el.value = 'hello'\`)  # triggers isTrusted=false`,
          '',
          '# ✅ USE INSTEAD — proper CDP input dispatch:',
          "page.fill('#selector', 'hello')           # Playwright: dispatches input+change events",
          "page.type('#selector', 'hello', {delay})  # Playwright: real keystrokes",
          "page.locator('#selector').fill('hello')   # Playwright: recommended API",
        ].join('\n'),
      };

    case 'mouse-trajectory':
      return {
        title: 'Unnatural mouse trajectory blocked',
        detail: `Your ${method} sequence formed a perfectly linear path. Human hands have micro-tremors (1-3px variation at any point along the arc), acceleration curves, and never draw straight lines between distant points.`,
        codeExample: [
          '# ❌ BLOCKED — linear interpolation:',
          'for i in range(20):',
          '    page.mouse.move(x0 + (x1-x0)*(i/20), y0 + (y1-y0)*(i/20))',
          '',
          '# ✅ USE INSTEAD — Bezier curves with overshoot:',
          '# Use "ghost-cursor" or similar library',
          'from ghost_cursor import path_to',
          'path_to(page, (x1, y1))',
        ].join('\n'),
      };

    case 'input-keystroke':
      return {
        title: 'Unnatural keystroke timing blocked',
        detail: `Your ${method} calls have unnaturally constant timing (exact 50ms intervals) or used Input.insertText which bypasses all keyboard events.`,
        codeExample: [
          '# ❌ BLOCKED — exact constant delay:',
          "page.type('#input', 'hello', {delay: 50})  # every keystroke exactly 50ms apart",
          '',
          '# ✅ USE INSTEAD — variable delay (human-like):',
          "page.fill('#input', 'hello')               # fastest, dispatches events properly",
          '# OR: type with randomized delay',
          "page.type('#input', 'hello', {delay: r.randint(30, 120)})",
        ].join('\n'),
      };

    case 'automation-signals':
      return {
        title: 'Browser automation marker detected',
        detail: `Your ${method} call accessed a property/marker that anti-crawler systems check to detect automation. These markers (navigator.webdriver, window.__playwright, etc.) are the #1 detection vector.`,
        codeExample: [
          '# ❌ BLOCKED — don\'t check for automation markers:',
          'navigator.webdriver      # NEVER check this',
          'window.__playwright      # NEVER check this',
          'chrome.runtime           # NEVER check this',
          '',
          '# ✅ Just go about your business normally.',
          '# Anti-detection is handled by the CDP firewall automatically.',
        ].join('\n'),
      };

    case 'fingerprinting':
      return {
        title: 'Browser fingerprinting API access blocked',
        detail: `Your ${method} call accessed a known fingerprinting API. These APIs (canvas.toDataURL, WebGL getParameter, AudioContext, etc.) are used by anti-crawler systems to build a unique device fingerprint.`,
        codeExample: [
          '# ❌ BLOCKED — fingerprinting vector:',
          'canvas.toDataURL()                        # returns unique browser hash',
          'gl.getParameter(gl.VENDOR)                # returns "SwiftShader" in headless',
          'screen.availWidth - screen.availHeight    # no OS chrome in headless',
          '',
          '# ✅ Avoid accessing these APIs. They are only used for fingerprinting.',
        ].join('\n'),
      };

    case 'event-simulation':
      return {
        title: 'Synthetic event simulation blocked',
        detail: `Your ${method} call simulated user interaction via el.click() or dispatchEvent(new Event(...)). These produce isTrusted=false events, which are 100% detectable by any anti-crawler that checks isTrusted on critical events.`,
        codeExample: [
          '# ❌ BLOCKED — synthetic events (isTrusted=false):',
          'el.click()                                 # isTrusted=false',
          'el.dispatchEvent(new Event("click"))       # isTrusted=false',
          'el.focus()                                 # isTrusted=false',
          '',
          '# ✅ USE INSTEAD — CDP-level input dispatch (isTrusted=true):',
          'page.click(selector)                       # uses Input.dispatchMouseEvent',
          'page.fill(selector, value)                 # dispatches real input events',
        ].join('\n'),
      };

    case 'emulation-override':
      return {
        title: 'CDP emulation override blocked',
        detail: `Your ${method} call overrides browser behavior in a way that creates detectable inconsistencies. Anti-crawler systems cross-check multiple sources (e.g., navigator.userAgent vs HTTP User-Agent header) to catch these mismatches.`,
        codeExample: [
          '# ❌ BLOCKED — detectable emulation override:',
          'Emulation.setUserAgentOverride(...)        # JS vs HTTP header mismatch',
          'Emulation.setGeolocationOverride(...)       # IP geo vs overridden geo mismatch',
          'Emulation.setDeviceMetricsOverride(...)     # matchMedia vs actual viewport',
          '',
          '# ✅ These are handled automatically by the CDP firewall.',
          '# Do NOT call them manually.',
        ].join('\n'),
      };

    case 'network-anomaly':
      return {
        title: 'Network anomaly detected',
        detail: `Your ${method} call triggered a network pattern that is characteristic of scrapers: blocking URLs, clearing caches, or intercepting requests.`,
        codeExample: [
          '# ❌ BLOCKED — scraper optimization:',
          'Network.clearBrowserCache()                # natural users never do this',
          'Network.setBlockedURLs(["*fonts*"])        # blocking resources is detectable',
          'Fetch.enable()                             # MITM-style interception',
          '',
          '# ✅ Let the browser manage its own cache and network normally.',
        ].join('\n'),
      };

    case 'page-lifecycle':
      return {
        title: 'Suspicious page lifecycle pattern blocked',
        detail: `Your ${method} call reveals an unnatural page interaction sequence: navigating too fast, taking screenshots before the page renders, or generating PDFs (a telltale scraper giveaway).`,
        codeExample: [
          '# ❌ BLOCKED — unnatural lifecycle:',
          'page.goto(url); page.pdf()                 # PDF = scraper giveaway',
          'page.goto(url); page.screenshot() <500ms   # screenshot before render',
          'page.goto(url) 3x in <100ms               # rapid navigation barrage',
          '',
          '# ✅ Add proper waits between actions:',
          'page.goto(url, {waitUntil: "networkidle"})',
          'page.waitForSelector("body")',
          'page.screenshot()                          # after rendering',
        ].join('\n'),
      };

    default:
      return {
        title: decision.reason,
        detail: decision.suggestion ?? `The CDP call "${method}" was blocked by rule "${decision.ruleId}".`,
      };
  }
}

