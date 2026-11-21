/**
 * login-state — 离线提取本机 Chromium 系浏览器登录态（Cookies → Playwright storageState）。
 *
 * 第三条登录态通道：不控制浏览器、不需要扩展、Chrome 关着也能取。
 * 与 chrome-bridge（在线控制用户浏览器）互补，详见 README。
 */
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { exportLoginState, LoginStateError } from './helpers.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'login-state',
    url: 'https://127.0.0.1',
    description: '离线提取本机浏览器登录态：无锁快照 Cookies 库 + Keychain 解密 → Playwright storageState',
    requiresLogin: false,
  });

  site.command('export', {
    description: '从本机浏览器 profile 导出指定域名的登录 cookie（storageState 格式，0600 落盘）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({
      domains: z.string().describe('域名 CSV（最小权限，只导这些域），如 github.com,linear.app'),
      browser: z.enum(['chrome', 'canary', 'brave', 'edge', 'arc']).optional().describe('浏览器（默认 chrome）'),
      profile: z.string().optional().describe('profile 名（默认取 Cookies mtime 最新的）'),
      dbPath: z.string().optional().describe('直接指定 Cookies 库路径（跳过自动发现）'),
      output: z.string().optional().describe('输出路径（默认 ~/.xbrowser/login-state/state.json，0600）'),
      refresh: z.boolean().optional().describe('整体覆盖已有 state（默认合并 upsert）'),
    }),
    result: z.object({
      saved: z.string(),
      cookieCount: z.number(),
      failedCount: z.number(),
      domains: z.array(z.string()),
      profile: z.string(),
      browser: z.string(),
    }),
    examples: [
      { cmd: 'xbrowser login-state export --domains github.com', description: '导出 github.com 的登录 cookie 到默认位置' },
      { cmd: 'xbrowser login-state export --domains linear.app --output /tmp/linear-state.json --refresh', description: '导出 linear.app 并覆盖指定文件' },
    ],
    handler: async (params) => {
      try {
        const result = await exportLoginState({
          domains: params.domains,
          browser: params.browser,
          profile: params.profile,
          dbPath: params.dbPath,
          output: params.output,
          refresh: params.refresh,
        });
        const tips: string[] = [
          `已写入 ${result.saved}（0600）`,
          `profile=${result.profile} browser=${result.browser} 域=${result.domains.join(',')}`,
        ];
        if (result.failedCount > 0) {
          tips.push(`${result.failedCount} 条解密失败（非 v10/v11 加密，通常不影响核心登录态）`);
        }
        tips.push('注意：带此登录态的无头实例与真实浏览器同账号同时活跃，部分站点会互踢会话——错峰使用');
        return ok(result, tips);
      } catch (err) {
        if (err instanceof LoginStateError) {
          return fail(err.message, []);
        }
        throw err;
      }
    },
  });
}
