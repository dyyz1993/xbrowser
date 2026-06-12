/**
 * Session Replay Engine — replays a recorded session step by step.
 *
 * Usage:
 *   const replayer = new SessionReplayer({ cdpUrl: 'http://localhost:9221' });
 *   await replayer.load('/path/to/recording.json');
 *   await replayer.run();
 */

import type { UserAction } from './session-recorder.js';
import type { XBPage, XBFilePayload } from '../cdp-driver/types.js';

export interface ReplayOptions {
  cdpUrl?: string;
  /** Provide an existing page (from daemon session) instead of connecting */
  page?: XBPage;
  /** Delay between steps in ms (default: 500) */
  stepDelay?: number;
  /** Timeout per step in ms (default: 10000) */
  stepTimeout?: number;
  /** Called before each step */
  onStep?: (action: UserAction, index: number, total: number) => void;
  /** Called on step error */
  onError?: (action: UserAction, error: Error) => void;
}

interface RecordingData {
  actions: UserAction[];
  network?: unknown[];
  contextChanges?: unknown[];
  meta?: {
    startUrl?: string;
    sessionName?: string;
  };
}

export class SessionReplayer {
  private opts: Required<Pick<ReplayOptions, 'stepDelay' | 'stepTimeout'>> & Omit<ReplayOptions, 'stepDelay' | 'stepTimeout'>;
  private recording: RecordingData | null = null;
  private page: XBPage | null = null;

  constructor(opts: ReplayOptions) {
    this.opts = {
      cdpUrl: opts.cdpUrl,
      page: opts.page,
      stepDelay: opts.stepDelay ?? 500,
      stepTimeout: opts.stepTimeout ?? 10000,
      onStep: opts.onStep,
      onError: opts.onError,
    };
  }

  /** Load a recording from a file path or parsed JSON */
  async load(source: string | RecordingData): Promise<void> {
    if (typeof source === 'string') {
      const fs = await import('fs');
      const raw = fs.readFileSync(source, 'utf8');
      this.recording = JSON.parse(raw);
    } else {
      this.recording = source;
    }
  }

  /** Run the full replay */
  async run(): Promise<{ success: number; failed: number; skipped: number }> {
    if (!this.recording) throw new Error('No recording loaded. Call load() first.');

    // Use provided page or connect to browser via CDP
    if (this.opts.page) {
      this.page = this.opts.page;
    } else if (this.opts.cdpUrl) {
      const { launch } = await import('../cdp-driver/index.js');
      const { browser } = await launch({ cdpEndpoint: this.opts.cdpUrl });
      // Wait for contexts to populate (CDP connection may need a moment)
      let contexts = browser.contexts();
      for (let i = 0; i < 10 && contexts.length === 0; i++) {
        await new Promise(r => setTimeout(r, 500));
        contexts = browser.contexts();
      }
      const context = contexts[0];
      if (!context) throw new Error('No browser context available');
      const pages = context.pages();
      this.page = pages[0];
    }

    if (!this.page) throw new Error('No page available. Provide cdpUrl or page.');

    const actions = this.recording.actions;
    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.opts.onStep?.(action, i, actions.length);

      try {
        await this.replayAction(action);
        success++;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.opts.onError?.(action, err);
        if (action.type === 'navigation') {
          // Navigation failures are non-fatal
          skipped++;
        } else {
          failed++;
        }
      }

      // Delay between steps
      if (i < actions.length - 1) {
        await new Promise(r => setTimeout(r, this.opts.stepDelay));
      }
    }

    return { success, failed, skipped };
  }

  /** Replay a single action */
  private async replayAction(action: UserAction): Promise<void> {
    const page = this.page!;
    const timeout = this.opts.stepTimeout;

    switch (action.type) {
      case 'navigation':
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout });
        break;

      case 'goto':
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout });
        break;

      case 'click':
      case 'cdp-click': {
        const selector = this.resolveSelector(action);
        await page.waitForSelector(selector, { state: 'visible', timeout });
        await page.click(selector, { timeout });
        break;
      }

      case 'input': {
        const selector = this.resolveSelector(action);
        await page.waitForSelector(selector, { state: 'visible', timeout });
        await page.fill(selector, action.value ?? '', { timeout });
        break;
      }

      case 'cdp-fill': {
        const selector = this.resolveSelector(action);
        await page.waitForSelector(selector, { state: 'visible', timeout });
        await page.fill(selector, action.value ?? '', { timeout });
        break;
      }

      case 'change': {
        // select element change
        const selector = this.resolveSelector(action);
        await page.waitForSelector(selector, { state: 'visible', timeout });
        if (action.value) {
          await page.selectOption(selector, action.value);
        }
        break;
      }

      case 'filechooser': {
        const selector = this.resolveSelector(action);
        await page.waitForSelector(selector, { state: 'visible', timeout });
        const files = this.resolveFiles(action);
        if (files.length > 0) {
          await page.setInputFiles(selector, files);
        }
        break;
      }

      case 'keydown': {
        if (action.key === 'Enter') {
          await page.keyboard.press('Enter');
        } else if (action.key === 'Tab') {
          await page.keyboard.press('Tab');
        } else if (action.key === 'Escape') {
          await page.keyboard.press('Escape');
        }
        break;
      }

      case 'submit': {
        const selector = this.resolveSelector(action);
        if (selector) {
          await page.click(selector, { timeout });
        }
        break;
      }

      case 'scroll': {
        await page.evaluate(() => {
          window.scrollBy(action.scrollX ?? 0, action.scrollY ?? 0);
        });
        break;
      }

      default:
        // Unknown action type — skip
        break;
    }
  }

  /** Resolve the best selector for an action */
  private resolveSelector(action: UserAction): string {
    const el = action.element;
    if (!el) return '';

    // Prefer textFallback for low-confidence selectors
    if (el.textFallback) {
      // Use the original CSS selector with text matching
      // For replay, we use the CSS selector directly
    }

    // Use selector if available and not a low-confidence nth-of-type
    if (el.selector) {
      return el.selector;
    }

    // Fallback to tag-based
    if (el.tag) {
      return el.tag;
    }

    return '';
  }

  /** Resolve file payloads from a filechooser action */
  private resolveFiles(action: UserAction): XBFilePayload[] {
    if (!action.files?.fileData) return [];

    return action.files.fileData
      .filter(f => f.dataUrl)
      .map(f => {
        // dataUrl format: "data:<mime>;base64,<base64data>"
        const match = f.dataUrl!.match(/^data:[^;]+;base64,(.+)$/);
        if (!match) return null;
        return {
          name: f.name,
          mimeType: f.type || 'application/octet-stream',
          buffer: Buffer.from(match[1], 'base64'),
        } as XBFilePayload;
      })
      .filter((f): f is XBFilePayload => f !== null);
  }

  /** Clean up */
  async close(): Promise<void> {
    // Don't close the browser — just disconnect
    this.page = null;
  }
}
