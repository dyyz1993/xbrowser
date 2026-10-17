import type { Page } from '../browser-shim.js';
import type { ActionSignal, CheckpointEntry, CheckpointType, NetworkEntry, UserAction } from './recording-types.js';

export async function detectCheckpoints(page: Page,
allocateCheckpointId: () => number,
): Promise<CheckpointEntry[]> {
  const CHECKPOINT_RULES: Array<{ type: CheckpointType; selectors: string[] }> = [
    { type: 'captcha', selectors: ['img[src*="captcha"]', 'img[src*="verify"]', '[class*="captcha"]', '[id*="captcha"]', '#captcha', '.captcha'] },
    { type: 'slider', selectors: ['[class*="slider"]', '[class*="drag-verify"]', '[class*="slide-verify"]'] },
    { type: 'login', selectors: ['input[type="password"]'] },
    { type: 'iframe', selectors: ['iframe[src*="captcha"]', 'iframe[src*="verify"]', 'iframe[src*="recaptcha"]', 'iframe[title*="captcha"]'] },
  ];

  try {
    const found = await page.evaluate<Array<{ type: string; selector: string; text: string }>>((rules: Array<{ type: string; selectors: string[] }>) => {
      const results: Array<{ type: string; selector: string; text: string }> = [];
      for (const rule of rules) {
        for (const sel of rule.selectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                results.push({
                  type: rule.type,
                  selector: sel,
                  text: (el.textContent || '').substring(0, 60),
                });
              }
            }
          } catch { /* skip invalid selector */ }
        }
      }
      return results;
    }, CHECKPOINT_RULES);

    const entries: CheckpointEntry[] = [];
    for (const item of found) {
      const id = allocateCheckpointId();;
      const hints: Record<string, string> = {
        captcha: 'Captcha verification detected',
        slider: 'Slider verification detected',
        login: 'Login form detected (password field)',
        iframe: 'Verification iframe detected',
      };
      entries.push({
        id,
        type: item.type as CheckpointType,
        timestamp: Date.now(),
        url: page.url(),
        pageTitle: await page.title().catch(() => ''),
        hint: hints[item.type] || item.type,
        selector: item.selector,
        source: 'auto',
        context: { matchedSelector: item.selector, elementText: item.text },
      });
    }
    return entries;
  } catch {
    return [];
  }
}

// ─── Verification: collect success signals after key actions ──────

/**
 * After a key action (click/submit/input), check for success signals:
 * URL changes, recent successful network responses, dialog appearances.
 */
export async function verifyAction(page: Page, action: UserAction,
network: NetworkEntry[],
checkpoints: CheckpointEntry[],
): Promise<ActionSignal[]> {
  const signals: ActionSignal[] = [];

  // 1. URL change detection
  try {
    const currentUrl = page.url();
    if (currentUrl && currentUrl !== 'about:blank' && currentUrl !== action.url) {
      signals.push({ type: 'url_change', value: currentUrl, label: `URL changed to ${currentUrl}` });
    }
  } catch { /* page may be closed */ }

  // 2. Recent successful network responses (3s window after action)
  try {
    const recentNetwork = network.filter(n =>
      n.timestamp > action.timestamp - 100 &&
      n.timestamp < action.timestamp + 5000 &&
      n.status >= 200 && n.status < 400
    );
    for (const net of recentNetwork.slice(0, 3)) {
      signals.push({
        type: 'network_success',
        value: `${net.status}`,
        label: `${net.method} ${net.path} → ${net.status}`,
      });
    }
  } catch { /* ignore */ }

  // 3. Dialog checkpoint near this action
  try {
    const recentDialog = [...checkpoints].reverse().find(cp =>
      cp.type === 'dialog' && Math.abs(cp.timestamp - action.timestamp) < 3000
    );
    if (recentDialog) {
      signals.push({ type: 'dialog', value: recentDialog.type, label: recentDialog.hint });
    }
  } catch { /* ignore */ }

  return signals;
}
