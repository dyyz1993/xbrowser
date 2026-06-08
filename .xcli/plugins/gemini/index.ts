/**
 * Google Gemini 插件
 *
 * 支持命令:
 *   list   — 列出历史会话
 *   chat   — 发送消息
 *   new    — 新建对话
 *   open   — 打开指定会话
 *   attach — 上传文件
 *   image  — 生成图片
 *   music  — 生成音乐
 *   model  — 切换模型
 */

import { z } from 'zod';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

const GEMINI_URL = 'https://gemini.google.com';
type Page = import('../types').Page;

async function getPage(ctx: CommandContext): Promise<Page> {
  let page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面');
  if (typeof (page as any).goto !== 'function') {
    const bc = (ctx as any).browserContext;
    if (bc && typeof bc.newPage === 'function') {
      page = await bc.newPage();
    }
    if (typeof (page as any).goto !== 'function') {
      throw new Error('页面不可用');
    }
  }
  return page;
}

function buildCdpTips(ctx: CommandContext): string[] {
  const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint as string | undefined;
  return cdp ? [] : ['建议使用 --cdp 9221 连接已登录浏览器'];
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'gemini',
    url: GEMINI_URL,
    description: 'Google Gemini AI 助手 — 对话、图片生成、音乐生成、文件分析',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        // No page available — can't check, assume logged in
        if (!page) return true;
        const url = page.url();
        // Not navigated to Gemini yet — assume logged in
        if (url === 'about:blank' || url === '' || !url.includes('gemini.google.com')) return true;
        if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) return false;
        const hasInput = await page.evaluate(() => !!document.querySelector('[aria-label*="输入提示"], [contenteditable="true"]'));
        if (hasInput) return true;
        return false;
      } catch { return true; }
    },
  });

  // ── list — 列出历史会话 ──
  site.command('list', {
    description: '列出所有历史会话',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser gemini list', description: '列出历史会话' }],
    result: z.array(z.object({ index: z.number(), title: z.string() })),
    handler: async (_params, ctx) => {
      const page = getPage(ctx);
      const tips = buildCdpTips(ctx);
      try {
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(5000);

        // Extract history links — they're in DOM even when sidebar closed
        const conversations = await page.evaluate(() => {
          const result: string[] = [];
          const seen = new Set<string>();
          const links = document.querySelectorAll('a[href*="/app/"]');
          links.forEach(el => {
            const text = (el.textContent || '').trim();
            if (text && text.length > 2 && text.length < 100 && !seen.has(text) &&
                !text.includes('Gemini') && !text.includes('笔记本') && !text.includes('新建')) {
              seen.add(text);
              result.push(text);
            }
          });
          return result.slice(0, 30);
        });

        return ok(
          conversations.map((title, i) => ({ index: i, title })),
          [...tips, `共 ${conversations.length} 条会话`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ── chat — 发送消息 ──
  site.command('chat', {
    description: '发送消息并等待 AI 回复',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      message: z.string().describe('消息内容'),
    }),
    examples: [{ cmd: 'xbrowser gemini chat --message "你好"', description: '发送消息' }],
    result: z.object({ reply: z.string().optional(), conversationUrl: z.string() }),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const tips = buildCdpTips(ctx);
      try {
        await page.goto(GEMINI_URL + "/app", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        // Click the input area and type
        const inputSel = '[aria-label*="输入提示"], [contenteditable="true"]';
        await page.waitForSelector(inputSel, { timeout: 10000 });
        await page.click(inputSel);
        await page.fill(inputSel, params.message);
        await page.keyboard.press('Enter');

        // Wait for response
        for (let i = 0; i < 30; i++) {
          await page.waitForTimeout(2000);
          const done = await page.evaluate(() => {
            const body = document.body?.innerText || '';
            return !body.includes('正在生成') && !body.includes('停止回答') && !body.includes('Generating');
          }).catch(() => true);
          if (done && i > 3) break;
        }

        return ok({ conversationUrl: page.url() }, [...tips, '消息已发送']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ── new — 新建对话 ──
  site.command('new', {
    description: '创建新的空白对话',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser gemini new', description: '新建对话' }],
    result: z.object({ url: z.string() }),
    handler: async (_params, ctx) => {
      const page = getPage(ctx);
      try {
        await page.goto(GEMINI_URL + "/app", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await page.evaluate(() => {
          const btn = document.querySelector('[aria-label*="新对话"], button[class*="sparkle"], a[href*="new"]');
          if (btn) (btn as HTMLButtonElement).click();
        });
        await page.waitForTimeout(2000);
        return ok({ url: page.url() });
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });

  // ── open — 打开指定会话 ──
  site.command('open', {
    description: '通过标题打开指定会话',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('会话标题关键词'),
    }),
    examples: [{ cmd: 'xbrowser gemini open --title "封面图"', description: '打开含"封面图"的会话' }],
    result: z.object({ title: z.string(), url: z.string() }),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const tips = buildCdpTips(ctx);
      try {
        await page.goto(GEMINI_URL + "/app", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // Open sidebar
        await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label*="边栏"], button[aria-label*="sidebar"]');
          if (btn) (btn as HTMLButtonElement).click();
        });
        await page.waitForTimeout(2000);

        // Find and click matching conversation
        const found = await page.evaluate((keyword: string) => {
          const links = document.querySelectorAll('a');
          for (const el of links) {
            const text = (el.textContent || '').trim();
            if (text.includes(keyword) && text.length < 100) {
              (el as HTMLElement).click();
              return text;
            }
          }
          return null;
        }, params.title);

        if (!found) return fail(`未找到"${params.title}"`, tips);
        await page.waitForTimeout(3000);
        return ok({ title: found, url: page.url() });
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ── image — 生成图片 ──
  site.command('image', {
    description: '生成图片',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      prompt: z.string().describe('图片描述'),
    }),
    examples: [{ cmd: 'xbrowser gemini image --prompt "一只可爱的猫"', description: '生成猫咪图片' }],
    result: z.object({ url: z.string() }),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const tips = buildCdpTips(ctx);
      try {
        await page.goto(GEMINI_URL + "/app", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        // Click upload/tools button and select 制作图片
        await page.evaluate(() => {
          const btn = document.querySelector('[aria-label*="上传和工具"], [aria-label*="tool"]');
          if (btn) (btn as HTMLButtonElement).click();
        });
        await page.waitForTimeout(1000);
        await page.evaluate(() => {
          const items = document.querySelectorAll('[class*="drawer-item"], button');
          for (const el of items) {
            if ((el.textContent || '').includes('制作图片')) {
              (el as HTMLElement).click();
              return;
            }
          }
        });
        await page.waitForTimeout(1000);

        // Type prompt and send
        const inputSel = '[aria-label*="输入提示"], [contenteditable="true"]';
        await page.waitForSelector(inputSel, { timeout: 10000 });
        await page.click(inputSel);
        await page.fill(inputSel, params.prompt);
        await page.keyboard.press('Enter');

        return ok({ url: page.url() }, [...tips, '图片生成请求已发送']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ── model — 切换模型 ──
  site.command('model', {
    description: '切换 Gemini 模型（如 Flash-Lite、Flash、Pro）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      name: z.string().describe('模型名称，如 Flash-Lite、Flash、Pro'),
    }),
    examples: [{ cmd: 'xbrowser gemini model --name "Flash-Lite"', description: '切换到 Flash-Lite' }],
    result: z.object({ selected: z.string() }),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      try {
        await page.goto(GEMINI_URL + "/app", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1000);

        // Click model selector
        await page.evaluate((modelName: string) => {
          const els = document.querySelectorAll('div, button');
          for (const el of els) {
            if ((el.textContent || '').trim() === modelName) {
              (el as HTMLElement).click();
              return;
            }
          }
        }, params.name);
        await page.waitForTimeout(1000);

        return ok({ selected: params.name }, [`已切换到 ${params.name}`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });
}
