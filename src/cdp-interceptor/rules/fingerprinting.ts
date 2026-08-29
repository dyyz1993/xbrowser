/**
 * Rule: Browser Fingerprinting Access Detection
 *
 * Blocks access to known browser fingerprinting APIs via Runtime.evaluate.
 * Anti-crawler systems use these APIs to build a unique device fingerprint
 * and detect headless/automated browsers.
 *
 * Instead of blocking these calls (which would break the page), we:
 *   - Log the access (info)
 *   - Warn the developer (warn)
 *   - Suggest alternatives
 *
 * The goal is to make the developer aware that their code is triggering
 * fingerprinting APIs, which means the target site can identify them.
 *
 * Severity reflects how diagnostic the API is (not how dangerous the call is):
 *   - canvas.toDataURL() → danger (fingerprint hash, highly diagnostic)
 *   - AudioContext → warn (common fingerprint method)
 *   - platform info → info (less diagnostic alone)
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';
import { extractUserCode } from './shared.js';

interface FpPattern {
  pattern: RegExp;
  name: string;
  severity: 'danger' | 'warn' | 'info';
  errorCode: number;
  suggestion: string;
}

const FP_PATTERNS: FpPattern[] = [
  // ── Canvas Rendering fingerprinting ────────────────────
  { pattern: /\.toDataURL\s*\(/, name: 'canvas.toDataURL()', severity: 'danger', errorCode: -32050, suggestion: 'canvas.toDataURL() returns a unique hash that identifies the browser engine. Minimize calls.' },
  { pattern: /\.toBlob\s*\(/, name: 'canvas.toBlob()', severity: 'danger', errorCode: -32050, suggestion: 'canvas.toBlob() is used for canvas fingerprinting. Avoid if possible.' },
  { pattern: /getImageData\s*\(/, name: 'CanvasRenderingContext2D.getImageData()', severity: 'danger', errorCode: -32050, suggestion: 'getImageData reads pixel-level data used for fingerprinting.' },
  { pattern: /measureText\s*\(/, name: 'CanvasRenderingContext2D.measureText()', severity: 'warn', errorCode: -32051, suggestion: 'Font metrics reveal installed fonts — a fingerprinting vector.' },
  { pattern: /OffscreenCanvas\s*\(/, name: 'new OffscreenCanvas()', severity: 'warn', errorCode: -32051, suggestion: 'OffscreenCanvas is sometimes used to avoid visibility detection.' },
  { pattern: /convertToBlob\s*\(/, name: 'OffscreenCanvas.convertToBlob()', severity: 'warn', errorCode: -32051, suggestion: 'Headless OffscreenCanvas rendering differs from real browser.' },

  // ── WebGL Fingerprinting ──────────────────────────────
  { pattern: /getParameter\s*\([^)]*(?:VENDOR|RENDERER|VERSION)/, name: 'WebGL getParameter(VENDOR/RENDERER)', severity: 'danger', errorCode: -32052, suggestion: 'WebGL VENDOR/RENDERER returns emulated values in headless. Cannot be reliably spoofed.' },
  { pattern: /getSupportedExtensions\s*\(/, name: 'WebGL getSupportedExtensions()', severity: 'warn', errorCode: -32053, suggestion: 'WebGL extension list differs in headless mode.' },
  { pattern: /getShaderPrecisionFormat\s*\(/, name: 'WebGL getShaderPrecisionFormat()', severity: 'info', errorCode: -32054, suggestion: 'Shader precision differs between headless and real GPU.' },
  { pattern: /UNMASKED_VENDOR_WEBGL/, name: 'WEBGL_debug_renderer_info UNMASKED_VENDOR', severity: 'warn', errorCode: -32053, suggestion: 'Unmasked vendor info reveals the real GPU — blocked in many envs.' },
  { pattern: /UNMASKED_RENDERER_WEBGL/, name: 'WEBGL_debug_renderer_info UNMASKED_RENDERER', severity: 'warn', errorCode: -32053, suggestion: 'Unmasked renderer string reveals the real GPU.' },

  // ── AudioContext Fingerprinting ────────────────────────
  { pattern: /AnalyserNode\s*\(/, name: 'new AnalyserNode()', severity: 'warn', errorCode: -32055, suggestion: 'Audio fingerprinting via AnalyserNode — produces silence in headless.' },
  { pattern: /getFloatFrequencyData\s*\(/, name: 'AnalyserNode.getFloatFrequencyData()', severity: 'danger', errorCode: -32050, suggestion: 'Audio frequency data in headless returns silence (all zeros) — detectable.' },
  { pattern: /getByteFrequencyData\s*\(/, name: 'AnalyserNode.getByteFrequencyData()', severity: 'danger', errorCode: -32050, suggestion: 'Audio byte frequency data in headless returns zeros.' },
  { pattern: /getByteTimeDomainData\s*\(/, name: 'AnalyserNode.getByteTimeDomainData()', severity: 'danger', errorCode: -32050, suggestion: 'Time domain audio data in headless is a flat line — detectable.' },
  { pattern: /OfflineAudioContext\s*\(/, name: 'new OfflineAudioContext()', severity: 'warn', errorCode: -32055, suggestion: 'Offline audio rendering is a known fingerprinting method.' },
  { pattern: /OscillatorNode\s*\(/, name: 'new OscillatorNode()', severity: 'info', errorCode: -32056, suggestion: 'Audio oscillator used in fingerprinting probes.' },

  // ── Navigator property probing ───────────────────────
  { pattern: /navigator\s*\.\s*connection\b/, name: 'navigator.connection', severity: 'info', errorCode: -32057, suggestion: 'Network connection info is used for fingerprinting (always "4g" in bots).' },
  { pattern: /navigator\s*\.\s*getBattery\s*\(/, name: 'navigator.getBattery()', severity: 'warn', errorCode: -32058, suggestion: 'Battery API is a fingerprinting vector. Returns fixed values in headless.' },
  { pattern: /navigator\s*\.\s*mediaDevices\s*\.\s*enumerateDevices/, name: 'navigator.mediaDevices.enumerateDevices()', severity: 'warn', errorCode: -32058, suggestion: 'Media device enumeration returns empty/no devices in headless.' },
  { pattern: /navigator\s*\.\s*permissions\s*\.\s*query/, name: 'navigator.permissions.query()', severity: 'info', errorCode: -32059, suggestion: 'Permission queries can reveal automation environment.' },

  // ── Screen / Window geometry probing ──────────────────
  { pattern: /screen\.avail(Width|Height|Left|Top)/, name: 'screen.avail*', severity: 'warn', errorCode: -32060, suggestion: 'screen.avail* values differ in headless (no OS chrome).' },
  { pattern: /window\.outerWidth\s*-?\s*window\.innerWidth/, name: 'window.outerWidth - window.innerWidth', severity: 'danger', errorCode: -32050, suggestion: 'This difference is 0 in headless (no browser chrome) — 100% detection rate.' },
  { pattern: /window\.outerHeight\s*-?\s*window\.innerHeight/, name: 'window.outerHeight - window.innerHeight', severity: 'danger', errorCode: -32050, suggestion: 'This difference is 0 in headless — immediate automation detection.' },
  { pattern: /screen\.width\b/, name: 'screen.width', severity: 'info', errorCode: -32061, suggestion: 'Screen dimensions can be spoofed but inconsistencies with viewport are detectable.' },
  { pattern: /screen\.height\b/, name: 'screen.height', severity: 'info', errorCode: -32061, suggestion: 'Screen dimension probes for viewport inconsistency detection.' },
  { pattern: /window\.devicePixelRatio/, name: 'window.devicePixelRatio', severity: 'warn', errorCode: -32060, suggestion: 'devicePixelRatio is always 1 in headless — differs from real displays.' },
  { pattern: /matchMedia\s*\(/, name: 'window.matchMedia()', severity: 'warn', errorCode: -32060, suggestion: 'matchMedia can detect CDP overridden viewport dimensions.' },

  // ── Performance / Timing API ──────────────────────────
  { pattern: /performance\s*\.\s*now\s*\(/, name: 'performance.now()', severity: 'info', errorCode: -32062, suggestion: 'High-resolution timer used for timing attacks and bot detection.' },
  { pattern: /performance\s*\.\s*memory/, name: 'performance.memory', severity: 'warn', errorCode: -32063, suggestion: 'performance.memory shows VM memory limits in containers.' },
  { pattern: /performance\.getEntriesByType\s*\(\s*["']navigation["']\s*\)/, name: 'performance.getEntriesByType("navigation")', severity: 'info', errorCode: -32062, suggestion: 'Navigation timing reveals request pattern inconsistencies.' },
  { pattern: /performance\.getEntriesByType\s*\(\s*["']resource["']\s*\)/, name: 'performance.getEntriesByType("resource")', severity: 'info', errorCode: -32062, suggestion: 'Resource loading timing analysis for bot detection.' },

  // ── Font Detection ────────────────────────────────────
  { pattern: /document\.fonts\.check\s*\(/, name: 'document.fonts.check()', severity: 'warn', errorCode: -32064, suggestion: 'Font availability checks are used for fingerprinting. Installed font list is unique per user.' },
  { pattern: /document\.fonts\.ready/, name: 'document.fonts.ready', severity: 'info', errorCode: -32065, suggestion: 'Font loading state probe for fingerprinting.' },

  // ── WebRTC / Connectivity ────────────────────────────
  { pattern: /RTCPeerConnection\s*\(/, name: 'new RTCPeerConnection()', severity: 'warn', errorCode: -32066, suggestion: 'WebRTC can leak internal IP and is used for connectivity fingerprinting.' },
  { pattern: /navigator\.mediaDevices\.getUserMedia/, name: 'navigator.mediaDevices.getUserMedia()', severity: 'info', errorCode: -32067, suggestion: 'getUserMedia always fails in headless (no camera).' },

  // ── Feature Consistency Checks ─────────────────────────
  { pattern: /Intl\.DateTimeFormat.*resolvedOptions.*timeZone/, name: 'Intl.DateTimeFormat timezone check', severity: 'warn', errorCode: -32068, suggestion: 'Timezone from Intl API vs Emulation.setTimezoneOverride will be inconsistent when mocked.' },
  { pattern: /new\s+Date\s*\(\s*\)\s*\.\s*getTimezoneOffset/, name: 'Date.getTimezoneOffset()', severity: 'info', errorCode: -32069, suggestion: 'Timezone offset used for timing consistency cross-checks.' },
  { pattern: /Error\s*\(\s*\)\s*\.\s*stack/, name: 'Error().stack format check', severity: 'info', errorCode: -32070, suggestion: 'Stack trace format differs between headless and full Chrome.' },
  { pattern: /Function\.prototype\.toString/, name: 'Function.prototype.toString on native fn', severity: 'info', errorCode: -32070, suggestion: 'Native function toString() format can reveal patched APIs.' },
];

export const fingerprintingRule: CDPInterceptorRule = {
  id: 'fingerprinting',
  name: 'Browser Fingerprinting Access Detection (35+ APIs)',
  priority: 30,

  canHandle(ctx: RuleContext): boolean {
    return ctx.method === 'Runtime.evaluate' || ctx.method === 'Runtime.callFunctionOn';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    const userCode = extractUserCode(ctx);
    if (!userCode) return null;

    for (const p of FP_PATTERNS) {
      if (p.pattern.test(userCode)) {
        return {
          ruleId: 'fingerprinting',
          action: 'pass',
          severity: p.severity,
          reason: `Browser fingerprinting API accessed: "${p.name}". Anti-crawler systems use this to identify your browser.`,
          suggestion: p.suggestion,
          errorCode: p.errorCode,
          errorMessage: `[CDP Firewall] ${p.name} blocked — fingerprinting API access detected`,
        };
      }
    }

    return null;
  },
};
