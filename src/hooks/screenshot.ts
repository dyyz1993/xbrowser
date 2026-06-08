import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ExecutionHook, HookResultContext } from './types.js';

const SCREENSHOTS_DIR = join(homedir(), '.xbrowser', 'screenshots', 'hooks');

function ensureDir(): void {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface ScreenshotEntry {
  step: string;
  command: string;
  /** File path to the screenshot on disk */
  path: string;
  /** Deprecated: base64 data (only when XBROWSER_SCREENSHOT_BASE64=1 is set) */
  base64?: string;
  url: string;
  timestamp: number;
}

export const screenshotHook: ExecutionHook = {
  name: 'screenshot',
  async onAfterCommand(ctx: HookResultContext): Promise<Record<string, unknown> | void> {
    try {
      const quality = parseInt(process.env.XBROWSER_SCREENSHOT_QUALITY || '40');
      const buffer = await ctx.page.screenshot({
        type: 'jpeg',
        quality: Math.max(10, Math.min(100, quality)),
      });

      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      const screenshotPath = join(SCREENSHOTS_DIR, `hook-${timestamp}-${random}.jpg`);

      ensureDir();
      writeFileSync(screenshotPath, buffer);

      const entry: ScreenshotEntry = {
        step: ctx.command,
        command: ctx.command,
        path: screenshotPath,
        url: ctx.page.url(),
        timestamp,
      };

      // Keep base64 for backward compat when env var is set
      if (process.env.XBROWSER_SCREENSHOT_BASE64 === '1') {
        entry.base64 = buffer.toString('base64');
      }

      return { screenshot: entry };
    } catch {
      return undefined;
    }
  },
};
