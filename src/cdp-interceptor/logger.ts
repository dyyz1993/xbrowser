/**
 * CDP Interceptor — Logger
 *
 * Structured logging for all CDP messages passing through the interceptor.
 * Supports in-memory buffer for recent log retrieval (for debugging/UI) and
 * optional file-based persistent logging.
 */

import type { CDPLogEntry, DecisionResult } from './types.js';

export interface CDPLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  log(method: string, direction: 'client→browser' | 'browser→client', sessionId: string, payload: unknown, decision?: DecisionResult | null): CDPLogEntry;
  getRecent(count: number): CDPLogEntry[];
  flush(): void;
}

interface LoggerConfig {
  enableLogging: boolean;
  logDir?: string;
}

export function createLogger(config: LoggerConfig): CDPLogger {
  const buffer: CDPLogEntry[] = [];
  const MAX_BUFFER = 2000;

  return {
    info(message, meta) {
      if (!config.enableLogging) return;
      const ts = new Date().toISOString();
      if (meta) {
        console.log(`[CDPInterceptor ${ts}] ${message}`, JSON.stringify(meta));
      } else {
        console.log(`[CDPInterceptor ${ts}] ${message}`);
      }
    },

    log(method, direction, sessionId, payload, decision) {
      const entry: CDPLogEntry = {
        timestamp: Date.now(),
        direction,
        sessionId,
        method,
        payload: sanitizePayload(payload),
        decision: decision ?? undefined,
      };

      if (config.enableLogging) {
        buffer.push(entry);
        if (buffer.length > MAX_BUFFER) buffer.shift();

        // Compact console output for real-time visibility
        const tag = decision
          ? decision.action === 'block'
            ? '🚫BLOCK'
            : decision.action === 'transform'
              ? '🔄XFMR'
              : '✅'
          : '  ';
        const reason = decision ? ` [${decision.severity}] ${decision.reason}` : '';
        console.log(`[CDP] ${tag} ${direction} ${method}${reason}`);
      }

      return entry;
    },

    getRecent(count) {
      return buffer.slice(-count);
    },

    flush() {
      buffer.length = 0;
    },
  };
}

/** Strip potentially large binary fields from payload for logging */
function sanitizePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) return { raw: String(payload) };
  const obj = payload as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'data' && typeof value === 'string' && value.length > 200) {
      cleaned[key] = `<binary: ${value.length} chars>`;
    } else if (key === 'expression' && typeof value === 'string' && value.length > 500) {
      cleaned[key] = value.substring(0, 500) + '...';
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
