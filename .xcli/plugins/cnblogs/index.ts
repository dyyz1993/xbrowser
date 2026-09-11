import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

import { randomPause, humanFill } from '../shared/humanize.js';

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
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as Page | undefined;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('account.cnblogs.com/signin')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '') as string;
        if (!body) return false;
        if (body.includes('用户名或密码错误')) return false;
        return true;
      } catch {
        return true;
      }
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
      await page.goto('https://account.cnblogs.com/signin', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomPause(1200, 2400);
      await ctx.waitForHuman?.({ reason: '完成博客园登录（用户名密码/扫码）', timeout: 300 });
      await page.goto('https://i.cnblogs.com/posts', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const loggedIn = !(await page.url()).includes('signin');
      return ok({ loggedIn, url: page.url() }, [loggedIn ? '博客园登录成功' : '仍未登录，请检查']);
    },
  });

  // 新建随笔：https://i.cnblogs.com/posts/edit（title input#post-title + 正文 #Editor_Markdown 区/textarea）
  site.command('draft', {
    description: '在博客园保存随笔草稿',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
    }),
    examples: [
      { cmd: 'xbrowser cnblogs draft --title "T" --file article.md', description: '保存随笔草稿' },
    ],
    result: z.object({ title: z.string(), saved: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      let content = params.content || '';
      if (!content && params.file) {
        const { readFileSync } = await import('node:fs');
        content = readFileSync(params.file, 'utf8');
      }
      if (!content) return fail('必须提供 --content 或 --file 参数');
      const { page, tips } = resolvePage(ctx);

      await page.goto('https://i.cnblogs.com/posts/edit', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded');
      await randomPause(1500, 3000);

      if ((await page.url()).includes('signin')) {
        return fail('未登录：先跑 xbrowser cnblogs login');
      }

      const titleInput = page.locator('#post-title, input[placeholder*="标题"], input[name="title"]').first();
      if (!(await titleInput.isVisible().catch(() => false))) {
        return fail('标题输入框未找到', ['编辑页结构可能变化，请人工检查 i.cnblogs.com/posts/edit']);
      }
      await humanFill(page, titleInput, params.title);

      // 博客园 Markdown 编辑器：#Editor_Markdown（textarea）或 CodeMirror 包装
      // 博客园编辑器是 TinyMCE：内容必须经 tinymce.setContent 写入（实测 native setter + input 事件不进编辑器状态）
      const filled = await page.evaluate((md: string) => {
        const w = window as unknown as { tinymce?: { get(id: string): { setContent(c: string): void } | null; activeEditor: { setContent(c: string): void } | null } };
        if (typeof w.tinymce === 'undefined') return 'no-tinymce';
        const ed = w.tinymce.get('Editor_Edit_EditorBody') || w.tinymce.activeEditor;
        if (!ed) return 'no-editor';
        ed.setContent(md);
        return 'ok';
      }, content).catch(() => 'eval-error') as string;
      if (filled !== 'ok') {
        // 兜底：非 TinyMCE 形态走 textarea
        const bodyInput = page.locator('#Editor_Markdown, textarea[name*="markdown"], textarea').first();
        if (!(await bodyInput.isVisible().catch(() => false))) {
          return fail(`正文编辑器写入失败（${filled}）`);
        }
        await humanFill(page, bodyInput, content);
      }

      return ok({ title: params.title, saved: true, url: page.url() }, [
        ...tips,
        '内容已填入编辑器（博客园自动保存草稿，也可手动点"保存为草稿"）',
      ]);
    },
  });

  site.command('publish', {
    description: '在博客园发布随笔',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
      keepAlive: z.boolean().optional().default(false).describe('发布后保留 session'),
    }),
    examples: [
      { cmd: 'xbrowser cnblogs publish --title "T" --file article.md', description: '发布随笔' },
    ],
    result: z.object({ title: z.string(), published: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      let content = params.content || '';
      if (!content && params.file) {
        const { readFileSync } = await import('node:fs');
        content = readFileSync(params.file, 'utf8');
      }
      if (!content) return fail('必须提供 --content 或 --file 参数');
      const { page, tips } = resolvePage(ctx);

      await page.goto('https://i.cnblogs.com/posts/edit', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded');
      await randomPause(1500, 3000);

      if ((await page.url()).includes('signin')) {
        return fail('未登录：先跑 xbrowser cnblogs login');
      }

      const titleInput = page.locator('#post-title, input[placeholder*="标题"], input[name="title"]').first();
      if (!(await titleInput.isVisible().catch(() => false))) {
        return fail('标题输入框未找到');
      }
      await humanFill(page, titleInput, params.title);

      const cm = await page.$('#Editor_Markdown .CodeMirror, .CodeMirror');
      if (cm) {
        const bodyArea = page.locator('#Editor_Markdown .CodeMirror textarea, .CodeMirror textarea').first();
        await humanFill(page, bodyArea, content);
      } else {
        const bodyInput = page.locator('#Editor_Markdown, textarea[name*="markdown"], textarea').first();
        await humanFill(page, bodyInput, content);
      }

      // 发布按钮：#btn_post（"发布"）
      const publishBtn = page.locator('#btn_post, button:has-text("发布")').first();
      if (!(await publishBtn.isVisible().catch(() => false))) {
        return fail('发布按钮未找到');
      }
      await publishBtn.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await randomPause(3000, 5000);

      const url = page.url();
      const published = /cnblogs\.com\/[a-z0-9-]+\/p\//.test(url);
      if (!params.keepAlive) await page.waitForTimeout(1000);

      return ok(
        { title: params.title, published, url },
        [...tips, published ? '发布成功' : '已点击发布，请人工确认结果'],
      );
    },
  });
}
