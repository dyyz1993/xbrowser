/**
 * CDP Interceptor — Rule Engine
 *
 * Evaluates messages against a prioritized list of interception rules.
 * Rules that need per-session state can store data in sessionState.
 *
 * Total built-in patterns: ~200+ across 9 rule modules.
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from './types.js';
import { domMutationRule } from './rules/dom-mutation.js';
import { mouseTrajectoryRule } from './rules/mouse-trajectory.js';
import { inputKeystrokeRule } from './rules/input-keystroke.js';
import { automationSignalsRule } from './rules/automation-signals.js';
import { fingerprintingRule } from './rules/fingerprinting.js';
import { eventSimulationRule } from './rules/event-simulation.js';
import { emulationOverrideRule } from './rules/emulation-override.js';
import { networkAnomalyRule } from './rules/network-anomaly.js';
import { pageLifecycleRule } from './rules/page-lifecycle.js';

/** Default built-in rules (always loaded unless overridden)
 *
 * Priority order (lower = earlier):
 *    10  DOM property mutation (value=, checked=, innerHTML=, 50+)
 *    20  Automation signals (Playwright/Puppeteer/Selenium markers, 35+)
 *    30  Fingerprinting APIs (canvas, WebGL, AudioContext, navigator, 35+)
 *    40  Event simulation (dispatchEvent, click/focus/blur, 30+)
 *    50  Mouse trajectory analysis (stateful)
 *    55  Input keystroke timing (stateful)
 *    60  CDP emulation/override detection (20+)
 *    70  Network anomaly detection (8+)
 *    80  Page lifecycle anomaly (10+)
 */
const BUILTIN_RULES: CDPInterceptorRule[] = [
  domMutationRule,
  automationSignalsRule,
  fingerprintingRule,
  eventSimulationRule,
  mouseTrajectoryRule,
  inputKeystrokeRule,
  emulationOverrideRule,
  networkAnomalyRule,
  pageLifecycleRule,
];

export interface RuleEngine {
  start(): void;
  stop(): void;
  evaluate(ctx: Omit<RuleContext, 'sessionState'>): DecisionResult | null;
}

export function createRuleEngine(customRules?: CDPInterceptorRule[]): RuleEngine {
  const rules = [...BUILTIN_RULES, ...(customRules ?? [])].sort((a, b) => a.priority - b.priority);

  const sessionStates = new Map<string, Map<string, unknown>>();

  function getSessionState(sessionId: string): Map<string, unknown> {
    let state = sessionStates.get(sessionId);
    if (!state) {
      state = new Map();
      sessionStates.set(sessionId, state);
    }
    return state;
  }

  return {
    start() { sessionStates.clear(); },
    stop() { sessionStates.clear(); },

    evaluate(ctx) {
      const fullCtx: RuleContext = {
        ...ctx,
        sessionState: getSessionState(ctx.sessionId),
      };

      for (const rule of rules) {
        if (rule.canHandle && !rule.canHandle(fullCtx)) continue;
        const decision = rule.evaluate(fullCtx);
        if (!decision) continue;
        // Only return actionable decisions. 'pass' = log-only, keep checking
        if (decision.action !== 'pass') return decision;
      }

      return null;
    },
  };
}
