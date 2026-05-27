import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'devto',
    url: 'https://dev.to',
    description: 'Dev.to SEO 外链 - 开发者社区 (DA 51, UGC/nofollow, 高流量)',
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
      const page = ctxAny.page as import('playwright-core').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/enter') || url.includes('/login')) return false;
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
    description: '登录 Dev.to（GitHub OAuth / 邮箱）',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser devto login', description: '登录 Dev.to' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://dev.to/enter', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      await ctx.waitForHuman?.({
        reason: 'Complete Dev.to login (GitHub OAuth or email)',
        timeout: 300,
      });

      await page.goto('https://dev.to/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator(
          'a[href*="/signout"], button[aria-label*="Sign Out"], [data-testid="user-menu"], .crayons-header--user-navigation'
        )
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('devto_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'Dev.to 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('publish', {
    description: '在 Dev.to 发布文章（Markdown，含外链）',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
      tags: z.string().optional().describe('标签，逗号分隔（最多4个）'),
    }),
    examples: [
      {
        cmd: 'xbrowser devto publish --title "My Guide" --content "# Hello\\nCheck [my site](https://example.com)" --tags "webdev,tutorial"',
        description: '发布带外链的 Markdown 文章',
      },
    ],
    result: z.object({ title: z.string(), tags: z.string().optional(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://dev.to/new', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const titleInput = page.locator(
        'input#article_title, input[name="article[title]"], input[placeholder*="Title"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.fill(params.title);
      }

      const bodyInput = page.locator(
        'textarea#article_body_markdown, textarea[name="article[body_markdown]"], textarea[placeholder*="Write"]'
      ).first();
      if (await bodyInput.isVisible().catch(() => false)) {
        await bodyInput.fill(params.content);
      }

      if (params.tags) {
        const tagsInput = page.locator(
          'input#article_tag_list, input[name="article[tag_list]"], input[placeholder*="tag"]'
        ).first();
        if (await tagsInput.isVisible().catch(() => false)) {
          await tagsInput.fill(params.tags);
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Review and publish article (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button[value="Publish"], button:has-text("Publish"), button:has-text("发布"), input[value="Publish"]'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(3000);
      }

      return ok({
          title: params.title,
          tags: params.tags,
          url: page.url(),
        }, [`文章 "${params.title}" 已在 Dev.to 发布`]);
    },
  });

  site.command('draft', {
    description: '在 Dev.to 保存草稿',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
    }),
    examples: [
      {
        cmd: 'xbrowser devto draft --title "Draft" --content "# Draft content"',
        description: '保存为草稿',
      },
    ],
    result: z.object({ title: z.string(), saved: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://dev.to/new', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const titleInput = page.locator(
        'input#article_title, input[name="article[title]"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.fill(params.title);
      }

      const bodyInput = page.locator(
        'textarea#article_body_markdown, textarea[name="article[body_markdown]"]'
      ).first();
      if (await bodyInput.isVisible().catch(() => false)) {
        await bodyInput.fill(params.content);
      }

      const saveBtn = page.locator(
        'button:has-text("Save draft"), button:has-text("保存草稿"), button[value="Save"]'
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
    description: '更新 Dev.to 个人资料（添加外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser devto update-profile --url "https://example.com" --bio "Full-stack developer"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.object({ url: z.string(), updated: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://dev.to/settings', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      if (params.bio) {
        const bioInput = page.locator(
          'textarea[name="user[summary]"], textarea[aria-label*="Bio"], textarea[placeholder*="bio"]'
        ).first();
        if (await bioInput.isVisible().catch(() => false)) {
          await bioInput.fill(`${params.bio}\n\n${params.url}`);
        }
      }

      const webInput = page.locator(
        'input[name="user[website_url]"], input[aria-label*="Website"], input[placeholder*="website"]'
      ).first();
      if (await webInput.isVisible().catch(() => false)) {
        await webInput.fill(params.url);
      }

      const submitBtn = page.locator(
        'button:has-text("Save"), button:has-text("保存"), input[type="submit"]'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      return ok({ url: params.url, updated: true }, ['Profile 已更新，包含外链']);
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
    if (!page) return;
    await page.goto('https://dev.to/enter');
    await ctx.storage.set('devto_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('devto_login');
  });
}
