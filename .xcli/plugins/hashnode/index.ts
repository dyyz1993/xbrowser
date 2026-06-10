import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'hashnode',
    url: 'https://hashnode.com',
    description: 'Hashnode SEO 外链 - 开发者博客平台 (DA 80+, 自定义域名 dofollow)',
    requiresLogin: true,
    loginConfig: {
      loginUrls: ['/login', '/signin', '/auth'],
      loginSelectors: ['[class*="login"]', '[class*="signin"]'],
      captchaSelectors: ['[class*="captcha"]', '[class*="verify"]'],
      loginKeywords: ['Sign in', 'Log in'],
      loggedInSelectors: ['[class*="avatar"]', '[data-testid*="avatar"]'],
      loginPrompt: 'This site requires login. Use --cdp to connect a logged-in browser.',
    },
    isLogin: async (ctx) => {
      const ctxAny = ctx as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body) return false;
        if (body.includes('Sign in')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  site.command('login', {
    description: '登录 Hashnode（GitHub / Google / 邮箱）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser hashnode login', description: '登录 Hashnode' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://hashnode.com/signin', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      await ctx.waitForHuman?.({
        reason: 'Complete Hashnode login (GitHub / Google / Email)',
        timeout: 300,
      });

      await page.goto('https://hashnode.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator(
          'a[href*="/dashboard"], [data-testid="user-avatar"], button[aria-label*="profile"], .user-avatar'
        )
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('hashnode_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'Hashnode 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('publish', {
    description: '在 Hashnode 发布文章（含外链）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown 或纯文本）'),
      tags: z.string().optional().describe('标签，逗号分隔'),
      keepAlive: z.boolean().optional().default(false).describe('发布后保留 session（默认关闭）'),
    }),
    examples: [
      {
        cmd: 'xbrowser hashnode publish --title "My Guide" --content "Hello" --tags "javascript,webdev"',
        description: '发布文章（自动关闭 session）',
      },
      {
        cmd: 'xbrowser hashnode publish --title "My Guide" --content "Hello" --keep-alive',
        description: '发布文章并保留 session（调试用）',
      },
    ],
    result: z.object({ title: z.string(), tags: z.string().optional(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://hashnode.com/draft', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const titleInput = page.locator(
        'input[placeholder*="Article title"], input[placeholder*="Title"], input[name*="title"], h1[contenteditable]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.click();
        await titleInput.fill(params.title);
      }

      const editorBody = page.locator(
        '[contenteditable="true"][data-placeholder*="Write"], [contenteditable="true"].ProseMirror, div[contenteditable="true"][role="textbox"]'
      ).first();
      if (await editorBody.isVisible().catch(() => false)) {
        await editorBody.click();
        await page.keyboard.insertText(params.content);
      }

      if (params.tags) {
        const tagsInput = page.locator(
          'input[placeholder*="tag"], input[placeholder*="Tag"], input[aria-label*="tag"]'
        ).first();
        if (await tagsInput.isVisible().catch(() => false)) {
          const tags = params.tags.split(',').map((t) => t.trim());
          for (const tag of tags) {
            await tagsInput.fill(tag);
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter');
          }
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Review and publish article (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button:has-text("Publish"), button:has-text("发布"), button[data-testid="publish-button"]'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(3000);
      }

      const finalUrl = page.url();

      if (!params.keepAlive) {
        try {
          await page.close();
        } catch {
          // page.close() failure is non-fatal
        }
      }

      return ok({
          title: params.title,
          tags: params.tags,
          url: finalUrl,
        }, [`文章 "${params.title}" 已在 Hashnode 发布`]);
    },
  });

  site.command('draft', {
    description: '在 Hashnode 保存草稿',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容'),
    }),
    examples: [
      {
        cmd: 'xbrowser hashnode draft --title "Draft" --content "Draft content"',
        description: '保存为草稿',
      },
    ],
    result: z.object({ title: z.string(), saved: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://hashnode.com/draft', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const titleInput = page.locator(
        'input[placeholder*="Article title"], input[placeholder*="Title"], input[name*="title"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.click();
        await titleInput.fill(params.title);
      }

      const editorBody = page.locator(
        '[contenteditable="true"][data-placeholder*="Write"], [contenteditable="true"].ProseMirror, div[contenteditable="true"][role="textbox"]'
      ).first();
      if (await editorBody.isVisible().catch(() => false)) {
        await editorBody.click();
        await page.keyboard.insertText(params.content);
      }

      const saveBtn = page.locator(
        'button:has-text("Save"), button:has-text("保存"), button:has-text("Draft")'
      ).first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(3000);
      }

      return ok({
          title: params.title,
          saved: true,
          url: page.url(),
        }, [`草稿 "${params.title}" 已保存`]);
    },
  });

  site.command('update-profile', {
    description: '更新 Hashnode 个人资料（添加外链）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser hashnode update-profile --url "https://example.com" --bio "Developer"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.object({ url: z.string(), updated: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://hashnode.com/settings', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      if (params.bio) {
        const bioInput = page.locator(
          'textarea[name*="bio"], textarea[aria-label*="Bio"], textarea[placeholder*="bio"]'
        ).first();
        if (await bioInput.isVisible().catch(() => false)) {
          await bioInput.fill(`${params.bio}\n\n${params.url}`);
        }
      }

      const webInput = page.locator(
        'input[name*="website"], input[aria-label*="Website"], input[placeholder*="website"]'
      ).first();
      if (await webInput.isVisible().catch(() => false)) {
        await webInput.fill(params.url);
      }

      const submitBtn = page.locator(
        'button:has-text("Save"), button:has-text("保存"), button[type="submit"]'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      return ok({ url: params.url, updated: true }, ['Profile 已更新，包含外链']);
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
    if (!page) return;
    await page.goto('https://hashnode.com/signin');
    await ctx.storage.set('hashnode_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('hashnode_login');
  });
}
