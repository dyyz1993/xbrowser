/**
 * screenshot-hook — 截图钩子
 *
 * 在命令执行后自动截图，返回 base64 编码的截图数据。
 * 通过 XBROWSER_HOOKS=screenshot 启用。
 * 截图质量通过 XBROWSER_SCREENSHOT_QUALITY 环境变量控制（默认 40）。
 */

import type { Page } from '../browser-shim.js';

interface HookContext {
  page: Page;
  command: string;
  params: Record<string, unknown>;
}

interface AfterHookContext extends HookContext {
  result: unknown;
  duration: number;
}

export const screenshotHook = {
  name: 'screenshot' as const,
  onAfterCommand: async (ctx: AfterHookContext): Promise<Record<string, unknown> | undefined> => {
    try {
      const quality = parseInt(process.env.XBROWSER_SCREENSHOT_QUALITY || '40', 10);
      const buf = await ctx.page.screenshot({ type: 'jpeg', quality }).catch(() => null);
      if (!buf) return;

      return {
        screenshot: {
          step: ctx.command,
          command: ctx.command,
          base64: buf.toString('base64'),
          url: ctx.page.url(),
          timestamp: Date.now(),
        },
      };
    } catch {
      return;
    }
  },
};
