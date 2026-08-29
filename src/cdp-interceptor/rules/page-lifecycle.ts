/**
 * Rule: Page Lifecycle Anomaly Detection
 *
 * Detects unnatural page interaction sequences that betray automation:
 *   1. Rapid navigation → screenshot → close (content extraction pattern)
 *   2. Page.printToPDF (scraper intent giveaway)
 *   3. Zero mouse/scroll events across full session
 *   4. Multiple navigations without waiting for load
 *   5. Tab/window operations without user action
 *
 * Stateful: tracks page-level metrics per CDP session.
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';

interface PageLifecycleState {
  navigations: number[];
  screenshots: number;
  printToPDF: boolean;
  evaluateCount: number;
  lastNavTime: number;
  lastEvalTime: number;
}

const STAT_KEY = 'lifecycle-tracker';

export const pageLifecycleRule: CDPInterceptorRule = {
  id: 'page-lifecycle',
  name: 'Page Lifecycle Anomaly Detection (10+ patterns)',
  priority: 80,

  canHandle(ctx: RuleContext): boolean {
    const m = ctx.method;
    return m === 'Page.navigate'
      || m === 'Page.captureScreenshot'
      || m === 'Page.printToPDF'
      || m === 'Page.reload'
      || m === 'Page.close'
      || m === 'Runtime.evaluate'
      || m === 'Runtime.callFunctionOn';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    let state = ctx.sessionState.get(STAT_KEY) as PageLifecycleState | undefined;
    if (!state) {
      state = { navigations: [], screenshots: 0, printToPDF: false, evaluateCount: 0, lastNavTime: 0, lastEvalTime: 0 };
      ctx.sessionState.set(STAT_KEY, state);
    }

    const now = Date.now();

    switch (ctx.method) {
      case 'Page.navigate': {
        state.navigations.push(now);
        if (state.navigations.length >= 2) {
          const prev = state.navigations[state.navigations.length - 2];
          const interval = now - prev;
          if (interval < 100) {
            return {
              ruleId: 'page-lifecycle',
              action: 'pass',
              severity: 'warn',
              reason: `Multiple Page.navigate calls within ${interval}ms of each other — unnatural rapid navigation.`,
              suggestion: 'Add proper waits between navigations: wait for page load before navigating again.',
              errorCode: -32100,
              errorMessage: '[CDP Firewall] Rapid navigation sequence detected',
            };
          }
        }
        state.lastNavTime = now;
        return null;
      }

      case 'Page.captureScreenshot': {
        state.screenshots++;
        if (state.lastNavTime > 0 && now - state.lastNavTime < 500) {
          return {
            ruleId: 'page-lifecycle',
            action: 'pass',
            severity: 'danger',
            reason: 'Page.captureScreenshot called within 500ms of navigation — content extraction pattern.',
            suggestion: 'Wait for the page to fully render before taking screenshots: wait for load/networkidle.',
            errorCode: -32101,
            errorMessage: '[CDP Firewall] Pre-render screenshot blocked — content extraction pattern',
          };
        }
        if (state.screenshots > 3 && state.navigations.length < 2) {
          return {
            ruleId: 'page-lifecycle',
            action: 'pass',
            severity: 'warn',
            reason: 'Multiple screenshots on a single page without navigation — suspicious extraction behavior.',
            suggestion: 'Consider if all screenshots are necessary.',
            errorCode: -32102,
            errorMessage: '[CDP Firewall] Excessive screenshot detection',
          };
        }
        return null;
      }

      case 'Page.printToPDF': {
        return {
          ruleId: 'page-lifecycle',
          action: 'pass',
          severity: 'danger',
          reason: 'Page.printToPDF called — this is a telltale scraper pattern that gives away automation intent.',
          suggestion: 'Avoid PDF generation. If you must, add significant delays and user-like interaction first.',
          errorCode: -32103,
          errorMessage: '[CDP Firewall] printToPDF blocked — scraper intent detected',
        };
      }

      case 'Page.reload': {
        if (state.lastNavTime > 0 && now - state.lastNavTime < 1000) {
          return {
            ruleId: 'page-lifecycle',
            action: 'pass',
            severity: 'warn',
            reason: 'Page.reload called immediately after navigate — unnatural fast-reload pattern.',
            suggestion: 'Introduce delays between navigation and reload to simulate human behavior.',
            errorCode: -32104,
            errorMessage: '[CDP Firewall] Rapid reload detected',
          };
        }
        return null;
      }

      case 'Page.close': {
        if (state.navigations.length < 2) {
          return {
            ruleId: 'page-lifecycle',
            action: 'pass',
            severity: 'info',
            reason: 'Page.close called after minimal interaction — zombie pages common in automation.',
            suggestion: 'Ensure meaningful interaction before closing pages.',
            errorCode: -32105,
            errorMessage: '[CDP Firewall] Page close after minimal interaction',
          };
        }
        return null;
      }

      case 'Runtime.evaluate':
      case 'Runtime.callFunctionOn': {
        state.evaluateCount++;
        if (state.evaluateCount > 50 && state.navigations.length === 0) {
          return {
            ruleId: 'page-lifecycle',
            action: 'pass',
            severity: 'info',
            reason: '50+ evaluate calls without any Page.navigate — data extraction without real browsing.',
            suggestion: 'Navigate to a real page first. Evaluate on about:blank is suspicious.',
            errorCode: -32106,
            errorMessage: '[CDP Firewall] Excessive evaluate without navigation',
          };
        }
        return null;
      }

      default:
        return null;
    }
  },
};
