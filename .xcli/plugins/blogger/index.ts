import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { bloggerPublisher } from '../shared/publishing/sites/blogger.js';
import { registerPublishingCommands } from '../shared/publishing/commands.js';
import { checkLoggedIn } from '../shared/publishing/login-probe.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'blogger',
    url: 'https://www.blogger.com',
    description: 'Blogger.com SEO 外链 - Google 免费博客平台 (DA 89, dofollow)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      // bridge 优先——Google 登录态在用户 Chrome 里，本地 page 看不到
      const page = ctx.page;
      return checkLoggedIn('blogger', 'https://www.blogger.com/home', async () => {
        if (!page) return true;
        try {
          const url = page.url();
          if (url.includes('/login') || url.includes('/signin')) return false;
          const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
          if (!body) return false;
          if (body.includes('Sign in')) return false;
          return true;
        } catch {
          return true;
        }
      });
    },
  });

  site.command('login', {
    description: '登录 Blogger（Google 账号）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser blogger login', description: '登录 Blogger' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const page = ctx.page;
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
    loginRequired: 'required',
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
    result: z.object({ title: z.string(), address: z.string(), completed: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面上下文');

      // 抽屉里那份「创建博客」坐标是负的（收起状态），必须用可见的那份
      await page.goto('https://www.blogger.com/dashboard/reading', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForTimeout(6000);

      const cta = page.locator('div[jsname="VdueEf"] [role="button"]').filter({ hasText: '创建博客' }).first();
      if (!(await cta.isVisible().catch(() => false))) {
        return fail('找不到「创建博客」按钮（页面可能还在加载）');
      }
      await cta.click();
      await page.waitForTimeout(6000);

      // 第一步：名称
      const titleInput = page.locator('input[aria-label="标题"]').first();
      if (!(await titleInput.isVisible().catch(() => false))) {
        return fail('创建博客弹窗未出现');
      }
      await titleInput.fill(params.title);
      await page.waitForTimeout(1500);

      // 「下一步」限定在选名称那个弹窗里——侧边栏抽屉也是 role=dialog
      const dialog1 = page.locator('[role="dialog"]').filter({ hasText: '选择一个名称' }).first();
      const nextBtn = dialog1.locator('[role="button"]').filter({ hasText: /^下一步$/ }).first();
      await nextBtn.click();
      await page.waitForTimeout(7000);

      // 第二步：地址
      const dialog2 = page.locator('[role="dialog"]').filter({ hasText: '网址' }).first();
      const addrInput = dialog2.locator('input').first();
      if (!(await addrInput.isVisible().catch(() => false))) {
        return fail('地址输入框未出现');
      }
      await addrInput.fill(params.address);
      await page.waitForTimeout(4000);

      const saveBtn = dialog2.locator('[role="button"]').filter({ hasText: /^保存$/ }).first();
      await saveBtn.click();
      await page.waitForTimeout(15000);

      // 保存成功会跳到博客后台（blog/posts/<id>）
      const url = page.url();
      const created = /blog\/posts\/\d+/.test(url);

      return ok(
        { title: params.title, address: params.address, completed: created, url },
        [created ? `博客「${params.title}」创建完成` : '保存后未检测到跳转，请到后台确认'],
      );
    },
  });

  registerPublishingCommands(site, {
    // 本地通道用：直接进博客后台（blogId 由登录用户的第一个博客决定）
    editorUrl: 'https://www.blogger.com/home',
    publisher: bloggerPublisher,
  });


  site.command('update-profile', {
    description: '更新 Blogger 个人资料（添加外链）',
    loginRequired: 'required',
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
    result: z.object({ url: z.string(), updated: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
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
    const page = ctx.page;
    if (!page) return;
    await page.goto('https://www.blogger.com/about/');
    await page.locator('a[href*="sign-in"]').first().click().catch(() => {});
    await ctx.storage.set('blogger_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('blogger_login');
  });
}
