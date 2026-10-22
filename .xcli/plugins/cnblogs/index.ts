import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

import { randomPause } from '../shared/humanize.js';
import { registerCnblogsPublishing } from './publishing.js';
import { checkLoggedIn } from '../shared/publishing/login-probe.js';

/**
 * 博客园插件。
 *
 * 发布（draft / publish）已迁移到共享发布层 `shared/publishing/`——
 * 实战验证（2026-10-23）：编辑器是 Markdown 源码模式（`#md-editor` 原生
 * textarea），发布按钮「发布草稿」单层点击即最终提交；旧实现按 TinyMCE
 * 路径走（`tinymce.setContent`），在当前编辑器上不生效。
 *
 * 本文件保留：站点注册、登录检测。
 */

function resolvePage(ctx: CommandContext): { page: Page; tips: string[] } {
  const page = ctx.page;
  if (!page) throw new Error('需要浏览器页面');
  const tips: string[] = [];
  if (!ctx.cdpEndpoint) {
    tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
  }
  return { page, tips };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'cnblogs',
    url: 'https://www.cnblogs.com',
    description: '博客园 - 老牌中文技术博客平台 (DA 80+, 百度权重极高)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      // bridge 优先——用户登录态在用户自己的 Chrome 里（发布走 bridge 通道）
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as Page | undefined;
      return checkLoggedIn('cnblogs', 'https://i.cnblogs.com/posts', async () => {
        if (!page) return true;
        const url = page.url();
        if (url.includes('account.cnblogs.com/signin')) return false;
        const body = await page.evaluate(
          () => document.body?.textContent?.trim().slice(0, 300) || '',
        ) as string;
        if (!body) return false;
        if (body.includes('用户名或密码错误')) return false;
        return true;
      });
    },
  });

  site.command('login', {
    description: '登录博客园（打开登录页等待人工完成）',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser cnblogs login', description: '登录博客园' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const { page } = resolvePage(ctx);
      await page.goto('https://account.cnblogs.com/signin', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await randomPause(1200, 2400);
      await ctx.waitForHuman?.({ reason: '完成博客园登录（用户名密码/扫码）', timeout: 300 });
      await page
        .goto('https://i.cnblogs.com/posts', { waitUntil: 'domcontentloaded', timeout: 15000 })
        .catch(() => {});
      const loggedIn = !(await page.url()).includes('signin');
      return ok({ loggedIn, url: page.url() }, [loggedIn ? '博客园登录成功' : '仍未登录，请检查']);
    },
  });

  // draft / publish —— 共享发布层（chrome-bridge 优先，本地 page 兜底）
  registerCnblogsPublishing(site);
}
