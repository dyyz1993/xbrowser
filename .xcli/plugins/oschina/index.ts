import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import { randomPause } from '../shared/humanize.js';
import { registerOschinaPublishing } from './publishing.js';
import { LOGIN_URL_PATTERNS, checkLoggedIn } from '../shared/publishing/login-probe.js';
import { resolvePage } from '../shared/resolve-page.js';
import { loginWithHandoff } from '../shared/login-handoff.js';

/**
 * 开源中国（OSChina）插件。
 *
 * 发布（draft / publish）已迁移到共享发布层 `shared/publishing/`——
 * 实战验证（2026-10-23）：OSC 智写平台是 Tiptap/ProseMirror 编辑器，
 * `insertText` 与 `paste` 都无效，必须走 `editor.commands.setContent`；
 * 发布是「顶栏按钮弹 Popconfirm → 弹窗内确定并发布」两层结构。
 *
 * 本文件保留：站点注册、登录。
 */

/**
 * 本地 page 的登录探测（ERR-20261022-003 修正）。
 *
 * 旧判定（body 长度 > 50 且不含「登录注册」）在登出时也判真：my.oschina.net
 * 登出页正文够长、且不含这个精确串，命令被放进编辑器步骤后才以
 * 「标题输入框未找到」失败。改为只认确定信号：
 *
 * - 未登录：受保护页（如 /u/<uid>/blog/ai-write）302 到 /home/login
 *   （事件实录；与 LOGIN_URL_PATTERNS.oschina 同源）；
 * - 已登录：my.oschina.net 302 到个人空间 /u/<id>/
 *   （shared/publishing/sites/oschina.ts 实战记录：readyState 在重定向
 *   落地前就可能是 complete，必须轮询）。
 *
 * 没有已登录标记就不判真——宁可拦下给登录提示，也不要让登录页被误报成
 * 缺选择器（编辑器入口的重定向兜底另见 oscPublisher.open()）。
 */
async function probeLocalLoginMarker(page: Page): Promise<boolean> {
  try {
    await page
      .goto('https://my.oschina.net', { waitUntil: 'domcontentloaded', timeout: 15000 })
      .catch(() => undefined);
    for (let i = 0; i < 12; i++) {
      const url = page.url();
      if (LOGIN_URL_PATTERNS.oschina.some((p) => p.test(url))) return false;
      if (/my\.oschina\.net\/u\/\d+/.test(url)) return true;
      await randomPause(400, 600);
    }
    return false; // 轮询期内没有已登录标记——不判真
  } catch {
    return false;
  }
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'oschina',
    url: 'https://www.oschina.net',
    description: '开源中国 oschina - 开源/技术资讯社区 (DA 75+)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      // bridge 优先——用户登录态在用户自己的 Chrome 里（发布走 bridge 通道）
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as Page | undefined;
      return checkLoggedIn('oschina', 'https://my.oschina.net', async () => {
        if (!page) return true; // 连 page 都没有时放行（与 checkLoggedIn 的 assume 哲学一致，错误会在命令层更准确地暴露）
        return probeLocalLoginMarker(page);
      });
    },
  });

  site.command('login', {
    description: '登录 开源中国（打开登录页等待人工完成）',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser oschina login', description: '登录 oschina' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const { page, tips } = resolvePage(ctx);
      // fail-closed 语义下必须「先检查、再交还」：已登录直接成功；未登录才打开登录页并交还
      // 控制权（ctx.waitForHuman 抛 NEEDS_HUMAN，命令到此结束）。用户登录后重跑本命令即可收敛。
      const { url, alreadyLoggedIn } = await loginWithHandoff({
        page,
        ctx,
        checkUrl: 'https://my.oschina.net',
        loginUrl: 'https://www.oschina.net/home/login',
        reason: '完成 开源中国 登录（手机号验证码/Gitee OAuth）后，重新执行 xbrowser oschina login',
        timeout: 300,
        settleMs: 2000,
        // 登出时 my.oschina.net 停在公开首页（URL 不含 /login），所以除了 URL 还要看顶栏的
        // 「登录」入口（ERR-20261125-002）；只做 negative 判定，不要求出现 /u/<id> 才算已登录
        check: async (p) =>
          !p.url().includes('/login')
          && !(await p.locator('a[href*="/home/login"]').first().isVisible().catch(() => false)),
      });
      return ok({ loggedIn: true, url }, [alreadyLoggedIn ? '开源中国已是登录状态' : '开源中国登录成功', ...tips]);
    },
  });

  // draft / publish —— 共享发布层（chrome-bridge 优先，本地 page 兜底）
  registerOschinaPublishing(site);
}
