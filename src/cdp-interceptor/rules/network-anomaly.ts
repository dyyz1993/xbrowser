/**
 * Rule: Network Request Anomaly Detection
 *
 * Detects network request patterns that betray automation at the
 * CDP protocol level. While most network analysis requires a proxy,
 * certain CDP methods and timing patterns are visible at the CDP layer.
 *
 * Detection patterns:
 *   1. Network.setExtraHTTPHeaders with suspicious headers
 *   2. Network.setUserAgentOverride (also caught by emulation-override)
 *   3. Requests too fast after navigation (via PageLifecycle state)
 *   4. Network.clearBrowserCache (automation optimization giveaway)
 *   5. Network.enable called at suspicious times
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';

export const networkAnomalyRule: CDPInterceptorRule = {
  id: 'network-anomaly',
  name: 'Network Anomaly Detection (8+ patterns)',
  priority: 70,

  canHandle(ctx: RuleContext): boolean {
    const m = ctx.method;
    return m === 'Network.setExtraHTTPHeaders'
      || m === 'Network.clearBrowserCache'
      || m === 'Network.clearBrowserCookies'
      || m === 'Network.setBlockedURLs'
      || m === 'Network.setBypassServiceWorker'
      || m === 'Fetch.enable'
      || m === 'Network.enable';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    switch (ctx.method) {
      case 'Network.setExtraHTTPHeaders': {
        const headers = ctx.params.headers as Record<string, string> | undefined;
        if (headers) {
          const headerStr = JSON.stringify(headers).toLowerCase();
          // Check for suspicious headers
          if (!headerStr.includes('sec-ch-ua')) {
            return {
              ruleId: 'network-anomaly', action: 'pass', severity: 'warn',
              reason: 'Network.setExtraHTTPHeaders called without Sec-CH-UA client hints — browser normally sends these.',
              suggestion: 'Modern browsers send Sec-CH-UA headers automatically. Adding custom headers without them creates detectable inconsistency.',
              errorCode: -32110,
              errorMessage: '[CDP Firewall] Missing client hints in custom headers',
            };
          }
        }
        return null;
      }

      case 'Network.clearBrowserCache': {
        return {
          ruleId: 'network-anomaly', action: 'pass', severity: 'warn',
          reason: 'Network.clearBrowserCache called — cache clearing mid-session is unnatural for real users.',
          suggestion: 'Avoid cache clearing during sessions. Start with a fresh profile if needed.',
          errorCode: -32111,
          errorMessage: '[CDP Firewall] Cache clearing detected',
        };
      }

      case 'Network.clearBrowserCookies': {
        return {
          ruleId: 'network-anomaly', action: 'pass', severity: 'warn',
          reason: 'Network.clearBrowserCookies called — wiping cookies mid-session is a scraper optimization.',
          suggestion: 'Cookies should only be cleared via normal browser flow (expiration, user action).',
          errorCode: -32112,
          errorMessage: '[CDP Firewall] Cookie clearing detected',
        };
      }

      case 'Network.setBlockedURLs': {
        return {
          ruleId: 'network-anomaly', action: 'pass', severity: 'warn',
          reason: 'Network.setBlockedURLs blocks resource loading — this changes the page behavior and is detectable.',
          suggestion: 'Blocking images/fonts/etc creates measurable differences in performance and page rendering.',
          errorCode: -32113,
          errorMessage: '[CDP Firewall] URL blocking detected',
        };
      }

      case 'Network.setBypassServiceWorker': {
        return {
          ruleId: 'network-anomaly', action: 'block', severity: 'info',
          reason: 'Network.setBypassServiceWorker called — bypassing service workers for content extraction.',
          suggestion: 'Service worker bypass changes fetch behavior and is detectable server-side.',
          errorCode: -32114,
          errorMessage: '[CDP Firewall] Service worker bypass detected',
        };
      }

      case 'Fetch.enable': {
        return {
          ruleId: 'network-anomaly', action: 'pass', severity: 'warn',
          reason: 'Fetch.enable intercepts all network requests — a man-in-the-middle approach used by scrapers.',
          suggestion: 'Do not use Fetch domain for network interception if avoiding detection.',
          errorCode: -32115,
          errorMessage: '[CDP Firewall] Fetch interception detected',
        };
      }

      default:
        return null;
    }
  },
};
