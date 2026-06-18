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
        // 1. 强制导航到 Gemini 新对话页（每次都导航，避免残留状态导致
        //    Quill editor 不可写或停在旧对话里）
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(5000);

        // 2. 输入提示词 — Gemini rich-textarea (Quill) 极严格：
        //    必须在导航后、无其他 DOM 操作干扰的情况下，同一 page.evaluate
        //    内先 focus 再 execCommand insertText。
        //    不要先点"上传和工具"/"制作图片"——会让 .ql-editor 失焦导致
        //    execCommand 失败。Gemini 默认就能根据"画xxx"prompt 生图。
        // execCommand insertText — 用字符串表达式（框架对字符串不包 IIFE，
        // 保留 execCommand 所需的 user activation 上下文）。
        // 注意：CSS 选择器里的双引号不需要转义（在 JS 模板字符串里）。
        const safePrompt = params.prompt.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        await page.evaluate(
          `(function(){var e=document.querySelector('.ql-editor');if(!e)return false;e.focus();return document.execCommand('insertText',false,'${safePrompt}');})()`
        ).catch(() => false);
        await page.waitForTimeout(800);

        // 5. 点发送（录制 action[49]）
        // 发送按钮：录制确认是 arrow_upward（输入框有内容后出现）
        await page.click('mat-icon[fonticon="arrow_upward"]', { timeout: 5000 }).catch(() => {});
        tips.push('已发送文生图请求，等待 Gemini 生成...');

        // 6. 等图片生成 — 检测到就立刻在同一 evaluate 里 fetch→base64，
        //    避免 blob URL 在跨 evaluate 间失效（blob 生命周期绑定 document）。
        const startTime = Date.now();
        let lastCount = 0;
        let stableTicks = 0;
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(3000);
          // 一次性：检测 + fetch + 转 base64，在同一页面上下文完成
          const result = await page.evaluate(async () => {
            const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(
              '.image-button img.loaded, .image-button img'
            )).filter(img => img.naturalWidth > 50);
            if (imgs.length === 0) return { count: 0, images: [] as Array<{ src: string; b64: string }> };
            // 立刻 fetch 每个 blob/http URL 转 base64
            const out: Array<{ src: string; b64: string }> = [];
            for (const img of imgs) {
              try {
                const resp = await fetch(img.src);
                const blob = await resp.blob();
                const b64 = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve((reader.result as string).replace(/^data:[^;]+;base64,/, ''));
                  reader.readAsDataURL(blob);
                });
                if (b64.length > 100) out.push({ src: img.src, b64 });
              } catch { /* ignore individual failure */ }
            }
            return { count: imgs.length, images: out };
          }).catch(() => ({ count: 0, images: [] })) as { count: number; images: Array<{ src: string; b64: string }> };

          // 稳定性检查：图片数稳定后（可能多张陆续生成完）才下载
          if (result.count > 0) {
            if (result.count === lastCount) {
              stableTicks++;
              // 2 个 tick（~6s）图片数不变 → 生成完成，下载
              if (stableTicks >= 2 && result.images.length > 0) {
                tips.push(`✓ Gemini 生成了 ${result.images.length} 张图片`);
                const downloadDir = `${process.env.HOME || '/tmp'}/.xbrowser/downloads`;
                const fsMod = await import('fs');
                const pathMod = await import('path');
                if (!fsMod.existsSync(downloadDir)) fsMod.mkdirSync(downloadDir, { recursive: true });
                const localPaths: string[] = [];
                const allUrls: string[] = [];
                for (let i = 0; i < result.images.length; i++) {
                  const item = result.images[i]!;
                  allUrls.push(item.src);
                  try {
                    const localPath = pathMod.join(downloadDir, `gemini_${Date.now()}_${i}.png`);
                    fsMod.writeFileSync(localPath, Buffer.from(item.b64, 'base64'));
                    localPaths.push(localPath);
                    const sz = fsMod.statSync(localPath).size;
                    tips.push(`📁 [${i + 1}/${result.images.length}] ${localPath} (${(sz / 1024).toFixed(0)}KB)`);
                  } catch (err) {
                    tips.push(`⚠️ [${i + 1}] 写文件失败: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }
                return ok({ images: allUrls, localPaths, status: 'completed' }, tips);
              }
            } else {
              stableTicks = 0;
            }
            lastCount = result.count;
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
