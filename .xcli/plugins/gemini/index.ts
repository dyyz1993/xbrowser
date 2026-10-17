/**
 * Google Gemini 插件
 * list — 从页面文本提取会话历史
 * chat — 发送消息
 */
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { usageCommandHandler, usageResultSchema } from './usage.js';
import { registerBridgeCommands } from './bridge.js';
import { registerGenerateCommands } from './generate.js';
import { registerHistoryCommands } from './history.js';
import { registerMusicCommands } from './music.js';

const GEMINI_URL = 'https://gemini.google.com';
type Page = import('../types').Page;

function buildCdpTips(ctx: unknown): string[] {
  const cdp = (ctx as Record<string, unknown>).cdpEndpoint as string | undefined;
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

  // ── music — 生成音乐 ──
  site.command('usage', {
    description: '读取 Gemini 当前用量和周限额（含重置时间）',
    scope: 'page',
    loginRequired: 'required',
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser --cdp 9221 gemini usage', description: '输出当前用量、周限额和重置时间' },
      { cmd: 'xbrowser --cdp 9221 --json gemini usage', description: 'JSON 输出' },
    ],
    result: usageResultSchema,
    handler: async (_params, ctx) => usageCommandHandler(_params, ctx),
  });

  registerBridgeCommands(site);
  registerGenerateCommands(site);
  registerHistoryCommands(site);
  registerMusicCommands(site);

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
