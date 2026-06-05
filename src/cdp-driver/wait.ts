/**
 * WaitForLoadState — Advanced page load detection
 *
 * Tracks network activity to determine when a page has reached a stable state.
 * Uses inflight request counting with configurable quiet window.
 */

import type { CDPConnection } from './connection.js';

interface NetworkIdleOptions {
  /** Quiet window duration (ms) with zero inflight requests (default: 500) */
  idleTime?: number;
  /** Maximum wait time (ms) */
  timeout?: number;
  /** Maximum number of inflight requests to still be considered idle (default: 0) */
  maxInflight?: number;
}

/**
 * Wait for the page network to become idle.
 *
 * Tracks all Network.requestWillBeSent and Network.loadingFinished/Failed events
 * on the given CDP session. When the inflight count stays at or below maxInflight
 * for the full idleTime window, resolves.
 */
export async function waitForNetworkIdle(
  conn: CDPConnection,
  sessionId: string | undefined,
  opts: NetworkIdleOptions = {},
): Promise<void> {
  const idleTime = opts.idleTime ?? 500;
  const timeout = opts.timeout ?? 30_000;
  const maxInflight = opts.maxInflight ?? 0;

  return new Promise((resolve, reject) => {
    let inflight = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let unsub1: (() => void) | null = null;
    let unsub2: (() => void) | null = null;
    let unsub3: (() => void) | null = null;

    const cleanup = (): void => {
      if (unsub1) unsub1();
      if (unsub2) unsub2();
      if (unsub3) unsub3();
      if (idleTimer) clearTimeout(idleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    const checkIdle = (): void => {
      if (inflight <= maxInflight) {
        if (!idleTimer) {
          idleTimer = setTimeout(() => {
            cleanup();
            resolve();
          }, idleTime);
        }
      } else {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      }
    };

    const onRequest = (): void => {
      inflight++;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const onFinish = (): void => {
      inflight = Math.max(0, inflight - 1);
      checkIdle();
    };

    const onFail = (): void => {
      inflight = Math.max(0, inflight - 1);
      checkIdle();
    };

    // Set up timeout
    timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`waitForNetworkIdle timeout after ${timeout}ms`));
    }, timeout);

    // Subscribe to network events
    unsub1 = conn.subscribe('Network.requestWillBeSent', sessionId, onRequest);
    unsub2 = conn.subscribe('Network.loadingFinished', sessionId, onFinish);
    unsub3 = conn.subscribe('Network.loadingFailed', sessionId, onFail);

    // Start checking
    checkIdle();
  });
}
