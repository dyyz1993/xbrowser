import { z } from 'zod';
import type { XCLIAPI, ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from 'playwright';

function resolvePage(ctx: Record<string, unknown>): { page: Page; tips: string[] } {
  const page = ctx.page as Page;
  if (!page) throw new Error('需要浏览器页面');
  const cdpEndpoint = ctx.cdpEndpoint as string | undefined;
  const sessionId = ctx.sessionId as string | undefined;
  const tips: string[] = [];
  if (!cdpEndpoint) {
    tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
  }
  tips.push(`Session: ${sessionId || 'default'}`);
  return { page, tips };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'csdn',
    url: 'https://www.csdn.net',
    description: 'CSDN SEO 外链 - 中文技术平台 (DA 80+, 百度排名 #1)',
    requiresLogin: true,
  });

  site.command('login', {
    description: '登录 CSDN（GitHub / 邮箱 / 手机号）',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser csdn login', description: '登录 CSDN' }],
    result: z.any(),
    handler: async (_params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto('https://passport.csdn.net/login', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);

        await ctx.waitForHuman?.({
          reason: '完成 CSDN 登录（GitHub OAuth / 邮箱 / 手机验证码）',
          timeout: 300,
        });

        await page.goto('https://www.csdn.net/', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);

        const loggedIn = await page
          .locator(
            '.avatar, [class*="avatar"], img[class*="avatar"], a[href*="/loginout"], [class*="user-info"]'
          )
          .first()
          .isVisible()
          .catch(() => false);

        await ctx.storage.set('csdn_login', { loggedIn, at: Date.now() });

    return ok({ loggedIn, []);
          tips: [...tips, loggedIn ? 'CSDN 登录成功' : '登录可能未完成，请检查页面'],
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', []);
      }
    },
  });

  site.command('publish', {
    description: '在 CSDN 发布博客文章（含外链）',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
      tags: z.string().optional().describe('标签，逗号分隔'),
    }),
    examples: [
      {
        cmd: 'xbrowser csdn publish --title "我的指南" --content "# Hello\nCheck [my site](https://example.com)" --tags "JavaScript,前端"',
        description: '发布带外链的博客文章',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto('https://mp.csdn.net/mp_blog/creation/editor', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(4000);

        const titleInput = page.locator(
          'input[placeholder*="标题"], input[placeholder*="请输入"], input[name*="title"], input[class*="article-bar-title"], input[id*="title"]'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(params.title);
        }

        await page.waitForTimeout(500);

        const editor = page.locator(
          'div[contenteditable="true"][class*="editor"], div[contenteditable="true"][class*="markdown"], textarea[class*="editor"], div[class*="CodeMirror"], div[contenteditable="true"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(params.content);
        }

        if (params.tags) {
          const tagsInput = page.locator(
            'input[placeholder*="标签"], input[placeholder*="tag"], input[class*="tag-input"]'
          ).first();
          if (await tagsInput.isVisible().catch(() => false)) {
            const tags = params.tags.split(',');
            for (const tag of tags) {
              await tagsInput.fill(tag.trim());
              await page.waitForTimeout(500);
              const tagOption = page.locator(
                '[class*="tag-item"], [class*="tag-suggestion"], [role="option"]'
              ).first();
              if (await tagOption.isVisible().catch(() => false)) {
                await tagOption.click();
              }
            }
          }
        }

        await ctx.waitForHuman?.({
          reason: '检查文章内容，解决验证码后点击"发布文章"',
          timeout: 120,
          autoDetect: true,
        });

        const publishBtn = page.locator(
          'button:has-text("发布文章"), button:has-text("发布"), button[class*="publish"], button[id*="publish"], [class*="btn-publish"]'
        ).first();
        if (await publishBtn.isVisible().catch(() => false)) {
          await publishBtn.click();
          await page.waitForTimeout(3000);
        }

    return ok({, []);
          tips: [...tips, `文章 "${params.title}" 已在 CSDN 发布`],
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', []);
      }
    },
  });

  site.command('draft', {
    description: '在 CSDN 保存草稿',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
    }),
    examples: [
      {
        cmd: 'xbrowser csdn draft --title "草稿" --content "# 草稿内容"',
        description: '保存为草稿',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto('https://mp.csdn.net/mp_blog/creation/editor', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(4000);

        const titleInput = page.locator(
          'input[placeholder*="标题"], input[placeholder*="请输入"], input[name*="title"], input[class*="article-bar-title"]'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(params.title);
        }

        await page.waitForTimeout(500);

        const editor = page.locator(
          'div[contenteditable="true"][class*="editor"], div[contenteditable="true"][class*="markdown"], textarea[class*="editor"], div[class*="CodeMirror"], div[contenteditable="true"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(params.content);
        }

        const saveBtn = page.locator(
          'button:has-text("保存草稿"), button:has-text("保存"), button[class*="draft"], [class*="btn-draft"]'
        ).first();
        if (await saveBtn.isVisible().catch(() => false)) {
          await saveBtn.click();
          await page.waitForTimeout(2000);
        }

    return ok({, []);
          tips: [...tips, `草稿 "${params.title}" 已保存`],
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', []);
      }
    },
  });

  site.command('update-profile', {
    description: '更新 CSDN 个人资料（添加外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的网站 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser csdn update-profile --url "https://example.com" --bio "全栈开发者"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto('https://mp.csdn.net/mp/profile/profile', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        if (params.bio) {
          const bioInput = page.locator(
            'textarea[name*="description"], textarea[placeholder*="介绍"], textarea[placeholder*="简介"], textarea[class*="intro"]'
          ).first();
          if (await bioInput.isVisible().catch(() => false)) {
            await bioInput.fill(`${params.bio}\n\n${params.url}`);
          }
        }

        const webInput = page.locator(
          'input[name*="url"], input[placeholder*="网站"], input[placeholder*="blog"], input[class*="website"]'
        ).first();
        if (await webInput.isVisible().catch(() => false)) {
          await webInput.fill(params.url);
        }

        const submitBtn = page.locator(
          'button:has-text("保存"), button:has-text("提交"), button[type="submit"]'
        ).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(2000);
        }

    return ok({ url: params.url, []);
          tips: [...tips, 'Profile 已更新，包含外链'],
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', []);
      }
    },
  });

  site.command('fetch-articles', {
    description: '获取 CSDN 用户文章列表或搜索文章',
    scope: 'browser',
    parameters: z.object({
      keyword: z.string().optional().describe('搜索关键词（不填则获取个人文章列表）'),
      username: z.string().optional().describe('CSDN 用户名（不填则获取自己的）'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser csdn fetch-articles --keyword "React"', description: '搜索 React 相关文章' },
      { cmd: 'xbrowser csdn fetch-articles --username "zhangsan"', description: '获取指定用户的文章' },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        let targetUrl: string;
        if (params.keyword) {
          targetUrl = `https://so.csdn.net/so/search?q=${encodeURIComponent(params.keyword)}&t=all`;
        } else if (params.username) {
          targetUrl = `https://blog.csdn.net/${params.username}/article/list/1`;
        } else {
          targetUrl = 'https://mp.csdn.net/mp_blog/manage/all';
        }

        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);

        const articles = await page.evaluate((limit) => {
          const items: Array<{title: string; link: string; views: string; date: string}> = [];

          const selectors = [
            '.search-result .item a, .so-result-list .item a, [class*="search-result"] a',
            '.article-list .article-item a, [class*="article-item"] a',
            '[class*="article-item"] a, table tbody tr a',
          ];

          const seen = new Set<string>();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach((el) => {
              if (items.length >= limit) return;
              const anchor = el.closest('a') || el;
              if (!(anchor instanceof HTMLAnchorElement)) return;
              const href = anchor.href;
              if (seen.has(href) || !href.includes('article')) return;
              seen.add(href);
              const row = anchor.closest('[class*="item"], tr, li');
              items.push({
                title: anchor.textContent?.trim() || '',
                link: href,
                views: row?.querySelector('[class*="read"], [class*="view"]')?.textContent?.trim() || '',
                date: row?.querySelector('[class*="date"], [class*="time"], time')?.textContent?.trim() || '',
              });
            });
          }
          return items;
        }, params.limit);

    return ok({, []);
          tips: [...tips, `获取到 ${articles.length} 篇文章`],
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', []);
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as Page | undefined;
    if (!page) return;
    await page.goto('https://passport.csdn.net/login');
    await ctx.storage.set('csdn_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('csdn_login');
  });
}
