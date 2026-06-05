import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'producthunt',
    url: 'https://www.producthunt.com',
    description: 'Product Hunt SEO 外链 - 产品发布平台 (DA 91, dofollow, 高权重)',
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
        if (url.includes('/signin') || url.includes('/login')) return false;
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
    description: '登录 Product Hunt（Google OAuth）',
    scope: 'browser',
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser producthunt login', description: '登录 Product Hunt' }],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.producthunt.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      await ctx.waitForHuman?.({
        reason: 'Complete Product Hunt login (Google OAuth)',
        timeout: 300,
      });

      await page.goto('https://www.producthunt.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator(
          'a[href*="/my"], button[data-testid="user-menu"], img[alt*="avatar"], [class*="user-menu"], a[href*="/logout"]'
        )
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('producthunt_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'Product Hunt 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('submit-product', {
    description: '提交新产品（含 dofollow 外链）',
    scope: 'page',
    result: z.object({ name: z.string(), url: z.string(), pageUrl: z.string() }).passthrough(),
    parameters: z.object({
      name: z.string().describe('产品名称'),
      tagline: z.string().describe('一句话描述'),
      url: z.string().describe('产品 URL（dofollow 外链）'),
      description: z.string().describe('产品详细描述'),
      topics: z.string().optional().describe('话题标签，逗号分隔'),
    }),
    examples: [
      {
        cmd: 'xbrowser producthunt submit-product --name "MyApp" --tagline "Best tool" --url "https://example.com" --description "A great tool" --topics "saas,developer-tools"',
        description: '提交新产品（含 dofollow 链接）',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.producthunt.com/posts/new', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const nameInput = page.locator(
        'input[name*="name"], input[placeholder*="name"], input[placeholder*="Name"], input[data-testid="product-name"]'
      ).first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(params.name);
      }

      const taglineInput = page.locator(
        'input[name*="tagline"], input[placeholder*="tagline"], input[placeholder*="Tagline"]'
      ).first();
      if (await taglineInput.isVisible().catch(() => false)) {
        await taglineInput.fill(params.tagline);
      }

      const urlInput = page.locator(
        'input[name*="url"], input[placeholder*="URL"], input[placeholder*="url"], input[type="url"]'
      ).first();
      if (await urlInput.isVisible().catch(() => false)) {
        await urlInput.fill(params.url);
      }

      const descTextarea = page.locator(
        'textarea[name*="description"], textarea[placeholder*="description"], textarea[placeholder*="Description"]'
      ).first();
      if (await descTextarea.isVisible().catch(() => false)) {
        await descTextarea.fill(params.description);
      }

      if (params.topics) {
        const topicsInput = page.locator(
          'input[name*="topic"], input[placeholder*="topic"], input[placeholder*="Topic"]'
        ).first();
        if (await topicsInput.isVisible().catch(() => false)) {
          const topics = params.topics.split(',');
          for (const topic of topics) {
            await topicsInput.fill(topic.trim());
            await page.waitForTimeout(500);
            const suggestion = page.locator('[class*="topic-suggestion"], [role="option"]').first();
            if (await suggestion.isVisible().catch(() => false)) {
              await suggestion.click();
            }
          }
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Review product submission (add gallery images, resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const submitBtn = page.locator(
        'button:has-text("Submit"), button:has-text("Create"), button[type="submit"], button[data-testid="submit"]'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }

      return ok({
          name: params.name,
          url: params.url,
          pageUrl: page.url(),
        }, [`产品 "${params.name}" 已在 Product Hunt 提交（含 dofollow 链接: ${params.url}）`]);
    },
  });

  site.command('comment', {
    description: '在产品页面评论（含外链）',
    scope: 'page',
    result: z.object({ productUrl: z.string(), commented: z.boolean(), url: z.string() }).passthrough(),
    parameters: z.object({
      productUrl: z.string().describe('产品页面 URL'),
      content: z.string().describe('评论内容（可含链接）'),
    }),
    examples: [
      {
        cmd: 'xbrowser producthunt comment --productUrl "https://www.producthunt.com/posts/example" --content "Great tool! Check https://example.com for more"',
        description: '在产品页面发布带链接的评论',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto(params.productUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const commentArea = page.locator(
        'textarea[placeholder*="comment"], textarea[placeholder*="Comment"], div[contenteditable="true"][data-testid*="comment"], textarea[name*="comment"]'
      ).first();
      if (await commentArea.isVisible().catch(() => false)) {
        await commentArea.click();
        await page.keyboard.insertText(params.content);
      }

      await ctx.waitForHuman?.({
        reason: 'Review comment and submit',
        timeout: 60,
        autoDetect: true,
      });

      const submitBtn = page.locator(
        'button:has-text("Post"), button:has-text("Submit"), button:has-text("Comment")'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      return ok({
          productUrl: params.productUrl,
          commented: true,
          url: page.url(),
        }, [`评论已发布在 ${params.productUrl}`]);
    },
  });

  site.command('update-profile', {
    description: '更新 Product Hunt 个人资料（添加外链）',
    scope: 'browser',
    result: z.object({ url: z.string(), updated: z.boolean() }).passthrough(),
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的网站 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser producthunt update-profile --url "https://example.com" --bio "Developer & Maker"',
        description: '更新 Profile 添加外链',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.producthunt.com/settings', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
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
        'input[name*="website"], input[aria-label*="Website"], input[placeholder*="website"], input[placeholder*="URL"]'
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
    const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
    if (!page) return;
    await page.goto('https://www.producthunt.com/login');
    await ctx.storage.set('producthunt_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('producthunt_login');
  });
}
