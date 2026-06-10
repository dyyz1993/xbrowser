import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'wordpress',
    url: 'https://wordpress.com',
    description: 'WordPress.com SEO 外链 - 博客平台 (DA 93, dofollow)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const page = ctx.page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/log-in') || url.includes('/login')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
        if (!body) return false;
        if (body.includes('Log In')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  site.command('login', {
    description: '登录 WordPress.com',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      email: z.string().optional().describe('WordPress.com 邮箱'),
    }),
    examples: [
      { cmd: 'xbrowser wordpress login --email "user@example.com"', description: '登录 WordPress.com' },
    ],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://wordpress.com/log-in', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      if (params.email) {
        const emailInput = page.locator(
          'input[name="username"], input[type="email"], input[id="usernameOrEmail"]'
        ).first();
        if (await emailInput.isVisible().catch(() => false)) {
          await emailInput.fill(params.email);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Complete WordPress.com login',
        timeout: 300,
      });

      await page.goto('https://wordpress.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator('.masterbar__item-me, a[href*="/me"], [data-testid="sidebar-me"]')
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('wordpress_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'WordPress.com 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('publish', {
    description: '在 WordPress.com 发布文章（dofollow 外链）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（HTML 或纯文本）'),
      tags: z.string().optional().describe('标签，逗号分隔'),
      categories: z.string().optional().describe('分类，逗号分隔'),
    }),
    examples: [
      {
        cmd: 'xbrowser wordpress publish --title "Web Dev Guide" --content "<p>Visit <a href=\'https://example.com\'>my site</a></p>" --tags "web,dev"',
        description: '发布带外链的文章',
      },
    ],
    result: z.object({ title: z.string(), tags: z.string().optional(), categories: z.string().optional(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://wordpress.com/post/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(4000);

      const titleInput = page.locator(
        'h1[aria-label="Post title"], [aria-label="Add title"], h1.wp-block-post-title, textarea[placeholder*="Title"], [data-testid="post-title"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.click();
        await titleInput.fill(params.title);
        await page.keyboard.press('Enter');
      }

      const addBlock = page.locator(
        'button[aria-label="Add block"], [data-type="core/paragraph"], .block-editor-inserter__toggle'
      ).first();
      if (await addBlock.isVisible().catch(() => false)) {
        await addBlock.click().catch(() => {});
        await page.waitForTimeout(500);
      }

      const paragraphBlock = page.locator(
        '[data-type="core/paragraph"] [contenteditable], .wp-block-paragraph [contenteditable], p[contenteditable="true"]'
      ).first();
      if (await paragraphBlock.isVisible().catch(() => false)) {
        await paragraphBlock.click();
        await page.keyboard.insertText(params.content);
      }

      if (params.tags || params.categories) {
        const settingsBtn = page.locator(
          'button[aria-label="Settings"], button[aria-label="Post"], [data-testid="settings-button"]'
        ).first();
        if (await settingsBtn.isVisible().catch(() => false)) {
          await settingsBtn.click();
          await page.waitForTimeout(1000);

          if (params.tags) {
            const tagsInput = page.locator(
              'input[aria-label*="Tag"], input[placeholder*="tag"], input[name*="tags"]'
            ).first();
            if (await tagsInput.isVisible().catch(() => false)) {
              await tagsInput.fill(params.tags);
              await page.keyboard.press('Enter');
            }
          }

          if (params.categories) {
            const catInput = page.locator(
              'input[aria-label*="Category"], input[placeholder*="category"]'
            ).first();
            if (await catInput.isVisible().catch(() => false)) {
              await catInput.fill(params.categories);
              await page.keyboard.press('Enter');
            }
          }
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Review and publish post (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button:has-text("Publish"), button:has-text("发布"), [data-testid="publish-button"]'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(2000);

        const confirmBtn = page.locator(
          'button:has-text("Publish"), button:has-text("发布")'
        ).last();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
        }
      }

      return ok({
          title: params.title,
          tags: params.tags,
          categories: params.categories,
          url: page.url(),
        }, [`文章 "${params.title}" 已在 WordPress.com 发布`]);
    },
  });

  site.command('draft', {
    description: '在 WordPress.com 保存草稿',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（HTML 或纯文本）'),
    }),
    examples: [
      {
        cmd: 'xbrowser wordpress draft --title "Draft Post" --content "Draft content"',
        description: '保存为草稿',
      },
    ],
    result: z.object({ title: z.string(), saved: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://wordpress.com/post/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(4000);

      const titleInput = page.locator(
        'h1[aria-label="Post title"], [aria-label="Add title"], h1.wp-block-post-title'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.click();
        await titleInput.fill(params.title);
        await page.keyboard.press('Enter');
      }

      const paragraphBlock = page.locator(
        '[data-type="core/paragraph"] [contenteditable], .wp-block-paragraph [contenteditable], p[contenteditable="true"]'
      ).first();
      if (await paragraphBlock.isVisible().catch(() => false)) {
        await paragraphBlock.click();
        await page.keyboard.insertText(params.content);
      }

      const saveBtn = page.locator(
        'button:has-text("Save draft"), button:has-text("保存草稿"), [data-testid="save-draft"]'
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
    description: '更新 WordPress.com 个人资料（添加外链）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的 URL'),
      about: z.string().optional().describe('About me 文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser wordpress update-profile --url "https://example.com" --about "Developer"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.object({ url: z.string(), updated: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://wordpress.com/me', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      if (params.about) {
        const aboutInput = page.locator(
          'textarea[aria-label*="About"], textarea[name*="about"], textarea[placeholder*="About"]'
        ).first();
        if (await aboutInput.isVisible().catch(() => false)) {
          await aboutInput.fill(`${params.about}\n\n${params.url}`);
        }
      }

      const webInput = page.locator(
        'input[aria-label*="Website"], input[aria-label*="URL"], input[name*="website"], input[placeholder*="website"]'
      ).first();
      if (await webInput.isVisible().catch(() => false)) {
        await webInput.fill(params.url);
      }

      const saveBtn = page.locator(
        'button:has-text("Save"), button:has-text("保存"), button[type="submit"]'
      ).first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(2000);
      }

      return ok({ url: params.url, updated: true }, ['Profile 已更新，包含外链']);
    },
  });

  site.command('create-page', {
    description: '在 WordPress.com 创建静态页面（dofollow 外链）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('页面标题'),
      content: z.string().describe('页面内容（HTML 或纯文本）'),
    }),
    examples: [
      {
        cmd: 'xbrowser wordpress create-page --title "About Us" --content "<p>Visit <a href=\'https://example.com\'>our site</a></p>"',
        description: '创建带外链的静态页面',
      },
    ],
    result: z.object({ title: z.string(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://wordpress.com/page/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(4000);

      const titleInput = page.locator(
        'h1[aria-label="Page title"], [aria-label="Add title"], h1.wp-block-post-title'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.click();
        await titleInput.fill(params.title);
        await page.keyboard.press('Enter');
      }

      const paragraphBlock = page.locator(
        '[data-type="core/paragraph"] [contenteditable], .wp-block-paragraph [contenteditable], p[contenteditable="true"]'
      ).first();
      if (await paragraphBlock.isVisible().catch(() => false)) {
        await paragraphBlock.click();
        await page.keyboard.insertText(params.content);
      }

      await ctx.waitForHuman?.({
        reason: 'Review and publish page',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button:has-text("Publish"), button:has-text("发布")'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(2000);

        const confirmBtn = page.locator('button:has-text("Publish")').last();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
        }
      }

      return ok({
          title: params.title,
          url: page.url(),
        }, [`页面 "${params.title}" 已在 WordPress.com 发布`]);
    },
  });

  site.login(async (ctx) => {
    const page = ctx.page;
    if (!page) return;
    await page.goto('https://wordpress.com/log-in');
    await ctx.storage.set('wordpress_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('wordpress_login');
  });
}
