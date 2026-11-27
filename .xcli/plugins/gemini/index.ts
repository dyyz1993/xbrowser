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
import { loginWithHandoff } from '../shared/login-handoff.js';

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

  // ── login — 引导用户完成 Google 登录 ──
  site.command('login', {
    description: '登录 Gemini（Google 账号）',
    scope: 'browser',
    parameters: z.object({
      timeout: z.number().min(30).max(600).default(300).describe('打算等待登录完成的秒数（当前不阻塞：未登录即以 NEEDS_HUMAN 结束，登录后重跑）'),
    }),
    examples: [{ cmd: 'xbrowser gemini login', description: '打开 Gemini 并等待完成登录' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');

      const tips = buildCdpTips(ctx);
      // fail-closed 语义下必须「先检查、再交还」：已登录直接成功；未登录（被 Google 带到登录页）
      // 才打开 Gemini 并交还控制权（ctx.waitForHuman 抛 NEEDS_HUMAN，命令到此结束）。
      try {
        const { url, alreadyLoggedIn } = await loginWithHandoff({
          page,
          ctx,
          checkUrl: GEMINI_URL,
          loginUrl: GEMINI_URL,
          reason: '请在浏览器中完成 Google 登录，然后重新执行 xbrowser gemini login',
          timeout: params.timeout,
          check: async (p) => {
            const current = p.url();
            return current.includes('gemini.google.com') && !current.includes('/login') && !current.includes('/signin');
          },
        });

        await ctx.storage.set('gemini_login', { loggedIn: true, at: Date.now() });

        return ok({ loggedIn: true, url }, [
          ...tips,
          alreadyLoggedIn ? 'Gemini 已是登录状态' : 'Gemini 登录成功',
        ]);
      } catch (e) {
        // 人工交还（NEEDS_HUMAN）不是网络错误：原样抛出，运行时转成结构化结果
        const err = e as { code?: unknown; message?: unknown } | null;
        if (err && typeof err === 'object' && err.code === 'NEEDS_HUMAN') throw e;
        // 交还后复核仍停在登录页（只有 waitForHuman 真的返回才会发生）：如实报未完成
        if (typeof err?.message === 'string' && err.message.includes('仍未检测到登录态')) {
          return fail('Gemini 登录未完成（交还后仍停在登录页）', tips);
        }
        return fail(`无法打开 ${GEMINI_URL}（网络不可达或被阻止）`, tips);
      }
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
        const url = page.url();
        if (!url.includes('gemini.google.com')) {
          await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await new Promise(r => setTimeout(r, 3000));
        }
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

        return ok(
          conversations.map((title: string, i: number) => ({ index: i, title })),
          conversations.length === 0
            ? [...tips, '登录后即可同步历史会话；先运行 xbrowser gemini login']
            : tips,
        );
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
          return fail(`无法打开 ${GEMINI_URL}/app（网络不可达或被阻止）`, [
            ...tips,
            '请检查网络连接，或使用 --cdp 连接已有浏览器',
          ]);
        }

        // Wait for interactive element with timeout instead of fixed 5s
        try {
          await page.waitForSelector('[contenteditable="true"], [aria-label*="输入提示"]', {
            timeout: 10000,
          });
        } catch {
          return fail('Gemini 页面加载超时（输入框 10s 未出现）', [
            ...tips,
            '如果未登录，先运行: xbrowser gemini login',
          ]);
        }

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
