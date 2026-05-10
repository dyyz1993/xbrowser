import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

function buildCdpTips(ctx: Record<string, unknown>): string[] {
  const cdpEndpoint = ctx.cdpEndpoint as string | undefined;
  const sessionId = ctx.sessionId as string | undefined;
  const tips: string[] = [];
  if (!cdpEndpoint) {
    tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
  }
  tips.push(`Session: ${sessionId || 'default'}`);
  return tips;
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'juejin',
    url: 'https://juejin.cn',
    description: '掘金 SEO 外链 - 中文技术社区 (DA 70+, 百度收录好)',
    requiresLogin: true,
  });

  site.command('login', {
    description: '登录掘金（GitHub OAuth / 手机号）',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser juejin login', description: '登录掘金' }],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/login', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);

        await ctx.waitForHuman?.({
          reason: '完成掘金登录（GitHub OAuth 或手机验证码）',
          timeout: 300,
        });

        await page.goto('https://juejin.cn/', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);

        const loggedIn = await page
          .locator(
            '.avatar, [class*="avatar"], img[class*="avatar"], .login-btn, a[href*="/user/"]'
          )
          .first()
          .isVisible()
          .catch(() => false);

        await ctx.storage.set('juejin_login', { loggedIn, at: Date.now() });

        return {
          data: { loggedIn, url: page.url() },
          tips: [...cdpTips, loggedIn ? '掘金登录成功' : '登录可能未完成，请检查页面'],
        };
      } catch (error) {
        return {
          data: null,
          tips: cdpTips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('publish', {
    description: '在掘金发布文章（Markdown，含外链）',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
      tags: z.string().optional().describe('标签，逗号分隔'),
      category: z.string().optional().describe('分类（前端/后端/Android/iOS 等）'),
    }),
    examples: [
      {
        cmd: 'xbrowser juejin publish --title "我的指南" --content "# Hello\nCheck [my site](https://example.com)" --tags "前端,JavaScript" --category "前端"',
        description: '发布带外链的文章',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/editor/draft', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(4000);

        const titleInput = page.locator(
          'input[placeholder*="输入文章标题"], input[class*="title-input"], input[name*="title"], input[placeholder*="标题"], input[data-testid*="title"]'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(params.title);
        }

        await page.waitForTimeout(500);

        const editor = page.locator(
          'div[contenteditable="true"][class*="editor"], textarea[class*="editor"], div[class*="CodeMirror"], textarea[placeholder*="请输入"], div[contenteditable="true"][class*="CodeMirror"], div[contenteditable="true"][data-placeholder], textarea[id*="editor"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(params.content);
        }

        if (params.tags) {
          const tagsInput = page.locator(
            'input[placeholder*="标签"], input[placeholder*="tag"], input[class*="tag-input"], input[placeholder*="添加标签"]'
          ).first();
          if (await tagsInput.isVisible().catch(() => false)) {
            const tags = params.tags.split(',');
            for (const tag of tags) {
              await tagsInput.fill(tag.trim());
              await page.waitForTimeout(500);
              const tagOption = page.locator(
                '[class*="tag-item"], [class*="tag-suggestion"], [role="option"], [class*="tag-wrap"]'
              ).first();
              if (await tagOption.isVisible().catch(() => false)) {
                await tagOption.click();
              }
            }
          }
        }

        if (params.category) {
          const categorySelect = page.locator(
            'select[class*="category"], [class*="category-selector"], [class*="select"]'
          ).first();
          if (await categorySelect.isVisible().catch(() => false)) {
            await categorySelect.click();
            await page.waitForTimeout(500);
            const option = page.locator(
              `[class*="option"]:has-text("${params.category}"), [class*="item"]:has-text("${params.category}")`
            ).first();
            if (await option.isVisible().catch(() => false)) {
              await option.click();
            }
          }
        }

        await ctx.waitForHuman?.({
          reason: '检查文章内容，解决验证码后点击"发布文章"',
          timeout: 120,
          autoDetect: true,
        });

        const publishBtn = page.locator(
          'button:has-text("发布文章"), button:has-text("发布"), button[class*="publish"]'
        ).first();
        if (await publishBtn.isVisible().catch(() => false)) {
          await publishBtn.click();
          await page.waitForTimeout(2000);

          const confirmBtn = page.locator(
            'button:has-text("确认发布"), button:has-text("确定")'
          ).first();
          if (await confirmBtn.isVisible().catch(() => false)) {
            await confirmBtn.click();
            await page.waitForTimeout(3000);
          }
        }

        return {
          data: {
            title: params.title,
            tags: params.tags,
            url: page.url(),
          },
          tips: [...cdpTips, `文章 "${params.title}" 已在掘金发布`],
        };
      } catch (error) {
        return {
          data: null,
          tips: cdpTips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('draft', {
    description: '在掘金保存草稿',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
    }),
    examples: [
      {
        cmd: 'xbrowser juejin draft --title "草稿" --content "# 草稿内容"',
        description: '保存为草稿',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/editor/draft', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(4000);

        const titleInput = page.locator(
          'input[placeholder*="输入文章标题"], input[class*="title-input"], input[name*="title"], input[placeholder*="标题"]'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(params.title);
        }

        await page.waitForTimeout(500);

        const editor = page.locator(
          'div[contenteditable="true"][class*="editor"], textarea[class*="editor"], div[class*="CodeMirror"], div[contenteditable="true"][data-placeholder], textarea[id*="editor"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(params.content);
        }

        const saveBtn = page.locator(
          'button:has-text("保存草稿"), button:has-text("保存"), button[class*="draft"]'
        ).first();
        if (await saveBtn.isVisible().catch(() => false)) {
          await saveBtn.click();
          await page.waitForTimeout(2000);
        }

        return {
          data: {
            title: params.title,
            saved: true,
            url: page.url(),
          },
          tips: [...cdpTips, `草稿 "${params.title}" 已保存`],
        };
      } catch (error) {
        return {
          data: null,
          tips: cdpTips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('update-profile', {
    description: '更新掘金个人资料（添加外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的网站 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser juejin update-profile --url "https://example.com" --bio "全栈开发者"',
        description: '更新 Profile 添加外链',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/user/settings/profile', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        if (params.bio) {
          const bioInput = page.locator(
            'textarea[name*="bio"], textarea[placeholder*="介绍"], textarea[placeholder*="bio"], textarea[class*="intro"]'
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

        return {
          data: { url: params.url, updated: true },
          tips: [...cdpTips, 'Profile 已更新，包含外链'],
        };
      } catch (error) {
        return {
          data: null,
          tips: cdpTips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('fetch-articles', {
    description: '获取当前登录用户的掘金文章列表',
    scope: 'browser',
    parameters: z.object({
      limit: z.number().optional().default(20).describe('获取文章数量上限'),
      cursor: z.string().optional().describe('分页游标（可选）'),
    }),
    examples: [
      { cmd: 'xbrowser juejin fetch-articles', description: '获取我的文章列表' },
      { cmd: 'xbrowser juejin fetch-articles --limit 50', description: '获取前50篇文章' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/user/center/articles', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);

        const articles = await page.evaluate((maxItems: number) => {
          const items: Array<{
            title: string;
            url: string;
            views: string;
            likes: string;
            comments: string;
            date: string;
          }> = [];

          let cards = document.querySelectorAll(
            '[class*="article-item"], [class*="list-item"], [class*="entry"]'
          );
          if (cards.length === 0) {
            cards = document.querySelectorAll('.item');
          }

          cards.forEach((card) => {
            if (items.length >= maxItems) return;
            const titleEl = card.querySelector('[class*="title"] a, a[class*="title"], h3 a, h2 a')
              || card.querySelector('a[href*="/post/"]');
            const viewsEl = card.querySelector('[class*="view"], [class*="read"]')
              || card.querySelector('[class*="count"]');
            const likesEl = card.querySelector('[class*="like"], [class*="digg"]')
              || card.querySelector('[class*="zan"]');
            const commentsEl = card.querySelector('[class*="comment"]')
              || card.querySelector('[class*="message"]');
            const dateEl = card.querySelector('[class*="date"], [class*="time"]')
              || card.querySelector('[class*="meta"] span');

            const title = titleEl?.textContent?.trim() || '';
            if (title) {
              items.push({
                title,
                url: titleEl?.getAttribute('href') || '',
                views: viewsEl?.textContent?.trim() || '',
                likes: likesEl?.textContent?.trim() || '',
                comments: commentsEl?.textContent?.trim() || '',
                date: dateEl?.textContent?.trim() || '',
              });
            }
          });

          return items;
        }, params.limit);

        return {
          data: articles,
          tips: [
            ...cdpTips,
            `获取 ${articles.length} 篇文章`,
          ],
        };
      } catch (error) {
        return {
          data: null,
          tips: cdpTips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
    if (!page) return;
    await page.goto('https://juejin.cn/login');
    await ctx.storage.set('juejin_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('juejin_login');
  });
}
