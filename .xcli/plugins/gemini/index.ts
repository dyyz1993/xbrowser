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

        // 记录发送前的对话数量，定位新增回复
        const convBefore = await page.evaluate(() => document.querySelectorAll('[data-test-id="conversation"]').length).catch(() => 0);

        // 等新增 conversation 出现 + 回复完成
        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(2000);
          try {
            responseText = await page.evaluate((before: number) => {
              const convs = document.querySelectorAll('[data-test-id="conversation"]');
              for (let i = convs.length - 1; i >= before; i--) {
                const txt = (convs[i].textContent || '').trim();
                if (txt.length > 0) {
                  const gi = txt.indexOf('Gemini 说');
                  if (gi >= 0) return txt.slice(gi + 7).trim().slice(0, 8000);
                  return txt.slice(0, 8000);
                }
              }
              return '';
            }, convBefore) as string;
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

  // ── image — 文生图（录制确认流程 2026-06-17）──
  // Gemini 文生图入口：点"上传和工具" → "制作图片" → 输入提示词 → 发送 → 等 .image-button
  site.command('image', {
    description: '文生图（Gemini Imagen）',
    requiresLogin: false,
    scope: 'browser',
    parameters: z.object({
      prompt: z.string().describe('图片描述提示词'),
    }),
    result: z.object({ images: z.array(z.string()).optional(), status: z.string() }).passthrough(),
    examples: [
      { cmd: 'xbrowser gemini image --prompt "画一只可爱的猫咪"', description: '文生图' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildCdpTips(ctx);
      try {
        // 1. 导航到 Gemini
        if (!page.url().includes('gemini.google.com')) {
          await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(5000);
        }

        // 2. 点"上传和工具"弹菜单（录制 action[14]）
        await page.click('[aria-label="上传和工具"]', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
        // 3. 点"制作图片"切换到图片模式（录制 action[16]）
        await page.evaluate(() => {
          const items = document.querySelectorAll('toolbox-drawer-item button span, [role="menuitem"], span');
          for (const el of items) {
            if ((el.textContent || '').trim() === '制作图片') { (el as HTMLElement).click(); return; }
          }
        }).catch(() => {});
        await page.waitForTimeout(500);

        // 4. 输入提示词（录制 action[17]）
        await page.locator('[aria-label="为 Gemini 输入提示"], .ql-editor').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
        await page.keyboard.type(params.prompt, { delay: 15 });
        await page.waitForTimeout(400);

        // 5. 点发送（录制 action[49]）
        await page.click('mat-icon[fonticon="arrow_upward"]', { timeout: 5000 }).catch(() => {});
        tips.push('已发送文生图请求，等待 Gemini 生成...');

        // 6. 等图片生成（等 .image-button 出现）
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(3000);
          const found = await page.evaluate(() => {
            const imgs = document.querySelectorAll('.image-button img, .response-content img');
            return Array.from(imgs).map(img => (img as HTMLImageElement).src).filter(s => s && s.startsWith('http'));
          }).catch(() => [] as string[]) as string[];
          if (found.length > 0) {
            tips.push(`✓ Gemini 生成了 ${found.length} 张图片`);
            return ok({ images: found, status: 'completed' }, tips);
          }
        }
        tips.push('⚠ Gemini 生成超时');
        return ok({ images: [], status: 'timeout' }, tips);
      } catch {
        return fail('文生图失败', ['请检查 Gemini 登录状态']);
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

  // ── attach — 上传附件（录制确认流程） ──
  // gemini 上传流程（录制 actions [31][32][36]）：
  //   1. click [aria-label="上传和工具"] → 弹菜单
  //   2. click "上传文件"（span.menu-text）→ 触发 filechooser
  //   3. setInputFiles('input[type=file]') 注入文件
  site.command('attach', {
    description: '上传附件（图片/文件）',
    requiresLogin: false,
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

        // 1. 点"上传和工具"按钮弹菜单
        await page.click('[aria-label="上传和工具"]', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        // 2. 点"上传文件"菜单项
        await page.evaluate(() => {
          const items = document.querySelectorAll('span.menu-text, [class*="menu-text"], [role="menuitem"]');
          for (const el of items) {
            if ((el.textContent || '').includes('上传文件')) { (el as HTMLElement).click(); return; }
          }
        }).catch(() => {});
        await page.waitForTimeout(500);
        // 3. 等 file input 挂载 + 注入文件
        await page.waitForSelector('input[type="file"]', { timeout: 5000 }).catch(() => {});
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
