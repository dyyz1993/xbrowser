/**
 * CDP Interceptor — Public API
 *
 * A thin WebSocket proxy that intercepts all CDP traffic between automation
 * tools (Playwright, Puppeteer, Selenium, etc.) and Chromium. Applies ~200
 * detection patterns across 9 rule modules to block behaviors that would
 * expose automation to anti-crawler systems.
 *
 * ## Quick Start
 *
 * ```ts
 * const proxy = await createCDPInterceptor({
 *   cdpEndpoint: 'ws://localhost:9222/devtools/browser/abc123',
 * });
 * console.log(`Proxy running on ws://localhost:${proxy.port}`);
 * ```
 */

export { CDPInterceptorProxy } from './proxy.js';
export { createRuleEngine } from './rules-engine.js';
export type { RuleEngine } from './rules-engine.js';

// All built-in rules
export { domMutationRule } from './rules/dom-mutation.js';
export { mouseTrajectoryRule } from './rules/mouse-trajectory.js';
export { inputKeystrokeRule } from './rules/input-keystroke.js';
export { automationSignalsRule } from './rules/automation-signals.js';
export { fingerprintingRule } from './rules/fingerprinting.js';
export { eventSimulationRule } from './rules/event-simulation.js';
export { emulationOverrideRule } from './rules/emulation-override.js';
export { networkAnomalyRule } from './rules/network-anomaly.js';
export { pageLifecycleRule } from './rules/page-lifecycle.js';

export { advise } from './advisor.js';
export type { AdvisoryResult } from './advisor.js';

export type {
  CDPRequest, CDPResponse, CDPError, CDPMessage,
  MessageDirection, CDPLogEntry,
  ViolationSeverity, DecisionAction, DecisionResult,
  RuleContext, CDPInterceptorRule, CDPInterceptorConfig, CDPInterceptorStats,
} from './types.js';

/** Convenience factory: create and start a CDP interceptor proxy with defaults. */
export async function createCDPInterceptor(config: import('./types.js').CDPInterceptorConfig): Promise<import('./proxy.js').CDPInterceptorProxy> {
  const { CDPInterceptorProxy } = await import('./proxy.js');
  const proxy = new CDPInterceptorProxy(config);
  await proxy.start();
  return proxy;
}
