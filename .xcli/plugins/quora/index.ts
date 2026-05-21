import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'quora',
    url: 'https://www.quora.com',
    description: 'Quora SEO 外链 - 问答平台 (DA 92, nofollow, 136M 月流量)',
    requiresLogin: true,
  });

  site.command('login', {
    description: '登录 Quora（Google / 邮箱）',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser quora login', description: '登录 Quora' }],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.quora.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      await ctx.waitForHuman?.({
        reason: 'Complete Quora login (Google OAuth or email)',
        timeout: 300,
      });

      await page.goto('https://www.quora.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator(
          'a[href*="/logout"], button[aria-label*="Profile"], [class*="avatar"], [data-testid="user-menu"], img[class*="profile"]'
        )
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('quora_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'Quora 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('answer', {
    description: '回答问题（含外链）',
    scope: 'page',
    parameters: z.object({
      questionUrl: z.string().describe('问题页面 URL'),
      content: z.string().describe('回答内容（含外链）'),
    }),
    examples: [
      {
        cmd: 'xbrowser quora answer --questionUrl "https://www.quora.com/What-is-the-best-tool" --content "I recommend https://example.com - it\'s the best tool"',
        description: '回答问题并插入外链',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto(params.questionUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      const answerBtn = page.locator(
        'button:has-text("Answer"), a:has-text("Answer"), [data-testid="answer-button"], button[class*="Answer"]'
      ).first();
      if (await answerBtn.isVisible().catch(() => false)) {
        await answerBtn.click();
        await page.waitForTimeout(2000);
      }

      const editor = page.locator(
        'div[contenteditable="true"][class*="editor"], div[contenteditable="true"][data-testid*="answer"], div[class*="quill"], div[contenteditable="true"][role="textbox"]'
      ).first();
      if (await editor.isVisible().catch(() => false)) {
        await editor.click();
        await page.keyboard.insertText(params.content);
      }

      await ctx.waitForHuman?.({
        reason: 'Review answer and submit (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const submitBtn = page.locator(
        'button:has-text("Submit"), button:has-text("Post"), button:has-text("提交"), button[type="submit"]'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }

      return ok({
          questionUrl: params.questionUrl,
          answered: true,
          url: page.url(),
        }, [`回答已发布在 ${params.questionUrl}`]);
    },
  });

  site.command('publish-article', {
    description: '创建 Quora 文章（Space 帖子）',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（含外链）'),
    }),
    examples: [
      {
        cmd: 'xbrowser quora publish-article --title "My Guide" --content "Check out https://example.com for details"',
        description: '在 Quora 发布文章',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.quora.com/content', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      const titleInput = page.locator(
        'input[name*="title"], input[placeholder*="title"], input[placeholder*="Title"], input[class*="title"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.fill(params.title);
      }

      const editor = page.locator(
        'div[contenteditable="true"][class*="editor"], div[contenteditable="true"][role="textbox"], div[class*="quill"]'
      ).first();
      if (await editor.isVisible().catch(() => false)) {
        await editor.click();
        await page.keyboard.insertText(params.content);
      }

      await ctx.waitForHuman?.({
        reason: 'Review article and publish (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button:has-text("Publish"), button:has-text("Post"), button:has-text("发布"), button[type="submit"]'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(3000);
      }

      return ok({
          title: params.title,
          url: page.url(),
        }, [`文章 "${params.title}" 已在 Quora 发布`]);
    },
  });

  site.command('update-profile', {
    description: '更新 Quora 个人资料（添加外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的网站 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser quora update-profile --url "https://example.com" --bio "Software developer"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.quora.com/settings', {
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
        'button:has-text("Save"), button:has-text("Update"), button[type="submit"]'
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
    await page.goto('https://www.quora.com/login');
    await ctx.storage.set('quora_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('quora_login');
  });
}
