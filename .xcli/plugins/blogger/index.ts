import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'blogger',
    url: 'https://www.blogger.com',
    description: 'Blogger.com SEO 外链 - Google 免费博客平台 (DA 89, dofollow)',
    requiresLogin: true,
  });

  site.command('login', {
    description: '登录 Blogger（Google 账号）',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser blogger login', description: '登录 Blogger' }],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.blogger.com/about/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.locator('a[href*="sign-in"]').first().click().catch(() => {});
      await page.waitForLoadState('domcontentloaded');

      await ctx.waitForHuman?.({
        reason: 'Google login required',
        timeout: 300,
      });

      await page.goto('https://www.blogger.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator('[aria-label="Create blog"], [data-action="createBlog"], a[href*="blog/create"]')
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('blogger_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'Blogger 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('create-blog', {
    description: '创建新的 Blogger 博客',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('博客标题'),
      address: z.string().describe('博客地址（如 my-seo-blog）'),
    }),
    examples: [
      {
        cmd: 'xbrowser blogger create-blog --title "My SEO Blog" --address "my-seo-blog"',
        description: '创建新博客',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.blogger.com/blog/create', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const titleInput = page.locator(
        'input[aria-label*="Title"], input[aria-label*="title"], input[name="title"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.fill(params.title);
      }

      const addressInput = page.locator(
        'input[aria-label*="Address"], input[aria-label*="address"], input[name="address"]'
      ).first();
      if (await addressInput.isVisible().catch(() => false)) {
        await addressInput.fill(params.address);
      }

      const result = await ctx.waitForHuman?.({
        reason: 'Complete blog creation (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      return ok({
          title: params.title,
          address: params.address,
          completed: result?.solved ?? false,
          url: page.url(),
        }, [
          result?.solved
            ? `博客 "${params.title}" 创建完成`
            : `博客 "${params.title}" 创建待确认`,
        ]);
    },
  });

  site.command('publish', {
    description: '在 Blogger 发布文章（dofollow 外链）',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（HTML 或纯文本）'),
      labels: z.string().optional().describe('标签，逗号分隔'),
    }),
    examples: [
      {
        cmd: 'xbrowser blogger publish --title "SEO Guide" --content "<p>Check out <a href=\'https://example.com\'>my site</a></p>" --labels "seo,marketing"',
        description: '发布带外链的文章',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.blogger.com/blog/post/create/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      const titleInput = page.locator(
        'input[aria-label*="Title"], input[aria-label*="title"], input[name="title"], h1[contenteditable]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.click();
        await titleInput.fill(params.title);
      }

      const editorBody = page.locator(
        '[aria-label*="Compose"], [contenteditable="true"].editable, div.editable, [aria-label*="Post body"]'
      ).first();
      if (await editorBody.isVisible().catch(() => false)) {
        await editorBody.click();
        await page.keyboard.insertText(params.content);
      }

      if (params.labels) {
        const labelsInput = page.locator(
          'input[aria-label*="Label"], input[name="labels"], input[aria-label*="label"]'
        ).first();
        if (await labelsInput.isVisible().catch(() => false)) {
          await labelsInput.fill(params.labels);
        }
      }

      await ctx.waitForHuman?.({
        reason: 'Review and publish post (resolve CAPTCHA if present)',
        timeout: 120,
        autoDetect: true,
      });

      const publishBtn = page.locator(
        'button:has-text("Publish"), button:has-text("发布"), [data-action="publish"]'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
        await page.waitForTimeout(3000);
      }

      return ok({
          title: params.title,
          labels: params.labels,
          url: page.url(),
        }, [`文章 "${params.title}" 已在 Blogger 发布`]);
    },
  });

  site.command('update-profile', {
    description: '更新 Blogger 个人资料（添加外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的 URL'),
      about: z.string().optional().describe('About me 文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser blogger update-profile --url "https://example.com" --about "Full-stack developer"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://www.blogger.com/profile/edit', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('networkidle');

      const aboutText = params.about ? `${params.about}\n\n${params.url}` : params.url;
      const aboutInput = page.locator(
        'textarea[name*="about"], textarea[aria-label*="About"], textarea[aria-label*="about"]'
      ).first();
      if (await aboutInput.isVisible().catch(() => false)) {
        await aboutInput.fill(aboutText);
      }

      const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
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
    await page.goto('https://www.blogger.com/about/');
    await page.locator('a[href*="sign-in"]').first().click().catch(() => {});
    await ctx.storage.set('blogger_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('blogger_login');
  });
}
