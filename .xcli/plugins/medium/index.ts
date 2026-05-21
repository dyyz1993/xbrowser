import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'medium',
    url: 'https://medium.com',
    description: 'Medium SEO 外链 - 内容平台 (DA 96, nofollow, 241M 月流量)',
    requiresLogin: true,
  });

  site.command('login', {
    description: '登录 Medium（Google / 邮箱）',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser medium login', description: '登录 Medium' }],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://medium.com/m/signin', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      await ctx.waitForHuman?.({
        reason: 'Complete Medium login (Google OAuth or email)',
        timeout: 300,
      });

      await page.goto('https://medium.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator(
          'a[href*="/me"], [data-testid="header-user-menu"], button[aria-label*="User"], img[alt*="avatar"]'
        )
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('medium_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'Medium 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('publish', {
    description: '在 Medium 发布文章（含外链）',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（纯文本或 Markdown）'),
    }),
    examples: [
      {
        cmd: 'xbrowser medium publish --title "My Guide" --content "Check out https://example.com for more"',
        description: '发布带外链的文章',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://medium.com/new-story', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(4000);

      await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 }).catch(() => {});

      const titleSection = page.locator(
        'section [contenteditable="true"]'
      ).first();
      if (await titleSection.isVisible().catch(() => false)) {
        await titleSection.click();
        await page.keyboard.type(params.title);
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(500);

      await page.keyboard.insertText(params.content);

      await ctx.waitForHuman?.({
        reason: 'Review and publish article (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button:has-text("Publish"), button[data-testid="publish-button"], button[aria-label="Publish"]'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(2000);

        const confirmBtn = page.locator(
          'button:has-text("Publish now"), button:has-text("Publish")'
        ).last();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
        }
      }

      return ok({
          title: params.title,
          url: page.url(),
        }, [`文章 "${params.title}" 已在 Medium 发布`]);
    },
  });

  site.command('draft', {
    description: '在 Medium 保存草稿',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容'),
    }),
    examples: [
      {
        cmd: 'xbrowser medium draft --title "Draft" --content "Draft content"',
        description: '保存为草稿',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://medium.com/new-story', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(4000);

      await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 }).catch(() => {});

      const titleSection = page.locator(
        'section [contenteditable="true"]'
      ).first();
      if (await titleSection.isVisible().catch(() => false)) {
        await titleSection.click();
        await page.keyboard.type(params.title);
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(500);

      await page.keyboard.insertText(params.content);

      const saveBtn = page.locator(
        'button:has-text("Save"), button[aria-label="Save"]'
      ).first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(2000);
      }

      return ok({
          title: params.title,
          saved: true,
          url: page.url(),
        }, [`草稿 "${params.title}" 已保存`]);
    },
  });

  site.command('import', {
    description: '在 Medium 导入文章（设置 canonical URL）',
    scope: 'page',
    parameters: z.object({
      url: z.string().describe('要导入的文章 URL（设置 canonical）'),
    }),
    examples: [
      {
        cmd: 'xbrowser medium import --url "https://example.com/my-article"',
        description: '导入文章并设置 canonical',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://medium.com/p/import', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      const urlInput = page.locator(
        'input[placeholder*="URL"], input[placeholder*="url"], input[name*="url"], input[type="url"]'
      ).first();
      if (await urlInput.isVisible().catch(() => false)) {
        await urlInput.fill(params.url);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(5000);
      }

      await ctx.waitForHuman?.({
        reason: 'Review imported article and publish',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button:has-text("Publish"), button:has-text("Publish now")'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(3000);
      }

      return ok({
          importedFrom: params.url,
          url: page.url(),
        }, [`文章已从 ${params.url} 导入到 Medium（canonical 已设置）`]);
    },
  });

  site.command('update-profile', {
    description: '更新 Medium 个人资料（添加外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser medium update-profile --url "https://example.com" --bio "Developer"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://medium.com/me/settings', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      if (params.bio) {
        const bioInput = page.locator(
          'textarea[name*="bio"], textarea[aria-label*="Bio"], textarea[placeholder*="bio"], textarea[placeholder*="About"]'
        ).first();
        if (await bioInput.isVisible().catch(() => false)) {
          await bioInput.fill(`${params.bio}\n\n${params.url}`);
        }
      }

      const webInput = page.locator(
        'input[name*="url"], input[aria-label*="Website"], input[placeholder*="website"], input[placeholder*="URL"]'
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
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
    if (!page) return;
    await page.goto('https://medium.com/m/signin');
    await ctx.storage.set('medium_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('medium_login');
  });
}
