/**
 * Recovery module — automatic error recovery for failed commands.
 *
 * When a command fails (timeout, element not found, etc.), the recovery
 * system pauses execution, opens the viewer, and waits for a human or
 * Agent to fix the issue. After the fix is confirmed, the failed command
 * is retried automatically.
 *
 * Enable via: XBROWSER_RECOVERY=true  (env var)
 * Timeout via: XBROWSER_RECOVERY_TIMEOUT=120  (seconds, default 120)
 */

import { WSServer } from './websocket-server.js';
import { HumanInteractionManager } from './human-interaction.js';
import { buildViewerUrl } from './utils/viewer-url.js';
import type { Page } from './browser-shim.js';

export interface RecoveryConfig {
  enabled: boolean;
  timeout: number;
}

/**
 * Get the current recovery configuration from environment variables.
 */
export function getRecoveryConfig(): RecoveryConfig {
  const val = process.env.XBROWSER_RECOVERY?.toLowerCase();
  return {
    enabled: val === 'true' || val === '1' || val === 'yes',
    timeout: Math.max(10, parseInt(process.env.XBROWSER_RECOVERY_TIMEOUT || '120', 10)),
  };
}

/**
 * Attempt to recover from a failed command.
 *
 * Opens the viewer (if available), prints the error and a recovery
 * prompt, then waits for either:
 *   - The user to press Enter in the terminal (stdin)
 *   - The user/Agent to click "Done" in the viewer (WebSocket signal)
 *   - The timeout to expire
 *
 * @param page - The browser page (session must be alive).
 * @param sessionName - Session name for viewer URL.
 * @param commandName - The command that failed.
 * @param errorMessage - The error message.
 * @param previewWS - Optional WSServer (daemon mode) for viewer integration.
 * @returns Whether the user signaled recovery should be attempted.
 */
export async function attemptRecovery(
  page: Page | null | undefined,
  sessionName: string,
  commandName: string,
  errorMessage: string,
  previewWS?: WSServer | null,
): Promise<{ recovered: boolean }> {
  const cfg = getRecoveryConfig();
  if (!cfg.enabled) return { recovered: false };
  // Can't recover without a page
  if (!page) {
    return { recovered: false };
  }

  const viewerUrl = buildViewerUrl(sessionName);

  // If we have a preview WS (daemon mode), use HumanInteractionManager
  // which streams screencast frames and waits for WebSocket "human-solved" signal.
  if (previewWS) {
    try {
      // Register the session so the viewer can connect
      previewWS.registerSession(sessionName, page);

      // Use the existing screencast + wait-for-human flow.
      // This broadcasts frames to the viewer and waits for:
      //   - User to click "Done" in the viewer (sends "human-solved" via WS)
      //   - Agent to send "manual-solve" via WS
      //   - Timeout
      const manager = new HumanInteractionManager(previewWS, page);
      const result = await manager.waitForHuman({
        reason: `Command "${commandName}" failed: ${errorMessage}. Fix the issue and confirm via viewer.`,
        timeout: cfg.timeout,
        autoDetect: false,
      });
      return { recovered: result.solved };
    } catch {
      // HumanInteractionManager failed — fall through to stdin fallback
    }
  }

  // Fallback: print viewer URL and wait for stdin
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`⚠️  COMMAND FAILED: ${commandName}`);
  console.log(`⚠️  Error: ${errorMessage}`);
  console.log(`⚠️  `);
  console.log(`⚠️  Recovery mode activated`);
  if (viewerUrl) {
    console.log(`⚠️  Viewer: ${viewerUrl}`);
  }
  console.log(`⚠️  `);
  console.log(`⚠️  Fix the issue, then press ENTER to retry`);
  console.log(`⚠️  Type "abort" + ENTER to cancel`);
  console.log(`⚠️  (${cfg.timeout}s timeout)`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // Read a line from stdin (process.stdin must be in flowing mode).
  // All three exit paths (timeout / abort / retry) tear down the listener
  // and pause stdin so the process can exit cleanly.
  return new Promise<{ recovered: boolean }>((resolve) => {
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
    };

    const timeoutTimer = setTimeout(() => {
      console.log('⏰ Recovery timeout — aborting');
      cleanup();
      resolve({ recovered: false });
    }, cfg.timeout * 1000);

    const onData = (buf: Buffer) => {
      const line = buf.toString().trim().toLowerCase();
      cleanup();
      // "abort" / "q" / "exit" = cancel; anything else = retry
      resolve({ recovered: line !== 'abort' && line !== 'q' && line !== 'exit' });
    };

    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}
