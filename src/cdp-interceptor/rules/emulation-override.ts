/**
 * Rule: CDP Emulation / Override Detection
 *
 * Detects calls to CDP methods that override browser behavior in ways that
 * can be detected by anti-crawler systems. Each override creates an
 * inconsistency between the JS environment and the real browser state.
 *
 * Examples:
 *   - Emulation.setUserAgentOverride → navigator.userAgent vs HTTP headers mismatch
 *   - Emulation.setDeviceMetricsOverride → matchMedia vs actual viewport mismatch
 *   - Emulation.setGeolocationOverride → geo suddenly changes mid-session
 *   - Network.setExtraHTTPHeaders → header conflicts with JS environment
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';

interface OverridePattern {
  method: string;
  paramKey?: string;
  paramValue?: RegExp;
  name: string;
  severity: 'danger' | 'warn' | 'info';
  errorCode: number;
  suggestion: string;
}

const OVERRIDE_PATTERNS: OverridePattern[] = [
  // ── Emulation overrides ──────────────────────────────
  // NOTE: Emulation.setDeviceMetricsOverride is NOT included here because
  // Playwright calls it internally for every new page (viewport setup).
  // Blocking it would break page creation.
  { method: 'Emulation.setUserAgentOverride', name: 'Emulation.setUserAgentOverride', severity: 'danger', errorCode: -32080, suggestion: 'navigator.userAgent override can be detected by checking consistency with navigator.plugins, WebGL vendor, etc.' },
  { method: 'Emulation.setTouchEmulationEnabled', name: 'Emulation.setTouchEmulationEnabled', severity: 'warn', errorCode: -32081, suggestion: 'Touch emulation creates inconsistent touch/mouse state. Windows touch events without real touch hardware.' },
  { method: 'Emulation.setGeolocationOverride', name: 'Emulation.setGeolocationOverride', severity: 'danger', errorCode: -32082, suggestion: 'Geolocation changing mid-session without user travel is impossible. Detectable via IP geo vs overridden geo.' },
  { method: 'Emulation.setLocaleOverride', name: 'Emulation.setLocaleOverride', severity: 'warn', errorCode: -32081, suggestion: 'Locale change without browser restart detectable via navigator.languages vs Accept-Language consistency.' },
  { method: 'Emulation.setTimezoneOverride', name: 'Emulation.setTimezoneOverride', severity: 'danger', errorCode: -32082, suggestion: 'Timezone mismatch vs IP geolocation + Date() is 100% detectable.' },
  { method: 'Emulation.setDisabledImageTypes', name: 'Emulation.setDisabledImageTypes', severity: 'info', errorCode: -32083, suggestion: 'Disabling image types prevents normal resource loading — visible to performance API.' },
  { method: 'Emulation.setScriptExecutionDisabled', name: 'Emulation.setScriptExecutionDisabled', severity: 'info', errorCode: -32083, suggestion: 'Disabling JS mid-session kills page interactivity — immediately obvious.' },
  { method: 'Emulation.setCPUThrottlingRate', name: 'Emulation.setCPUThrottlingRate', severity: 'info', errorCode: -32083, suggestion: 'CPU throttling creates unrealistic performance.now() profiles.' },
  { method: 'Emulation.setVirtualTimePolicy', name: 'Emulation.setVirtualTimePolicy', severity: 'info', errorCode: -32083, suggestion: 'Virtual time breaks Date.now() and performance.now() based detections — detectable via timer drift.' },

  // ── Network overrides ────────────────────────────────
  { method: 'Network.setUserAgentOverride', name: 'Network.setUserAgentOverride (HTTP layer)', severity: 'danger', errorCode: -32080, suggestion: 'HTTP User-Agent vs navigator.userAgent inconsistency = immediate detection.' },
  { method: 'Network.setExtraHTTPHeaders', name: 'Network.setExtraHTTPHeaders', severity: 'danger', errorCode: -32084, suggestion: 'Custom headers can conflict with browser-generated headers. Missing client hints (Sec-CH-UA) are also detectable.' },
  { method: 'Network.emulateNetworkConditions', name: 'Network.emulateNetworkConditions', severity: 'warn', errorCode: -32081, suggestion: 'Network throttling creates unrealistic load timing patterns.' },
  { method: 'Network.setCookie', name: 'Network.setCookie', severity: 'warn', errorCode: -32085, suggestion: 'CDP-injected cookies are detectable via document.cookie vs Network.getCookies inconsistency.' },
  { method: 'Network.deleteCookies', name: 'Network.deleteCookies', severity: 'warn', errorCode: -32085, suggestion: 'Cookie deletion via CDP bypasses HTTP cookie expiration — detectable.' },

  // ── Security overrides ──────────────────────────────
  { method: 'Security.setIgnoreCertificateErrors', name: 'Security.setIgnoreCertificateErrors', severity: 'info', errorCode: -32086, suggestion: 'Ignoring certificate errors creates unusual TLS behavior visible at network level.' },

  // ── Page overrides ──────────────────────────────────
  { method: 'Page.setDownloadBehavior', name: 'Page.setDownloadBehavior', severity: 'info', errorCode: -32087, suggestion: 'Bypassing download dialogs — detectable via download event flow.' },
  { method: 'Page.setWebLifecycleState', name: 'Page.setWebLifecycleState', severity: 'info', errorCode: -32087, suggestion: 'Forcing page lifecycle transitions is unnatural.' },

  // ── Storage / Permissions ───────────────────────────
  { method: 'Storage.clearDataForOrigin', name: 'Storage.clearDataForOrigin', severity: 'info', errorCode: -32089, suggestion: 'Clearing storage mid-session is unnatural for real users.' },
  { method: 'Browser.grantPermissions', name: 'Browser.grantPermissions', severity: 'warn', errorCode: -32090, suggestion: 'Granting permissions via CDP is detectable as the permission flow skips the user prompt.' },
  { method: 'Browser.resetPermissions', name: 'Browser.resetPermissions', severity: 'info', errorCode: -32089, suggestion: 'Permission resets without user action are unnatural.' },
];

export const emulationOverrideRule: CDPInterceptorRule = {
  id: 'emulation-override',
  name: 'CDP Emulation / Override Detection (20+ methods)',
  priority: 60,

  canHandle(ctx: RuleContext): boolean {
    // Check by method name only — no need to parse params
    for (const p of OVERRIDE_PATTERNS) {
      if (ctx.method === p.method) return true;
    }
    return false;
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    for (const p of OVERRIDE_PATTERNS) {
      if (ctx.method !== p.method) continue;

      return {
        ruleId: 'emulation-override',
        action: 'pass',
        severity: p.severity,
        reason: `CDP emulation/override detected: "${p.name}". This creates detectable inconsistencies between the JS environment and real browser state.`,
        suggestion: p.suggestion,
        errorCode: p.errorCode,
        errorMessage: `[CDP Firewall] ${p.name} blocked — creates detectable browser state inconsistency`,
      };
    }

    return null;
  },
};
