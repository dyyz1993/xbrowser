/**
 * Google Gemini 插件
 * list — 从页面文本提取会话历史
 * chat — 发送消息
 */
import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

const GEMINI_URL = 'https://gemini.google.com';
type Page = import('../types').Page;

async function getPage(ctx: CommandContext): Promise<Page> {
  const anyCtx = ctx as unknown as Record<string, unknown>;
  let pg = anyCtx.page as Page | undefined;
  // If page from ctx is broken (daemon context issue), get from browserContext
  if (pg && typeof (pg as unknown as Record<string, unknown>).evaluate !== 'function') {
    try {
      if ((anyCtx as Record<string, unknown>).browserContext && typeof (anyCtx as Record<string, unknown>).browserContext === 'object') {
        const bc = anyCtx.browserContext as Record<string, unknown> | undefined;
        if (bc && typeof bc.newPage === 'function') {
          pg = await (bc.newPage as () => Promise<Page>)();
        }
      }
    } catch { /* ignore */ }
    // Also try browser.newPage
    if ((!pg || typeof (pg as unknown as Record<string, unknown>).evaluate !== 'function') && (anyCtx as Record<string, unknown>).browser) {
      const browser = anyCtx.browser as Record<string, unknown> | undefined;
      if (browser && typeof browser.newContext === 'function') {
        try {
          const bc = await (browser.newContext as () => Promise<Record<string, unknown>>)();
          pg = await (bc.newPage as () => Promise<Page>)();
        } catch { /* ignore */ }
      }
    }
    if (!pg || typeof (pg as unknown as Record<string, unknown>).evaluate !== 'function') {
      // Last resort: use the page from the session stored in memory
      const { findSession } = await import('../../src/browser.js');
      const sid = anyCtx.sessionId as string;
      if (sid) {
        const sess = findSession(sid);
        if (sess?.page && typeof (sess.page as unknown as Record<string, unknown>).evaluate === 'function') {
          pg = sess.page;
        }
      }
    }
    if (!pg || typeof (pg as unknown as Record<string, unknown>).evaluate !== 'function') {
      throw new Error('页面不可用');
    }
  }
  return pg!;
}

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
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({}),
    result: z.array(z.object({ index: z.number(), title: z.string() })),
    handler: async (_params, ctx) => {
      const page = await getPage(ctx);
      const tips = buildCdpTips(ctx);
      try {
        const bodyText = await page.evaluate(() => document.body?.innerText || '');

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
      } catch {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
  });

  // ── chat — 发送消息 ──
  site.command('chat', {
    description: '发送消息',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({ message: z.string() }),
    result: z.object({ conversationUrl: z.string() }),
    handler: async (params, ctx) => {
      const page = await getPage(ctx);
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
      } catch {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
  });

  // ── music — 生成音乐 ──
  site.command('music', {
    description: '生成音乐（打开制作音乐工具并发送提示）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      prompt: z.string().describe('音乐描述，如"一首轻快的钢琴曲"'),
    }),
    result: z.object({ url: z.string() }),
    handler: async (params, ctx) => {
      const page = await getPage(ctx);
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
      } catch {
        return fail((error as Error).message || '未知错误', tips);
      }
    },
  });
}
