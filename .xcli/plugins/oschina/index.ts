import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import { randomPause } from '../shared/humanize.js';
import { registerOschinaPublishing } from './publishing.js';

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
    name: 'oschina',
    url: 'https://www.oschina.net',
    description: '开源中国 oschina - 开源/技术资讯社区 (DA 75+)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as Page | undefined;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login')) return false;
        const body = await page.evaluate(
          () => document.body?.textContent?.trim().slice(0, 300) || '',
        ) as string;
        return body.length > 50 && !body.includes('登录注册');
      } catch {
        return true;
      }
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
      const { page } = resolvePage(ctx);
      await page.goto('https://www.oschina.net/home/login', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await randomPause(1200, 2400);
      await ctx.waitForHuman?.({ reason: '完成 开源中国 登录（手机号验证码/Gitee OAuth）', timeout: 300 });
      await page
        .goto('https://my.oschina.net', { waitUntil: 'domcontentloaded', timeout: 15000 })
        .catch(() => {});
      const loggedIn = !(await page.url()).includes('/login');
      return ok({ loggedIn, url: page.url() }, [loggedIn ? '开源中国登录成功' : '仍未登录']);
    },
  });

  // draft / publish —— 共享发布层（chrome-bridge 优先，本地 page 兜底）
  registerOschinaPublishing(site);
}
