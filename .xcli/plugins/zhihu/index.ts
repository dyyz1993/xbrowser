import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
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

async function dismissModals(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.Modal-closeButton, [class*="close"], [class*="Close"]').forEach((el) => {
      if (el instanceof HTMLElement) el.click();
    });
  });
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'zhihu',
    url: 'https://www.zhihu.com',
    description: '知乎 - 知识问答与内容采集 (DA 93)',
    requiresLogin: false,
  });

  site.command('search', {
    description: '搜索知乎问题、回答、文章',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      type: z.enum(['all', 'question', 'article', 'answer']).optional().default('all'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser zhihu search --query "AI 编程"', description: '搜索 AI 编程相关内容' },
    ],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        const searchUrl = `https://www.zhihu.com/search?type=${params.type}&q=${encodeURIComponent(params.query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        const results = await page.evaluate((limit) => {
          const items: Array<{title: string; excerpt: string; author: string; link: string; type: string}> = [];
          const cards = document.querySelectorAll('.SearchResult-Card, .List-item, [class*="SearchResult"]');
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector('h2 a, .ContentItem-title a, a[data-za-detail-view-path-module]');
            const excerptEl = card.querySelector('.content, .RichContent-inner, span.RichText');
            const authorEl = card.querySelector('.AuthorInfo-name, .UserLink-link');
            items.push({
              title: titleEl?.textContent?.trim() || '',
              excerpt: excerptEl?.textContent?.trim()?.slice(0, 200) || '',
              author: authorEl?.textContent?.trim() || '',
              link: titleEl instanceof HTMLAnchorElement ? titleEl.href : '',
              type: card.querySelector('[class*="Question"]') ? 'question' :
                    card.querySelector('[class*="Article"]') ? 'article' : 'answer',
            });
          });
          return items;
        }, params.limit);

        return {
          data: { query: params.query, count: results.length, results },
          tips: [...tips, `找到 ${results.length} 条结果`],
        };
      } catch (error) {
        return {
          data: null,
          tips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('trending', {
    description: '获取知乎热榜',
    scope: 'browser',
    parameters: z.object({
      limit: z.number().optional().default(20),
    }),
    examples: [
      { cmd: 'xbrowser zhihu trending', description: '获取知乎热榜前 20' },
    ],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto('https://www.zhihu.com/hot', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        const items = await page.evaluate((limit) => {
          const results: Array<{rank: number; title: string; hotScore: string; link: string}> = [];
          const hotItems = document.querySelectorAll('.HotList-list .HotItem, [class*="HotItem"]');
          hotItems.forEach((item, i) => {
            if (i >= limit) return;
            const titleEl = item.querySelector('.HotItem-title, .HotItem-content .title, [class*="title"]');
            const scoreEl = item.querySelector('.HotItem-metrics, .HotItem-content .metrics, [class*="metrics"]');
            const linkEl = item.querySelector('a');
            results.push({
              rank: i + 1,
              title: titleEl?.textContent?.trim() || '',
              hotScore: scoreEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
            });
          });
          return results;
        }, params.limit);

        return {
          data: { count: items.length, items },
          tips: [...tips, `热榜 ${items.length} 条`],
        };
      } catch (error) {
        return {
          data: null,
          tips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('question', {
    description: '获取知乎问题及其回答',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('知乎问题 URL'),
      limit: z.number().optional().default(5),
    }),
    examples: [
      { cmd: 'xbrowser zhihu question --url "https://www.zhihu.com/question/xxx"', description: '获取问题回答' },
    ],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        const data = await page.evaluate((limit) => {
          const title = document.querySelector('.QuestionHeader-title, h1')?.textContent?.trim() || '';
          const detail = document.querySelector('.QuestionRichText-inner, [class*="QuestionDetail"]')?.textContent?.trim() || '';
          const answers: Array<{author: string; content: string; upvotes: string}> = [];

          document.querySelectorAll('.AnswerItem, [class*="AnswerCard"], [class*="AnswerItem"]').forEach((item, i) => {
            if (i >= limit) return;
            const authorEl = item.querySelector('.AuthorInfo-name, .UserLink-link');
            const contentEl = item.querySelector('.RichContent-inner, .RichText');
            const upvoteEl = item.querySelector('.VoteButton--up, [class*="VoteButton"]');
            answers.push({
              author: authorEl?.textContent?.trim() || '匿名',
              content: contentEl?.textContent?.trim()?.slice(0, 500) || '',
              upvotes: upvoteEl?.textContent?.trim() || '0',
            });
          });

          return { title, detail, answers };
        }, params.limit);

        return {
          data,
          tips: [...tips, `问题: ${data.title}`, `${data.answers.length} 条回答`],
        };
      } catch (error) {
        return {
          data: null,
          tips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('answer', {
    description: '回答知乎问题（支持外链）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('知乎问题 URL'),
      content: z.string().describe('回答内容（Markdown）'),
    }),
    examples: [
      {
        cmd: 'xbrowser zhihu answer --url "https://www.zhihu.com/question/xxx" --content "推荐使用 [XXX](https://example.com)"',
        description: '回答问题并附带外链',
      },
    ],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        const editor = page.locator(
          '.AnswerForm-editor, textarea[placeholder*="写回答"], div[contenteditable="true"][class*="editor"], .ProseMirror, div[contenteditable="true"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.waitForTimeout(500);
          await page.keyboard.insertText(params.content);
        }

        await ctx.waitForHuman?.({
          reason: '检查回答内容后点击提交',
          timeout: 120,
          autoDetect: true,
        });

        const submitBtn = page.locator(
          'button:has-text("提交回答"), button:has-text("发布"), button[class*="submit"]'
        ).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(3000);
        }

        return {
          data: { url: params.url, submitted: true, pageUrl: page.url() },
          tips: [...tips, '回答已提交'],
        };
      } catch (error) {
        return {
          data: null,
          tips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  site.command('article', {
    description: '在知乎发布文章（含外链）',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容'),
      topic: z.string().optional().describe('所属话题'),
    }),
    examples: [
      {
        cmd: 'xbrowser zhihu article --title "前端指南" --content "详见 [官网](https://example.com)" --topic "前端开发"',
        description: '发布带外链的知乎文章',
      },
    ],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx as Record<string, unknown>);

      try {
        await page.goto('https://zhuanlan.zhihu.com/write', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(2000);
        await dismissModals(page);

        const titleInput = page.locator(
          'textarea[placeholder*="标题"], input[placeholder*="标题"], [class*="WriteIndex-titleInput"] textarea'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(params.title);
        }

        await page.waitForTimeout(500);

        const editor = page.locator(
          '.ProseMirror, div[contenteditable="true"], textarea[class*="editor"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(params.content);
        }

        if (params.topic) {
          const topicInput = page.locator(
            'input[placeholder*="话题"], input[placeholder*="topic"]'
          ).first();
          if (await topicInput.isVisible().catch(() => false)) {
            await topicInput.fill(params.topic);
            await page.waitForTimeout(1000);
            const topicOption = page.locator('[class*="topic-item"], [role="option"]').first();
            if (await topicOption.isVisible().catch(() => false)) {
              await topicOption.click();
            }
          }
        }

        await ctx.waitForHuman?.({
          reason: '检查文章内容后点击发布',
          timeout: 120,
          autoDetect: true,
        });

        const publishBtn = page.locator(
          'button:has-text("发布"), button[class*="publish"], button:has-text("发表")'
        ).first();
        if (await publishBtn.isVisible().catch(() => false)) {
          await publishBtn.click();
          await page.waitForTimeout(3000);
        }

        return {
          data: { title: params.title, topic: params.topic, url: page.url() },
          tips: [...tips, `文章 "${params.title}" 已在知乎发布`],
        };
      } catch (error) {
        return {
          data: null,
          tips,
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });
}
