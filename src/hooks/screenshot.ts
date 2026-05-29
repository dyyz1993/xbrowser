import type { ExecutionHook, HookResultContext } from './types.js';

export interface ScreenshotEntry {
  step: string;
  command: string;
  base64: string;
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
      const entry: ScreenshotEntry = {
        step: ctx.command,
        command: ctx.command,
        base64: buffer.toString('base64'),
        url: ctx.page.url(),
        timestamp: Date.now(),
      };
      return { screenshot: entry };
    } catch {
      return undefined;
    }
  },
};
