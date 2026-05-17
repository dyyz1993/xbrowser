/**
 * CDP Interceptor — Core Types
 *
 * Models the JSON-RPC 2.0 messages flowing over the CDP WebSocket and
 * defines the rule/decision system for intercepting, blocking, or
 * transforming automation traffic to avoid anti-crawler detection.
 */

/** Raw JSON-RPC 2.0 request as it appears on the wire */
export interface CDPRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

/** Raw JSON-RPC 2.0 response (success) */
export interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  sessionId?: string;
}

/** Raw JSON-RPC 2.0 error response */
export interface CDPError {
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  sessionId?: string;
}

/** Union of all possible CDP messages */
export type CDPMessage = CDPRequest | CDPResponse | CDPError;

/** Direction: from client → browser or browser → client */
export type MessageDirection = 'client→browser' | 'browser→client';

/** Structured log entry for a single CDP message */
export interface CDPLogEntry {
  /** Unix timestamp in ms */
  timestamp: number;
  /** Message direction */
  direction: MessageDirection;
  /** Session identifier (for grouping messages) */
  sessionId: string;
  /** CDP method (e.g. "Runtime.evaluate"), undefined for responses */
  method?: string;
  /** Sanitized payload summary */
  payload: Record<string, unknown>;
  /** Rule decision that was applied, if any */
  decision?: DecisionResult;
}

/**
 * Severity of a rule violation
 *
 * - **danger**: definitely triggers anti-crawler detection — block immediately
 * - **warn**:   likely problematic — log and warn, but don't block yet
 * - **info**:   informational only — could be a future concern
 */
export type ViolationSeverity = 'danger' | 'warn' | 'info';

/**
 * Action the interceptor should take for a matched message
 *
 * - **block**:     reject the message, return CDP error, never reach browser
 * - **transform**: modify the message before forwarding
 * - **pass**:      forward unchanged (log only)
 */
export type DecisionAction = 'block' | 'transform' | 'pass';

/** Result of a rule evaluation */
export interface DecisionResult {
  /** Matched rule id */
  ruleId: string;
  action: DecisionAction;
  severity: ViolationSeverity;
  /** Human-readable explanation of why this was flagged */
  reason: string;
  /** Suggested fix / alternative approach */
  suggestion?: string;
  /** Transformed params (only for 'transform' action) */
  transformedParams?: Record<string, unknown>;
  /** Custom CDP error code (only for 'block' action) */
  errorCode?: number;
  /** Custom CDP error message (only for 'block' action) */
  errorMessage?: string;
}

/** Handler context passed to each rule */
export interface RuleContext {
  method: string;
  params: Record<string, unknown>;
  sessionId: string;
  /** Direction: the message is being sent TO the browser */
  direction: MessageDirection;
  /** Per-session state store (rules can stash data here) */
  sessionState: Map<string, unknown>;
}

/**
 * A CDP interception rule
 *
 * Rules are evaluated **in priority order** (lower number = earlier).
 * The first rule that returns a decision wins.
 */
export interface CDPInterceptorRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Priority: lower numbers are evaluated first */
  priority: number;
  /**
   * Quick pre-filter — skip expensive checks for messages that can't match.
   * Return false to skip this rule.
   */
  canHandle?(ctx: RuleContext): boolean;
  /**
   * Evaluate the message and return a decision.
   * Return null to pass (no match).
   */
  evaluate(ctx: RuleContext): DecisionResult | null;
}

/** Configuration for the CDP interceptor proxy */
export interface CDPInterceptorConfig {
  /** Chromium CDP WebSocket endpoint (e.g. ws://localhost:9222/...) */
  cdpEndpoint: string;
  /** Port to listen on for incoming client connections */
  listenPort?: number;
  /** Rules to apply, defaults to built-in rules */
  rules?: CDPInterceptorRule[];
  /** Enable logging (default: true) */
  enableLogging?: boolean;
  /** Log output directory (default: no file logging) */
  logDir?: string;
  /** Block mode: 'strict' blocks danger only, 'paranoid' blocks warn+ */
  blockMode?: 'strict' | 'paranoid';
}

/** Statistics collected during a proxy session */
export interface CDPInterceptorStats {
  totalMessages: number;
  blockedMessages: number;
  transformedMessages: number;
  passedMessages: number;
  /** Breakdown by rule id */
  byRule: Record<string, { matched: number; blocked: number; transformed: number }>;
}
