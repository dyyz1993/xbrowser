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
    name: 'segmentfault',
    url: 'https://segmentfault.com',
    description: 'SegmentFault 思否 - 中文技术问答/博客平台 (DA 70+, 技术内容权重高)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as Page | undefined;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/user/login')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '') as string;
        if (!body) return false;
        if (body.includes('登录') && body.includes('注册')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  site.command('login', {
    description: '登录 SegmentFault（打开登录页等待人工完成）',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser segmentfault login', description: '登录 SegmentFault' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const { page } = resolvePage(ctx);
      await page.goto('https://segmentfault.com/user/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomPause(1200, 2400);
      await ctx.waitForHuman?.({ reason: '完成 SegmentFault 登录（GitHub OAuth / 手机号）', timeout: 300 });
      await page.goto('https://segmentfault.com/user', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const loggedIn = !(await page.url()).includes('/user/login');
      return ok({ loggedIn, url: page.url() }, [loggedIn ? '思否登录成功' : '仍未登录，请检查']);
    },
  });

  // 写作页：https://segmentfault.com/write（富文本/Markdown 编辑器，标题 input[name=title]）
  site.command('draft', {
    description: '在 SegmentFault 保存文章草稿',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
      tags: z.string().optional().describe('标签，逗号分隔（最多 3 个）'),
    }),
    examples: [
      { cmd: 'xbrowser segmentfault draft --title "T" --file article.md --tags "前端,自动化"', description: '保存草稿' },
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

      await page.goto('https://segmentfault.com/write', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded');
      await randomPause(1500, 3000);

      if ((await page.url()).includes('/user/login')) {
        return fail('未登录：先跑 xbrowser segmentfault login');
      }

      const titleSel = 'input[name="title"], #title, input[placeholder*="标题"]';
      const titleInput = page.locator(titleSel).first();
      if (!(await titleInput.isVisible().catch(() => false))) {
        return fail('标题输入框未找到', ['写作页结构可能变化，请人工检查 segmentfault.com/write']);
      }
      await humanFill(page, titleInput, params.title);

      // 正文：CodeMirror（Markdown 模式）或 textarea
      const cm = await page.$('.CodeMirror');
      if (cm) {
        await page.evaluate(() => {
          const el = document.querySelector('.CodeMirror') as unknown as { CodeMirror: { setValue: (v: string) => void } } | null;
          el?.CodeMirror?.setValue('');
        });
        const { keyboard } = page;
        await keyboard.press('Control+z').catch(() => {});
        const bodySel = '.CodeMirror textarea, .CodeMirror-code';
        const bodyArea = page.locator(bodySel).first();
        await humanFill(page, bodyArea, content);
      } else {
        const bodyInput = page.locator('textarea[name="blog"], .editor textarea, textarea').first();
        if (!(await bodyInput.isVisible().catch(() => false))) {
          return fail('正文编辑器未找到');
        }
        await humanFill(page, bodyInput, content);
      }

      // 标签（可选）：tag-input
      if (params.tags) {
        for (const tag of params.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 3)) {
          const tagInput = page.locator('#tags, input[name="tags"], input[placeholder*="标签"]').first();
          if (await tagInput.isVisible().catch(() => false)) {
            await humanFill(page, tagInput, tag);
            await page.keyboard.press('Enter').catch(() => {});
            await randomPause(400, 900);
          }
        }
      }

      // 保存草稿
      const saveBtn = page.locator('button:has-text("保存"), button:has-text("存草稿")').first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click().catch(() => {});
        await randomPause(2000, 4000);
      }

      return ok({ title: params.title, saved: true, url: page.url() }, [
        ...tips,
        '草稿已提交（思否草稿保存在编辑器内自动进行，请到 segmentfault.com/drafts 确认）',
      ]);
    },
  });

  site.command('publish', {
    description: '在 SegmentFault 发布文章（自动上传 Markdown 中的本地图片）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
      tags: z.string().optional().describe('标签，逗号分隔（最多 3 个）'),
      keepAlive: z.boolean().optional().default(false).describe('发布后保留 session'),
    }),
    examples: [
      { cmd: 'xbrowser segmentfault publish --title "T" --file article.md', description: '发布文章' },
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

      await page.goto('https://segmentfault.com/write', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded');
      await randomPause(1500, 3000);

      if ((await page.url()).includes('/user/login')) {
        return fail('未登录：先跑 xbrowser segmentfault login');
      }

      const titleInput = page.locator('input[name="title"], #title, input[placeholder*="标题"]').first();
      if (!(await titleInput.isVisible().catch(() => false))) {
        return fail('标题输入框未找到');
      }
      await humanFill(page, titleInput, params.title);

      const cm = await page.$('.CodeMirror');
      if (cm) {
        const bodyArea = page.locator('.CodeMirror textarea, .CodeMirror-code').first();
        await humanFill(page, bodyArea, content);
      } else {
        const bodyInput = page.locator('textarea[name="blog"], .editor textarea, textarea').first();
        await humanFill(page, bodyInput, content);
      }

      if (params.tags) {
        for (const tag of params.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 3)) {
          const tagInput = page.locator('#tags, input[name="tags"], input[placeholder*="标签"]').first();
          if (await tagInput.isVisible().catch(() => false)) {
            await humanFill(page, tagInput, tag);
            await page.keyboard.press('Enter').catch(() => {});
            await randomPause(400, 900);
          }
        }
      }

      const publishBtn = page.locator('button:has-text("发布")').first();
      if (!(await publishBtn.isVisible().catch(() => false))) {
        return fail('发布按钮未找到');
      }
      await publishBtn.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await randomPause(3000, 5000);

      const url = page.url();
      const published = /\/(a|blog)\//.test(url) || /__\d+/.test(url);
      if (!params.keepAlive) await page.waitForTimeout(1000);

      return ok(
        { title: params.title, published, url },
        [...tips, published ? '发布成功' : '已点击发布，请人工确认结果'],
      );
    },
  });
}
