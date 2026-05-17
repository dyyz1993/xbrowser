/**
 * Rule: Input Keystroke Timing Analysis
 *
 * Analyzes `Input.dispatchKeyEvent` sequences for patterns that betray
 * automation:
 *
 * 1. **Constant inter-key timing**: natural typing has 30-200ms variation;
 *    automation tools like `page.type(..., {delay: 50})` produce exact 50ms
 *    intervals with zero variance.
 *
 * 2. **Input.insertText**: bypasses native keyboard events entirely.
 *    Real users always dispatch keyDown → keyPress → input → keyUp.
 *    `Input.insertText` skips all of these and is a strong automation signal.
 *
 * 3. **Unnatural key order**: typing characters one-by-one without variation
 *    in hold time (keyDown → keyUp interval).
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';

interface KeySample {
  code: string;
  key: string;
  timestamp: number;
  type: string;
}

interface KeystrokeTracker {
  samples: KeySample[];
}

const TRACKER_KEY = 'keystroke-tracker';
const MIN_KEYS_FOR_ANALYSIS = 4;

export const inputKeystrokeRule: CDPInterceptorRule = {
  id: 'input-keystroke',
  name: 'Input Keystroke Timing Analysis',
  priority: 40,

  canHandle(ctx: RuleContext): boolean {
    return ctx.method === 'Input.dispatchKeyEvent' || ctx.method === 'Input.insertText';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    // ── Input.insertText: direct text injection without key events ──
    if (ctx.method === 'Input.insertText') {
      return {
        ruleId: 'input-keystroke',
        action: 'pass',
        severity: 'info',
        reason: 'Input.insertText bypasses native keyboard events. Playwright uses this internally for page.fill().',
        suggestion: 'Prefer page.type() with variable delay for human-like input.',
        errorCode: -32004,
        errorMessage: '[CDP Firewall] Input.insertText detected — note: Playwright uses this for fill()',
      };
    }

    // ── Input.dispatchKeyEvent: analyze timing patterns ──────────
    let tracker = ctx.sessionState.get(TRACKER_KEY) as KeystrokeTracker | undefined;
    if (!tracker) {
      tracker = { samples: [] };
      ctx.sessionState.set(TRACKER_KEY, tracker);
    }

    const type = ctx.params.type as string;
    const code = ctx.params.code as string;
    const key = ctx.params.key as string;

    // Only track actual character input (keyDown for printable chars)
    if (type === 'keyDown' && key && key.length === 1) {
      tracker.samples.push({
        code, key, timestamp: Date.now(), type,
      });
    }

    // Analyze when we have enough samples AND the sequence pauses
    if (tracker.samples.length >= MIN_KEYS_FOR_ANALYSIS && (type === 'keyUp' || type === 'keyDown')) {
      return analyzeKeyTiming(tracker.samples);
    }

    return null;
  },
};

function analyzeKeyTiming(samples: KeySample[]): DecisionResult | null {
  if (samples.length < MIN_KEYS_FOR_ANALYSIS) return null;

  // Calculate inter-key intervals
  const intervals: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].timestamp - samples[i - 1].timestamp;
    if (dt > 0) intervals.push(dt);
  }

  if (intervals.length < 3) return null;

  // Coefficient of variation: low = constant timing = robotic
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean === 0) return null;
  const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean;

  // Check for exact repetition (e.g., all intervals exactly 50ms)
  const uniqueIntervals = new Set(intervals);
  const allIdentical = uniqueIntervals.size === 1;

  if (allIdentical) {
    return {
      ruleId: 'input-keystroke',
      action: 'block',
      severity: 'danger',
      reason: `All ${intervals.length} keystroke intervals are exactly ${intervals[0]}ms — impossible for human typing.`,
      suggestion: `Use page.fill(selector, text) instead of page.type() with delay.
Or add random variation: page.type(selector, text, {delay: 50 + Math.random() * 80}).`,
      errorCode: -32004,
      errorMessage: '[CDP Firewall] Constant keystroke timing detected — automated typing pattern',
    };
  }

  if (cv < 0.08) {
    return {
      ruleId: 'input-keystroke',
      action: 'block',
      severity: 'warn',
      reason: `Unnatural keystroke timing (CV=${cv.toFixed(3)}). Human typing has CV > 0.2 on average.`,
      suggestion: `Add random variation to your typing delay: page.type(selector, text, {delay: 50 + Math.random() * 80}).`,
      errorCode: -32004,
      errorMessage: '[CDP Firewall] Suspicious keystroke timing — likely automated',
    };
  }

  return null;
}
