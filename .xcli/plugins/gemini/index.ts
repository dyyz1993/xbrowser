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
import { checkRefusal } from '../shared/refusal-detect.js';

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

  // ── image — 文生图（实测修复 2026-06-17）──
  // 根因调查（详见提交记录）：
  //   ❌ 之前的假设全错：execCommand/keyboard.type/cdp-tunnel 都不是问题
  //   ✅ 真正的两个 bug：
  //      1. 发送用了 page.click() 合成事件 → isTrusted=false 被 Angular 拒绝
  //      2. （次要）execCommand insertText 依赖 user activation，CDP evaluate 无激活
  //   修复：
  //      - 输入：keyboard.type（真键盘，与 chatgpt/doubao/qwen 统一）
  //      - 发送：真鼠标坐标点击 page.mouse.click(x,y)，Input.dispatchMouseEvent isTrusted=true
  //   验证：点击后 url /app → /app/{conversationId}，editor 清空，发送成功
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

        // 2. 切换到"制作图片"模式（关键！）。
        //    Gemini 默认是聊天模式，描述性 prompt（无"画"字）只回文字不生图。
        //    必须主动切生图模式：点"上传和工具" → 点"制作图片"。
        //    实测：切后 .ql-editor 还在，输入/发送流程不变。
        //    全程真鼠标点击（合成事件 isTrusted=false 会被 Angular 拒）。
        const toolsClicked = await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label="上传和工具"]');
          if (!btn) return false;
          const r = btn.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }).catch(() => false);
        if (toolsClicked) {
          await page.mouse.click(toolsClicked.x, toolsClicked.y).catch(() => {});
          await page.waitForTimeout(1200);
          // 菜单展开后点"制作图片"
          const imageModeClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const b = btns.find(x => (x.textContent || '').trim() === '制作图片');
            if (!b) return false;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          }).catch(() => false);
          if (imageModeClicked) {
            await page.mouse.click(imageModeClicked.x, imageModeClicked.y).catch(() => {});
            tips.push('已切换到制作图片模式');
          } else {
            tips.push('⚠️ 未找到"制作图片"入口，尝试直接发送（依赖 prompt 关键词触发）');
          }
          await page.waitForTimeout(1500);
        } else {
          tips.push('⚠️ 未找到"上传和工具"按钮，尝试直接发送');
        }

        // 3. 输入提示词 — 实测 keyboard.type 在 Gemini rich-textarea (Quill) 上完全工作。
        //    与 chatgpt/doubao/qwen 统一：真键盘事件 Input.dispatchKeyEvent。
        await page.locator('.ql-editor').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
        await page.keyboard.type(params.prompt, { delay: 15 });
        await page.waitForTimeout(400);

        // 4. 点发送 — 必须用真鼠标点击（Input.dispatchMouseEvent，isTrusted=true）。
        //    page.click() / locator.click() 是合成事件 isTrusted=false，会被
        //    Gemini Angular 拒绝（点完 url 不跳转、editor 不清空）。
        //    实测：真鼠标坐标点击后 url /app → /app/{conversationId}，editor 清空。
        const sendClicked = await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label="发送"], button[aria-label="Send"]');
          if (!btn || (btn as HTMLButtonElement).disabled) return null;
          const r = (btn as HTMLElement).getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }).catch(() => null);
        if (sendClicked) {
          await page.mouse.click(sendClicked.x, sendClicked.y).catch(() => {});
        } else {
          // 兜底：尝试 Enter 键发送
          await page.keyboard.press('Enter').catch(() => {});
        }
        tips.push('已发送文生图请求，等待 Gemini 生成...');

        // 5. 等图片生成 — 检测到就立刻在同一 evaluate 里用 canvas 提取 base64。
        //    ⚠️ 不能用 fetch(blobUrl)！Gemini 生成的图是 blob: URL，会被很快
        //    revoke，跨 evaluate fetch 报 "Failed to fetch"。
        //    canvas.toDataURL() 直接从已加载的 <img> 像素提取，绕过 blob 生命周期。
        //    实测：1024×559 图成功提取 1.25MB PNG。
        const startTime = Date.now();
        let lastCount = 0;
        let stableTicks = 0;
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(3000);
          // 拒绝/错误文案检测：没图时才查，避免误判"先出图后说话"。
          const refusal = await checkRefusal(page, ['.model-response-text', 'message-content', '.response-container']).catch(() => ({ refused: false, reason: null, text: '' }));
          if (refusal.refused && refusal.reason) {
            tips.push('⚠️ Gemini 拒绝生图（' + refusal.reason + '）：' + refusal.text.substring(0, 100));
            return fail('Gemini 拒绝生图', ['请检查 Gemini 登录状态或更换提示词', ...tips]);
          }
          // 一次性：检测 + canvas 提取 base64，在同一页面上下文完成
          const result = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(
              '.image-button img'
            )).filter(img => img.naturalWidth > 100 && img.complete);
            if (imgs.length === 0) return { count: 0, images: [] as Array<{ src: string; b64: string }> };
            // canvas 提取每个 img 的像素数据 → base64
            const out: Array<{ src: string; b64: string }> = [];
            for (const img of imgs) {
              try {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                if (!ctx) continue;
                ctx.drawImage(img, 0, 0);
                const dataUrl = c.toDataURL('image/png');
                const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
                if (b64.length > 100) out.push({ src: img.src, b64 });
              } catch { /* tainted canvas 或其他，忽略 */ }
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
      return ok({ loggedIn, url }, [`登录状态: ${loggedIn ? '✅' : '❌'}`]);
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
