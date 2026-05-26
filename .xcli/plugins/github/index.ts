import { z } from 'zod';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from 'playwright';

interface BrowserCtx extends CommandContext {
  page?: Page;
  cdpEndpoint?: string;
  sessionId?: string;
}

function getPage(ctx: CommandContext): Page {
  const browserCtx = ctx as BrowserCtx;
  const page = browserCtx.page;
  if (!page) throw new Error('需要浏览器页面');
  return page;
}

function buildCtxTips(ctx: CommandContext): { tips: string[]; hasCdp: boolean } {
  const browserCtx = ctx as BrowserCtx;
  const tips: string[] = [];
  const hasCdp = !!browserCtx.cdpEndpoint;
  if (!hasCdp) {
    tips.push('建议使用 --cdp 9221 参数连接到 Chrome 浏览器');
  }
  tips.push(`Session: ${browserCtx.sessionId || 'default'}`);
  return { tips, hasCdp };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'github',
    url: 'https://github.com',
    description: 'GitHub SEO 外链 - Profile / README / Gist',
    requiresLogin: false,
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

  site.command('update-profile', {
    description: '更新 GitHub 个人资料页（Bio、网站、公司等）',
    scope: 'browser',
    parameters: z.object({
      bio: z.string().optional().describe('个人简介'),
      blog: z.string().optional().describe('网站 URL'),
      company: z.string().optional().describe('公司'),
      location: z.string().optional().describe('地点'),
      name: z.string().optional().describe('显示名称'),
      hireable: z.boolean().optional().describe('是否开放招聘'),
    }),
    result: z.object({ url: z.string(), saved: z.boolean(), updatedFields: z.array(z.string()) }).passthrough(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto('https://github.com/settings/profile', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const fields: Record<string, string> = {
        'user[profile_bio]': params.bio || '',
        'user[profile_blog]': params.blog || '',
        'user[profile_company]': params.company || '',
        'user[profile_location]': params.location || '',
        'user[profile_name]': params.name || '',
      };

      const updatedFields: string[] = [];
      for (const [name, value] of Object.entries(fields)) {
        if (!value) continue;
        const selector = `[name="${name}"]`;
        const el = page.locator(selector).first();
        const exists = await el.isVisible().catch(() => false);
        if (exists) {
          await el.fill(value);
          await page.waitForTimeout(300);
          updatedFields.push(name);
        }
      }

      if (params.hireable !== undefined) {
        const checkbox = page.locator(
          '#user_profile_hireable, input[name="user[hireable]"], input[type="checkbox"][name*="hireable"]'
        ).first();
        const isChecked = await checkbox.isChecked().catch(() => false);
        if (params.hireable !== isChecked) {
          await checkbox.click();
        }
      }

      const submitBtn = page.locator(
        'button[type="submit"], input[type="submit"], button:has-text("Update profile")'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      const currentUrl = page.url();
      const saved = !currentUrl.includes('error');

      return ok({
          url: currentUrl,
          saved,
          updatedFields,
        }, [...ctxTips, saved ? 'Profile 更新成功' : 'Profile 更新可能失败，请检查页面']);
    },
  });

  site.command('add-social-link', {
    description: '添加社交链接到 GitHub Profile',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('社交链接 URL'),
    }),
    result: z.object({ url: z.string(), filled: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto('https://github.com/settings/profile', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const socialInputs = page.locator(
        '[name="user[profile_social_accounts][][url]"], input[placeholder*="social"], input[class*="social-url"]'
      );
      const count = await socialInputs.count();

      let filled = false;
      for (let i = 0; i < count; i++) {
        const input = socialInputs.nth(i);
        const value = await input.inputValue().catch(() => '');
        if (!value) {
          await input.fill(params.url);
          filled = true;
          break;
        }
      }

      if (!filled) {
        const addBtn = page.locator(
          'button:has-text("Add"), button.js-add-social-account, button[class*="add-social"]'
        ).first();
        if (await addBtn.isVisible().catch(() => false)) {
          await addBtn.click();
          await page.waitForTimeout(500);
          const newInputs = page.locator(
            '[name="user[profile_social_accounts][][url]"], input[placeholder*="social"]'
          );
          const lastIdx = (await newInputs.count()) - 1;
          if (lastIdx >= 0) {
            await newInputs.nth(lastIdx).fill(params.url);
            filled = true;
          }
        }
      }

      if (filled) {
        const submitBtn = page.locator(
          'button[type="submit"], input[type="submit"], button:has-text("Update profile")'
        ).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(2000);
        }
      }

      return ok({ url: params.url, filled }, [...ctxTips, filled ? `已添加社交链接: ${params.url}` : '没有可用的社交链接空位']);
    },
  });

  site.command('create-gist', {
    description: '创建 GitHub Gist（带外链）',
    scope: 'browser',
    parameters: z.object({
      filename: z.string().default('readme.md').describe('文件名'),
      content: z.string().describe('Gist 内容（支持 Markdown）'),
      description: z.string().optional().describe('Gist 描述'),
      public: z.boolean().optional().default(true).describe('是否公开'),
    }),
    result: z.object({ gistUrl: z.string(), filename: z.string(), public: z.boolean(), created: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto('https://gist.github.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const descInput = page.locator(
        '[name="gist[description]"], input[aria-label*="description"], input[placeholder*="description"]'
      ).first();
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill(params.description || '');
      }

      const nameInput = page.locator(
        '[name="gist[contents][][name]"], input[aria-label*="filename"], input[placeholder*="filename"]'
      ).first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(params.filename);
      }

      const contentArea = page.locator(
        '.CodeMirror, textarea[class*="code"], [name="gist[contents][][content]"]'
      ).first();
      if (await contentArea.isVisible().catch(() => false)) {
        await contentArea.click();
        await page.keyboard.type(params.content, { delay: 10 });
      } else {
        const textarea = page.locator(
          '[name="gist[contents][][content]"], textarea[placeholder*="content"]'
        ).first();
        if (await textarea.isVisible().catch(() => false)) {
          await textarea.fill(params.content);
        }
      }

      if (!params.public) {
        const secretBtn = page.locator(
          'button:has-text("Create secret gist"), button:has-text("secret")'
        ).first();
        if (await secretBtn.isVisible().catch(() => false)) {
          await secretBtn.click();
        }
      } else {
        const publicBtn = page.locator(
          'button:has-text("Create public gist"), button:has-text("public")'
        ).first();
        if (await publicBtn.isVisible().catch(() => false)) {
          await publicBtn.click();
        }
      }

      await page.waitForTimeout(3000);
      const gistUrl = page.url();
      const created = gistUrl.includes('gist.github.com') && !gistUrl.endsWith('gist.github.com/');

      return ok({
          gistUrl,
          filename: params.filename,
          public: params.public,
          created,
        }, [...ctxTips, created ? `Gist 创建成功: ${gistUrl}` : 'Gist 创建可能失败，请检查']);
    },
  });

  site.command('get-profile', {
    description: '获取 GitHub 用户 Profile 信息',
    scope: 'browser',
    parameters: z.object({
      username: z.string().optional().describe('GitHub 用户名，不填则获取自己的'),
    }),
    examples: [{ cmd: 'xbrowser github get-profile', description: '获取 Profile 信息' }],
    result: z.object({ bio: z.string(), name: z.string(), username: z.string(), location: z.string(), company: z.string(), website: z.string(), socialLinks: z.array(z.string()), avatar: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      let profileUrl: string;
      if (params.username) {
        profileUrl = `https://github.com/${params.username}`;
      } else {
        await page.goto('https://github.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(1500);
        const userLink = await page
          .locator(
            'a[data-hovercard-type="user"], a[aria-label="View profile"], a[href*="/"][data-view-component]'
          )
          .first()
          .getAttribute('href')
          .catch(() => '');
        if (userLink) {
          profileUrl = `https://github.com${userLink}`;
        } else {
          const html = await page.content();
          const match = html.match(/"login"\s*:\s*"([^"]+)"/);
          profileUrl = match ? `https://github.com/${match[1]}` : 'https://github.com/';
        }
      }

      await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const profile = await page.evaluate(() => {
        const get = (sel: string) => document.querySelector(sel)?.textContent?.trim() || '';

        const bio = get('.p-note .js-user-profile-bio');
        const name = get('.vcard-fullname');
        const username =
          get('.vcard-username') ||
          document.querySelector('[data-scope-id]')?.getAttribute('data-scope-id') ||
          '';
        const location = get('[itemprop="homeLocation"]');
        const company = get('[itemprop="worksFor"]');
        const website = document.querySelector('[itemprop="url"] a')?.getAttribute('href') || '';
        const socialLinks = Array.from(
          document.querySelectorAll('.js-profile-editable-area a[href]')
        )
          .map((a) => a.getAttribute('href') || '')
          .filter((h) => h.startsWith('http'));

        const avatar =
          document.querySelector('.js-user-profile-avatar')?.getAttribute('src') || '';

        return { bio, name, username, location, company, website, socialLinks, avatar };
      });

      return ok(profile, [...ctxTips, `Profile: ${profile.name} (@${profile.username})`]);
    },
  });

  site.command('create-repo', {
    description: '创建 GitHub 仓库',
    scope: 'browser',
    parameters: z.object({
      name: z.string().describe('仓库名称'),
      description: z.string().optional().describe('仓库描述'),
      private: z.boolean().optional().default(false).describe('是否私有'),
      readme: z.boolean().optional().default(true).describe('是否初始化 README'),
    }),
    result: z.object({ repoUrl: z.string(), name: z.string(), private: z.boolean(), created: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto('https://github.com/new', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const nameInput = page.locator(
        '#repository_name, [name="repository[name]"], input[aria-label*="Repository name"]'
      ).first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(params.name);
        await page.waitForTimeout(500);
      }

      if (params.description) {
        const descInput = page.locator(
          '#repository_description, [name="repository[description]"], textarea[aria-label*="description"]'
        ).first();
        if (await descInput.isVisible().catch(() => false)) {
          await descInput.fill(params.description);
        }
      }

      if (params.private) {
        const privateRadio = page.locator(
          '#repository_visibility_private, input[value="private"], label:has-text("Private") input[type="radio"]'
        ).first();
        if (await privateRadio.isVisible().catch(() => false)) {
          await privateRadio.click();
        }
      }

      if (params.readme) {
        const readmeCheckbox = page.locator(
          '#repository_auto_init, input[name="repository[auto_init]"], label:has-text("README") input[type="checkbox"]'
        ).first();
        const isChecked = await readmeCheckbox.isChecked().catch(() => false);
        if (!isChecked) {
          await readmeCheckbox.click();
        }
      }

      await page.waitForTimeout(1000);

      const createBtn = page.locator(
        'button[type="submit"]:has-text("Create repository"), button:has-text("Create repository"), button.btn-primary[type="submit"]'
      ).first();
      if (await createBtn.isVisible().catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(3000);
      }

      const repoUrl = page.url();
      const created = repoUrl.includes(`/${params.name}`) && !repoUrl.includes('/new');

      return ok({
          repoUrl,
          name: params.name,
          private: params.private,
          created,
        }, [...ctxTips, created ? `仓库创建成功: ${repoUrl}` : '仓库创建可能失败，请检查']);
    },
  });

  site.command('edit-readme', {
    description: '编辑 GitHub 仓库的 README.md 文件',
    scope: 'browser',
    parameters: z.object({
      repo: z.string().describe('仓库名称（owner/repo 格式）'),
      content: z.string().describe('README 内容（Markdown）'),
      message: z.string().optional().describe('提交信息'),
    }),
    result: z.object({ repo: z.string(), saved: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto(`https://github.com/${params.repo}/edit/main/README.md`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const notFound = await page.locator('text="404", text="not found"').first().isVisible().catch(() => false);
      if (notFound) {
        await page.goto(`https://github.com/${params.repo}/edit/master/README.md`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);
      }

      const editor = page.locator(
        '.CodeMirror, textarea[class*="code"], textarea[name="value"], .editor-instance'
      ).first();
      if (await editor.isVisible().catch(() => false)) {
        await editor.click();
        await page.keyboard.press('Meta+a');
        await page.keyboard.press('Backspace');
        await page.keyboard.insertText(params.content);
      } else {
        const textarea = page.locator(
          'textarea[name="value"], textarea[id="blob-contents"]'
        ).first();
        if (await textarea.isVisible().catch(() => false)) {
          await textarea.fill(params.content);
        }
      }

      await page.waitForTimeout(500);

      if (params.message) {
        const commitInput = page.locator(
          'input[name="message"], input[aria-label*="commit message"], input[id="commit-summary-input"]'
        ).first();
        if (await commitInput.isVisible().catch(() => false)) {
          await commitInput.fill(params.message);
        }
      }

      const commitBtn = page.locator(
        'button:has-text("Commit changes"), button[id="submit-file"], button.btn-primary:has-text("Commit")'
      ).first();
      if (await commitBtn.isVisible().catch(() => false)) {
        await commitBtn.click();
        await page.waitForTimeout(3000);
      }

      const currentUrl = page.url();
      const saved = !currentUrl.includes('/edit/');

      return ok({
          repo: params.repo,
          saved,
          url: currentUrl,
        }, [...ctxTips, saved ? `README 已更新: ${params.repo}` : 'README 更新可能失败，请检查']);
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
    if (!page) return;
    await page.goto('https://github.com/login');
    await ctx.storage.set('github_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('github_login');
  });
}
