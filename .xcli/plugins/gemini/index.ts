/**
 * Google Gemini 插件
 * list — 从页面文本提取会话历史
 * chat — 发送消息
 */
import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import fs from 'node:fs';
import path from 'node:path';
import { imageCommandConfig, imageCommandHandler, setImageHelpers } from './image.js';

const GEMINI_URL = 'https://gemini.google.com';
type Page = import('../types').Page;

const IMAGE_MODE_SELECTORS = [
  'button[aria-label*="图片"]',
  'button[aria-label*="Image"]',
  '[role="button"][aria-label*="图片"]',
  '[role="button"][aria-label*="Image"]',
  '[data-test-id*="image"]',
].join(', ');

const INPUT_SELECTORS = [
  '[aria-label*="输入提示"]',
  '[aria-label*="Enter a prompt"]',
  '[role="textbox"][contenteditable="true"]',
  '[contenteditable="true"]',
  'textarea',
].join(', ');

const SEND_SELECTORS = [
  'button[aria-label*="发送"]',
  'button[aria-label*="Send"]',
  'button[type="submit"]',
].join(', ');

function buildCdpTips(ctx: CommandContext): string[] {
  const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint as string | undefined;
  return cdp ? [] : ['建议使用 --cdp 9221 连接已登录浏览器'];
}

async function clickImageMode(page: Page): Promise<boolean> {
  return page.evaluate((selectors: string) => {
    const buttons = Array.from(document.querySelectorAll(selectors)) as HTMLElement[];
    const button = buttons.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
    if (!button) return false;
    button.click();
    return true;
  }, IMAGE_MODE_SELECTORS).catch(() => false);
}

async function typePrompt(page: Page, prompt: string): Promise<void> {
  const typed = await page.evaluate((data: { selectors: string; prompt: string }) => {
    const inputs = Array.from(document.querySelectorAll(data.selectors)) as HTMLElement[];
    const input = inputs.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!input) return false;
    input.focus();
    if (input instanceof HTMLTextAreaElement) {
      input.value = data.prompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.textContent = data.prompt;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: data.prompt }));
    }
    return true;
  }, { selectors: INPUT_SELECTORS, prompt }).catch(() => false);
  if (!typed) throw new Error('找不到 Gemini 输入框');
}

async function submitPrompt(page: Page): Promise<void> {
  const clicked = await page.evaluate((selectors: string) => {
    const buttons = Array.from(document.querySelectorAll(selectors)) as HTMLButtonElement[];
    const button = buttons.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !el.disabled;
    });
    if (!button) return false;
    button.click();
    return true;
  }, SEND_SELECTORS).catch(() => false);
  if (!clicked) await page.keyboard.press('Enter');
}

async function collectNewImages(
  page: Page,
  beforeUrls: string[],
  timeoutMs: number,
): Promise<string[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const urls = await page.evaluate((exclude: string[]) => {
      const excluded = new Set(exclude);
      const found = new Set<string>();
      for (const image of Array.from(document.querySelectorAll('img')) as HTMLImageElement[]) {
        const src = image.currentSrc || image.src;
        if (!src.startsWith('http') || excluded.has(src)) continue;
        const rect = image.getBoundingClientRect();
        if (rect.width < 180 || rect.height < 180) continue;
        const context = image.closest('a,button,[role="button"]');
        if (context && context.textContent?.match(/登录|Sign in|升级|Upgrade/)) continue;
        found.add(src);
      }
      return [...found];
    }, beforeUrls).catch(() => [] as string[]);
    if (urls.length > 0) return urls;
  }
  return [];
}

async function downloadImages(urls: string[]): Promise<string[]> {
  const outputDir = path.join(process.env.HOME || '/tmp', '.xbrowser', 'downloads');
  fs.mkdirSync(outputDir, { recursive: true });
  const paths: string[] = [];
  for (const url of urls) {
    const localPath = path.join(outputDir, `gemini_image_${Date.now()}_${paths.length}.png`);
    const response = await fetch(url);
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024) continue;
    fs.writeFileSync(localPath, bytes);
    paths.push(localPath);
  }
  return paths;
}

setImageHelpers({ clickImageMode, typePrompt, submitPrompt, collectNewImages, downloadImages });

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'gemini',
    url: GEMINI_URL,
    description: 'Google Gemini AI 助手',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return true;
        const url = page.url();
        if (url === 'about:blank' || url === '' || !url.includes('gemini.google.com')) return true;
        if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) return false;
        return true;
      } catch { return true; }
    },
  });

  // ── list — 从页面文本提取会话 ──
  site.command('list', {
    description: '列出历史会话',
    scope: 'page',
    parameters: z.object({}),
    result: z.array(z.object({ index: z.number(), title: z.string() })),
    handler: async (_params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildCdpTips(ctx);
      try {
        const bodyText = await page.evaluate(() => document.body?.innerText || '') as string;

        const lines = bodyText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 2);
        const recentIdx = lines.findIndex((l: string) => l.includes('最近'));
        const titles = recentIdx >= 0 ? lines.slice(recentIdx + 1) : lines;
        const seen = new Set<string>();
        const conversations = titles.filter((t: string) => {
          if (seen.has(t)) return false;
          if (t.length < 3 || t.length > 80) return false;
          if (['Gemini','笔记本','新建','发起','搜索','库','升级','设置','账号','映洲','Pro'].some(k => t.includes(k))) return false;
          seen.add(t);
          return true;
        }).slice(0, 30);

        return ok(conversations.map((title: string, i: number) => ({ index: i, title })), tips);
      } catch (error) {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
  });

  // ── chat — 发送消息 ──
  site.command('chat', {
    description: '发送消息',
    scope: 'page',
    parameters: z.object({ message: z.string() }),
    result: z.object({ conversationUrl: z.string() }),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildCdpTips(ctx);
      try {
        // Navigate to Gemini if needed
        try {
          await page.goto(GEMINI_URL + '/app', { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch {
          await page.evaluate((u: string) => { window.location.href = u; }, GEMINI_URL + '/app');
        }
        await new Promise(r => setTimeout(r, 5000));

        // Type and send message
        const inputSel = '[aria-label*="输入提示"], [contenteditable="true"]';
        try {
          await page.fill(inputSel, params.message);
        } catch {
          await page.evaluate((msg: string) => {
            const el = document.querySelector('[aria-label*="输入提示"], [contenteditable="true"]');
            if (el) (el as HTMLElement).textContent = msg;
          }, params.message);
        }
        await page.keyboard.press('Enter');

        return ok({ conversationUrl: '' }, [...tips, '消息已发送']);
      } catch (error) {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
  });

  // ── image — 快速图片生成 ──
  site.command('image', {
    ...imageCommandConfig(),
    handler: async (params, ctx) => imageCommandHandler(params, ctx),
  });

  // ── music — 生成音乐 ──
  site.command('music', {
    description: '生成音乐（打开制作音乐工具并发送提示）',
    scope: 'page',
    parameters: z.object({
      prompt: z.string().describe('音乐描述，如"一首轻快的钢琴曲"'),
    }),
    result: z.object({ url: z.string() }),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildCdpTips(ctx);
      try {
        // Navigate to Gemini
        await page.goto(GEMINI_URL + '/app', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(r => setTimeout(r, 4000));

        // Click upload/tools button
        await page.evaluate(() => {
          const btn = document.querySelector('[aria-label*="上传和工具"]');
          if (btn) (btn as HTMLElement).click();
        });
        await new Promise(r => setTimeout(r, 1000));

        // Click "制作音乐"
        await page.evaluate(() => {
          const items = document.querySelectorAll('[class*="drawer-item"], div, button');
          for (const el of items) {
            if ((el.textContent || '').includes('制作音乐')) {
              (el as HTMLElement).click();
              return;
            }
          }
        });
        await new Promise(r => setTimeout(r, 1000));

        // Type prompt and send
        const inputSel = '[aria-label*="输入提示"], [contenteditable="true"]';
        await page.fill(inputSel, params.prompt);
        await page.keyboard.press('Enter');

        return ok({ url: '' }, [...tips, `音乐生成请求已发送: "${params.prompt}"`]);
      } catch (error) {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    if (!page) return;
    await page.goto(GEMINI_URL);
    await ctx.storage.set('gemini_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('gemini_login');
  });
}
