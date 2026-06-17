/**
 * Google Gemini 插件
 * list — 从页面文本提取会话历史
 * chat — 发送消息
 */
import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import * as path from 'path';
import * as fs from 'fs';
import { smartExtractReply } from '../shared/smart-extract.js';

const GEMINI_URL = 'https://gemini.google.com';
type Page = import('../types').Page;

function buildCdpTips(ctx: CommandContext): string[] {
  const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint as string | undefined;
  return cdp ? [] : ['建议使用 --cdp 9221 连接已登录浏览器'];
}

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
    result: z.object({ conversationUrl: z.string(), response: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildCdpTips(ctx);
      try {        // Navigate to Gemini if needed
        try {
          await page.goto(GEMINI_URL + '/app', { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch {
          await page.evaluate((u: string) => { window.location.href = u; }, GEMINI_URL + '/app');
        }
        await new Promise(r => setTimeout(r, 5000));
        // Type and send message（keyboard.type 真实按键，不用 page.fill 合成事件）
        const inputSel = '[aria-label*="输入提示"], [contenteditable="true"]';
        await page.locator(inputSel).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);        await page.keyboard.type(params.message, { delay: 10 });        await page.waitForTimeout(400);
        await page.keyboard.press('Enter');
        // 等回复
        await new Promise(r => setTimeout(r, 3000));
        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(2000);
          try {
            responseText = await page.evaluate(() => {
              const all = document.querySelectorAll('[class*="model-response-text"], [class*="response-container"], [data-message-author-role="model"], .markdown');
              for (let i = all.length - 1; i >= 0; i--) {
                const t = (all[i].textContent || '').trim();
                if (t.length > 0) return t.slice(0, 8000);
              }
              return '';
            }) as string;
            if (responseText) break;
          } catch { /* continue */ }
        }

        // smart 兜底
        if (!responseText) {
          const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint as string | undefined;
          responseText = await smartExtractReply(page, params.message, 'gemini 聊天页，用户发了消息等待 AI 回复', cdp).catch(() => '') as string;
        }

        return ok({ conversationUrl: page.url(), response: responseText }, [...tips, responseText ? 'AI 回复已收到' : '消息已发送，回复超时']);
      } catch (error) {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
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
        const inputSel2 = '[aria-label*="输入提示"], [contenteditable="true"]';
        await page.locator(inputSel2).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
        await page.keyboard.type(params.prompt, { delay: 10 });
        await page.waitForTimeout(400);
        await page.keyboard.press('Enter');

        return ok({ url: '' }, [...tips, `音乐生成请求已发送: "${params.prompt}"`]);
      } catch (error) {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
  });

  // ── check-login ──
  site.command('check-login', {
    description: '检查 Gemini 登录状态',
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ loggedIn: z.boolean(), url: z.string().optional() }).passthrough(),
    handler: async (_params, ctx) => {
      const page = ctx.page;
      if (!page) return fail({ message: '需要浏览器页面' });
      const url = page.url();
      const loggedIn = !url.includes('/login') && !url.includes('/signin') && (url.includes('gemini.google.com') || url === 'about:blank');
      return ok({ data: { loggedIn, url } }, [`登录状态: ${loggedIn ? '✅' : '❌'}`]);
    },
  });

  // ── attach — 上传附件 ──
  site.command('attach', {
    description: '上传附件（图片/文件）',
    requiresLogin: true,
    scope: 'page',
    parameters: z.object({
      path: z.string().describe('文件路径'),
    }),
    result: z.object({ uploaded: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildCdpTips(ctx);
      const absPath = path.resolve(params.path);
      if (!fs.existsSync(absPath)) return fail('文件不存在', [absPath]);
      try {
        const buf = fs.readFileSync(absPath);
        const ext = path.extname(absPath).toLowerCase();
        const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
        const payload = { name: path.basename(absPath), mimeType: mime[ext] || 'application/octet-stream', buffer: buf };
        const p = page as unknown as { setInputFiles?: (s: string, f: unknown[]) => Promise<void> };
        await p.setInputFiles?.('input[type="file"]', [payload]);
        await new Promise(r => setTimeout(r, 2000));
        return ok({ uploaded: true }, [...tips, `✓ 已上传: ${path.basename(absPath)}`]);
      } catch (e) {
        return fail('上传失败', [(e as Error).message]);
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
