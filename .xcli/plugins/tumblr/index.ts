import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'tumblr',
    url: 'https://www.tumblr.com',
    description: 'Tumblr SEO 外链 - 博客平台 (DA 86, dofollow)',
    requiresLogin: true,
  });

  site.command('login', {
    description: '登录 Tumblr',
    scope: 'browser',
    parameters: z.object({
      email: z.string().optional().describe('Tumblr 邮箱'),
    }),
    examples: [{ cmd: 'xbrowser tumblr login --email "user@example.com"', description: '登录 Tumblr' }],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.tumblr.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      if (params.email) {
        const emailInput = page.locator(
          'input[name="email"], input[type="email"], input[aria-label*="email"]'
        ).first();
        if (await emailInput.isVisible().catch(() => false)) {
          await emailInput.fill(params.email);
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Complete Tumblr login',
        timeout: 300,
      });

      await page.goto('https://www.tumblr.com/dashboard', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator('[aria-label="Account"], [data-testid="user-avatar"], .account-avatar')
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('tumblr_login', { loggedIn, at: Date.now() });

      return {
        data: { loggedIn, url: page.url() },
        tips: [loggedIn ? 'Tumblr 登录成功' : '登录可能未完成，请检查页面'],
      };
    },
  });

  site.command('publish', {
    description: '在 Tumblr 发布文章（dofollow 外链）',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（HTML 或纯文本）'),
      tags: z.string().optional().describe('标签，逗号分隔'),
    }),
    examples: [
      {
        cmd: 'xbrowser tumblr publish --title "SEO Tips" --content "<p>Visit <a href=\'https://example.com\'>my site</a></p>" --tags "seo,marketing"',
        description: '发布带外链的 Text Post',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.tumblr.com/new/text', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      const titleInput = page.locator(
        '[aria-label="Title"], [placeholder*="Title"], input[name*="title"], [data-testid="post-title"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.click();
        await titleInput.fill(params.title);
      }

      const editorBody = page.locator(
        '[aria-label="Post body"], [contenteditable="true"], [data-testid="post-content"], .editor'
      ).first();
      if (await editorBody.isVisible().catch(() => false)) {
        await editorBody.click();
        await page.keyboard.insertText(params.content);
      }

      if (params.tags) {
        const tagsInput = page.locator(
          'input[aria-label*="Tag"], input[placeholder*="tag"], input[name*="tags"]'
        ).first();
        if (await tagsInput.isVisible().catch(() => false)) {
          await tagsInput.fill(params.tags);
          await page.keyboard.press('Enter');
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Review and publish post (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const postBtn = page.locator(
        'button[aria-label="Post"], button:has-text("Post"), button:has-text("Publish"), [data-testid="post-button"]'
      ).first();
      if (await postBtn.isVisible().catch(() => false)) {
        await postBtn.click();
        await page.waitForTimeout(3000);
      }

      return {
        data: {
          title: params.title,
          tags: params.tags,
          url: page.url(),
        },
        tips: [`文章 "${params.title}" 已在 Tumblr 发布`],
      };
    },
  });

  site.command('update-profile', {
    description: '更新 Tumblr 博客描述（添加外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的 URL'),
      description: z.string().optional().describe('博客描述文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser tumblr update-profile --url "https://example.com" --description "Tech blog"',
        description: '更新博客描述添加外链',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.tumblr.com/settings/blog', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const descText = params.description
        ? `${params.description}\n\n${params.url}`
        : params.url;

      const descInput = page.locator(
        'textarea[aria-label*="Description"], textarea[name*="description"], textarea[placeholder*="description"]'
      ).first();
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill(descText);
      }

      const submitBtn = page.locator(
        'button:has-text("Save"), button:has-text("保存"), button[type="submit"]'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      return {
        data: { url: params.url, updated: true },
        tips: ['博客描述已更新，包含外链'],
      };
    },
  });

  site.command('reblog', {
    description: 'Reblog 一篇帖子并添加评论（含外链）',
    scope: 'browser',
    parameters: z.object({
      postUrl: z.string().describe('要 reblog 的帖子 URL'),
      comment: z.string().describe('Reblog 评论内容（可含 HTML 外链）'),
    }),
    examples: [
      {
        cmd: 'xbrowser tumblr reblog --post-url "https://example.tumblr.com/post/123" --comment "Great post! <a href=\'https://mysite.com\'>My Site</a>"',
        description: 'Reblog 并添加含外链的评论',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto(params.postUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const reblogBtn = page.locator(
        '[aria-label="Reblog"], [data-testid="reblog-button"], a[href*="reblog"], button:has-text("Reblog")'
      ).first();
      if (await reblogBtn.isVisible().catch(() => false)) {
        await reblogBtn.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      }

      const commentInput = page.locator(
        '[contenteditable="true"], [aria-label="Post body"], textarea[name*="content"]'
      ).first();
      if (await commentInput.isVisible().catch(() => false)) {
        await commentInput.click();
        await page.keyboard.insertText(params.comment);
      }

      await ctx.waitForHuman?.({
        reason: 'Review and publish reblog',
        timeout: 120,
        autoDetect: true,
      });

      const postBtn = page.locator(
        'button[aria-label="Post"], button:has-text("Post"), button:has-text("Publish"), [data-testid="post-button"]'
      ).first();
      if (await postBtn.isVisible().catch(() => false)) {
        await postBtn.click();
        await page.waitForTimeout(3000);
      }

      return {
        data: {
          postUrl: params.postUrl,
          url: page.url(),
        },
        tips: ['Reblog 已发布'],
      };
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
    if (!page) return;
    await page.goto('https://www.tumblr.com/login');
    await ctx.storage.set('tumblr_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('tumblr_login');
  });
}
