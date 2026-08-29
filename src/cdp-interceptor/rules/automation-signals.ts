/**
 * Rule: Browser Automation Signals
 *
 * Detects telltale markers left in the page context by browser automation
 * tools (Playwright, Puppeteer, Selenium, WebDriver). These markers are
 * the #1 thing anti-crawler systems check for.
 *
 * Detection categories:
 *   1. Tool-specific global objects (window.__playwright, etc.)
 *   2. navigator.webdriver flag checks
 *   3. Chrome headless API surface detection
 *   4. Anti-detection script injection attempts (already too late)
 *
 * Both Runtime.evaluate and Page.addScriptToEvaluateOnNewDocument are checked.
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';
import { extractUserCode } from './shared.js';

const AUTOMATION_PATTERNS = [
  // ── Playwright markers ─────────────────────────
  { pattern: /window\s*\.\s*__playwright/, name: 'window.__playwright', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__pw_[a-zA-Z]/, name: 'window.__pw_*', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__pw_paused/, name: 'window.__pw_paused', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*playwright\b/, name: 'window.playwright', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__pw_recorder/, name: 'window.__pw_recorder', severity: 'warn' as const, errorCode: -32041 },
  { pattern: /window\s*\.\s*__pw_trace/, name: 'window.__pw_trace', severity: 'warn' as const, errorCode: -32041 },

  // ── Puppeteer markers ──────────────────────────
  { pattern: /window\s*\.\s*__puppeteer\b/, name: 'window.__puppeteer', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__puppeteer_evaluation_script/, name: 'window.__puppeteer_evaluation_script', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__puppeteer_testId/, name: 'window.__puppeteer_testId', severity: 'warn' as const, errorCode: -32041 },
  { pattern: /window\s*\.\s*__puppeteer_/, name: 'window.__puppeteer_*', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*_puppeteer\b/, name: 'window._puppeteer', severity: 'warn' as const, errorCode: -32041 },

  // ── Selenium / WebDriver markers ───────────────
  { pattern: /window\s*\.\s*__webdriver_script_fn/, name: 'window.__webdriver_script_fn', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__selenium\b/, name: 'window.__selenium', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__selenium_evaluate/, name: 'window.__selenium_evaluate', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__driver_evaluate/, name: 'window.__driver_evaluate', severity: 'warn' as const, errorCode: -32041 },
  { pattern: /window\s*\.\s*__webdriver_evaluate/, name: 'window.__webdriver_evaluate', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /document\.\$cdc_/, name: 'document.$cdc_* (Selenium marker)', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /document\.\$chrome_asyncScriptInfo/, name: 'document.$chrome_asyncScriptInfo', severity: 'danger' as const, errorCode: -32040 },

  // ── navigator.webdriver detection ─────────────
  { pattern: /navigator\s*\.\s*webdriver/, name: 'navigator.webdriver read', severity: 'danger' as const, errorCode: -32042 },
  { pattern: /navigator\[["']webdriver["']\]/, name: 'navigator["webdriver"]', severity: 'danger' as const, errorCode: -32042 },

  // ── Chrome headless API surface checks ────────
  { pattern: /chrome\s*\.\s*app/, name: 'chrome.app detection', severity: 'danger' as const, errorCode: -32043 },
  { pattern: /chrome\s*\.\s*runtime/, name: 'chrome.runtime detection', severity: 'danger' as const, errorCode: -32043 },
  { pattern: /chrome\s*\.\s*loadTimes/, name: 'chrome.loadTimes detection', severity: 'warn' as const, errorCode: -32044 },
  { pattern: /chrome\s*\.\s*csi\b/, name: 'chrome.csi detection', severity: 'warn' as const, errorCode: -32044 },
  { pattern: /window\s*\.\s*chrome\b/, name: 'window.chrome object probe', severity: 'warn' as const, errorCode: -32044 },
  { pattern: /navigator\s*\.\s*plugins\b/, name: 'navigator.plugins enumeration', severity: 'warn' as const, errorCode: -32044 },
  { pattern: /navigator\s*\.\s*mimeTypes/, name: 'navigator.mimeTypes enumeration', severity: 'warn' as const, errorCode: -32044 },
  { pattern: /navigator\s*\.\s*hardwareConcurrency/, name: 'navigator.hardwareConcurrency', severity: 'warn' as const, errorCode: -32044 },
  { pattern: /navigator\s*\.\s*deviceMemory/, name: 'navigator.deviceMemory', severity: 'info' as const, errorCode: -32045 },
  { pattern: /navigator\s*\.\s*maxTouchPoints/, name: 'navigator.maxTouchPoints', severity: 'warn' as const, errorCode: -32044 },
  { pattern: /navigator\s*\.\s*languages/, name: 'navigator.languages', severity: 'info' as const, errorCode: -32045 },
  { pattern: /navigator\s*\.\s*platform/, name: 'navigator.platform', severity: 'info' as const, errorCode: -32045 },

  // ── Anti-detection injection attempts ─────────
  { pattern: /navigator\.webdriver\s*=\s*(false|undefined|null)/, name: 'navigator.webdriver override attempt', severity: 'danger' as const, errorCode: -32046, suggestionOverride: 'Overriding navigator.webdriver is detectable. Use CDP Page.addScriptToEvaluateOnNewDocument instead.' },
  { pattern: /Object\.defineProperty\s*\([^)]*webdriver/, name: 'Object.defineProperty navigator.webdriver', severity: 'danger' as const, errorCode: -32046, suggestionOverride: 'Object.defineProperty patches are detectable via Function.prototype.toString checks.' },
  { pattern: /delete\s+navigator\s*\.\s*webdriver/, name: 'delete navigator.webdriver', severity: 'danger' as const, errorCode: -32046, suggestionOverride: 'Deleting webdriver flag is detectable — the delete itself is visible.' },

  // ── PhantomJS / Headless markers ──────────────
  { pattern: /window\s*\.\s*callPhantom/, name: 'window.callPhantom', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*_phantom/, name: 'window._phantom', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*phantom\b/, name: 'window.phantom', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*Buffer\b/, name: 'window.Buffer (Node.js leak)', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*process\b/, name: 'window.process (Node.js leak)', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*global\b/, name: 'window.global (Node.js leak)', severity: 'danger' as const, errorCode: -32040 },
  { pattern: /window\s*\.\s*__dirname/, name: 'window.__dirname (Node.js leak)', severity: 'danger' as const, errorCode: -32040 },
];

export const automationSignalsRule: CDPInterceptorRule = {
  id: 'automation-signals',
  name: 'Browser Automation Signal Detection (35+ markers)',
  priority: 20,

  canHandle(ctx: RuleContext): boolean {
    return ctx.method === 'Runtime.evaluate'
      || ctx.method === 'Runtime.callFunctionOn'
      || ctx.method === 'Page.addScriptToEvaluateOnNewDocument';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    // For Page.addScriptToEvaluateOnNewDocument: check source
    if (ctx.method === 'Page.addScriptToEvaluateOnNewDocument') {
      const source = ctx.params.source;
      if (typeof source === 'string') {
        for (const p of AUTOMATION_PATTERNS) {
          if (p.pattern.test(source)) {
            return makeDecision(p, source.substring(0, 60));
          }
        }
      }
      return null;
    }

    const userCode = extractUserCode(ctx);
    if (!userCode) return null;

    for (const p of AUTOMATION_PATTERNS) {
      if (p.pattern.test(userCode)) {
        return makeDecision(p, userCode.substring(0, 60));
      }
    }

    return null;
  },
};

function makeDecision(p: typeof AUTOMATION_PATTERNS[number], context: string): DecisionResult {
  const suggestion = p.suggestionOverride ?? `Detected: "${p.name}" — an automation tool marker that anti-crawler systems immediately flag. Remove this pattern from your code.`;

  return {
    ruleId: 'automation-signals',
    action: 'pass',
    severity: p.severity,
    reason: `Automation marker detected: "${p.name}". Context: "${context}..."`,
    suggestion,
    errorCode: p.errorCode,
    errorMessage: p.severity === 'danger'
      ? `[CDP Firewall] ${p.name} blocked — automation tool marker detected`
      : `[CDP Firewall] ${p.name} detected — potential automation signal`,
  };
}
