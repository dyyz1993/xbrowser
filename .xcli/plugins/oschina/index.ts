import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import { randomPause, humanFill } from '../shared/humanize.js';

function resolvePage(ctx: CommandContext): { page: Page; tips: string[] } {
  const page = ctx.page;
  if (!page) throw new Error('需要浏览器页面');
  const tips: string[] = [];
  if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
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
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '') as string;
        return body.length > 50 && !body.includes('登录注册');
      } catch { return true; }
    },
  });

  site.command('login', {
    description: '登录 开源中国（打开登录页等待人工完成）',
    loginRequired: 'none', scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser oschina login', description: '登录 oschina' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const { page } = resolvePage(ctx);
      await page.goto('https://www.oschina.net/home/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await randomPause(1200, 2400);
      await ctx.waitForHuman?.({ reason: '完成 开源中国 登录（手机号验证码/Gitee OAuth）', timeout: 300 });
      await page.goto('https://my.oschina.net', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const loggedIn = !(await page.url()).includes('/login');
      return ok({ loggedIn, url: page.url() }, [loggedIn ? '开源中国登录成功' : '仍未登录']);
    },
  });

  site.command('draft', {
    description: '在 开源中国 保存博客草稿',
    loginRequired: 'required', scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
    }),
    result: z.object({ title: z.string(), saved: z.boolean(), url: z.string() }).passthrough(),
    examples: [{ cmd: 'xbrowser oschina draft --title "T" --file a.md', description: '保存草稿' }],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);
      let content = params.content || '';
      if (!content && params.file) { const { readFileSync } = await import('node:fs'); content = readFileSync(params.file, 'utf8'); }
      if (!content) return fail('必须提供 --content 或 --file 参数');

      await page.goto('https://my.oschina.net/u/xxx/blog/write', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.goto('https://www.oschina.net/blog/write', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded');
      await randomPause(1500, 3000);

      const titleInput = page.locator('input[name="title"], #blogTitle, input[placeholder*="标题"]').first();
      if (!(await titleInput.isVisible().catch(() => false))) return fail('标题输入框未找到');
      await humanFill(page, titleInput, params.title);
      await randomPause(500, 1000);
      const bodyArea = page.locator('#blogContent, textarea[name="content"], .CodeMirror, textarea').first();
      if (!(await bodyArea.isVisible().catch(() => false))) return fail('正文编辑器未找到');
      await humanFill(page, bodyArea, content);

      return ok({ title: params.title, saved: true, url: page.url() }, [...tips, '内容已填入编辑器']);
    },
  });

  site.command('publish', {
    description: '在 开源中国 发布博客文章',
    loginRequired: 'required', scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
      keepAlive: z.boolean().optional().default(false).describe('发布后保留 session'),
    }),
    result: z.object({ title: z.string(), published: z.boolean(), url: z.string() }).passthrough(),
    examples: [{ cmd: 'xbrowser oschina publish --title "T" --file a.md', description: '发布文章' }],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);
      let content = params.content || '';
      if (!content && params.file) { const { readFileSync } = await import('node:fs'); content = readFileSync(params.file, 'utf8'); }
      if (!content) return fail('必须提供 --content 或 --file 参数');

      await page.goto('https://www.oschina.net/blog/write', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded');
      await randomPause(1500, 3000);

      const titleInput = page.locator('input[name="title"], #blogTitle, input[placeholder*="标题"]').first();
      if (!(await titleInput.isVisible().catch(() => false))) return fail('标题输入框未找到');
      await humanFill(page, titleInput, params.title);
      await randomPause(500, 1000);
      const bodyArea = page.locator('#blogContent, textarea[name="content"], .CodeMirror, textarea').first();
      if (!(await bodyArea.isVisible().catch(() => false))) return fail('正文编辑器未找到');
      await humanFill(page, bodyArea, content);
      await randomPause(800, 1500);

      const pubBtn = page.locator('button:has-text("发布"), input[value="发布"]').first();
      if (!(await pubBtn.isVisible().catch(() => false))) return fail('发布按钮未找到');
      await pubBtn.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await randomPause(3000, 5000);
      const url = page.url();
      const published = /\/blog\/\d+/.test(url);
      if (!params.keepAlive) await page.waitForTimeout(1000);
      return ok({ title: params.title, published, url }, [...tips, published ? '发布成功' : '已点击发布，请人工确认']);
    },
  });
}
