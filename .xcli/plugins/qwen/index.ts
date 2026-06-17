import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import path from 'path';
import fs from 'fs';
import type { PluginPage, PluginElementHandle } from '../types.js';
import { smartExtractReply } from '../shared/smart-extract.js';

type Page = import('../types').Page;
type Response = import('../types').Response;

const QWEN_URL = 'https://www.qianwen.com';

const CDN_HOST = 'workspace-zb-cdn.qianwen.com';
const WANX_HOST = 'wanx.alicdn.com';

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const options = ctxAny.options as Record<string, unknown> | undefined;
  const cdp = ctxAny.cdpEndpoint || options?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}

async function safeClickText(page: Page, text: string): Promise<boolean> {
  const handle = await (page as unknown as PluginPage).evaluateHandle((t: string) => {
    const els = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"], [role="tab"], span[role="button"]'));
    return els.find(el => {
      const txt = (el.textContent || '').trim();
      return txt === t || txt.includes(t);
    }) || null;
  }, text);
  const el = (handle as unknown as PluginElementHandle).asElement();
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function safeClickSelector(page: Page, selector: string): Promise<boolean> {
  const handle = await (page as unknown as PluginPage).evaluateHandle(
    (sel: string) => document.querySelector(sel),
    selector,
  );
  const el = (handle as unknown as PluginElementHandle).asElement();
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function setReactInput(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(({ sel, val }: { sel: string; val: string }) => {
    const el = document.querySelector(sel) as HTMLTextAreaElement | HTMLInputElement | null;
    if (!el) return false;
    const ctor = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(ctor, 'value')?.set;
    if (!setter) return false;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: selector, val: value });
}

async function uploadFileViaDataTransfer(page: Page, absPath: string): Promise<boolean> {
  const data = fs.readFileSync(absPath);
  const b64 = data.toString('base64');
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
  };
  const ext = path.extname(absPath).toLowerCase();
  const mime = mimeMap[ext] || 'application/octet-stream';

  const result = await page.evaluate(({ b64data, filename, mimeType }) => {
    const fi = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fi) return false;

    const byteChars = atob(b64data);
    const byteNums = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNums[i] = byteChars.charCodeAt(i);
    }
    const file = new File([byteNums], filename, { type: mimeType });

    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(fi, 'files', { value: dt.files });
    fi.dispatchEvent(new Event('change', { bubbles: true }));
    return fi.files.length > 0;
  }, { b64data: b64, filename: path.basename(absPath), mimeType: mime }) as boolean;

  return result;
}

async function ensurePage(page: Page): Promise<void> {
  const url = page.url();
  if (!url.includes('qianwen.com') && !url.includes('tongyi.aliyun.com')) {
    await page.goto(QWEN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  }
}

async function checkLogin(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hasInput = !!document.querySelector('div[role="textbox"][contenteditable="true"]');
    const bodyText = document.body?.textContent?.trim().slice(0, 300) || '';
    const hasLoginButton = bodyText.includes('登录') && !bodyText.includes('通义千问') && !bodyText.includes('AI');
    return hasInput && !hasLoginButton;
  }) as Promise<boolean>;
}

async function enterImageMode(page: Page): Promise<boolean> {
  const clicked = await safeClickText(page, 'AI生图');
  if (clicked) {
    await page.waitForTimeout(1500);
    return true;
  }

  const clicked2 = await safeClickText(page, '生图');
  if (clicked2) {
    await page.waitForTimeout(1500);
    return true;
  }

  const clicked3 = await safeClickText(page, '图像生成');
  if (clicked3) {
    await page.waitForTimeout(1500);
    return true;
  }

  return false;
}

async function setRatio(page: Page, ratio: string): Promise<boolean> {
  const ratioBtns = ['比例', '画面比例', '宽高比'];
  for (const btnText of ratioBtns) {
    const opened = await safeClickText(page, btnText);
    if (opened) {
      await page.waitForTimeout(500);
      break;
    }
  }

  const clicked = await safeClickText(page, ratio);
  if (clicked) {
    await page.waitForTimeout(300);
    return true;
  }

  const clickedByDropdown = await page.evaluate((r: string) => {
    const items = document.querySelectorAll('[class*="ratio"], [class*="size"], [class*="option"], [role="option"], [role="menuitem"]');
    for (const item of items) {
      if ((item.textContent || '').trim().includes(r)) {
        (item as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, ratio);
  if (clickedByDropdown) {
    await page.waitForTimeout(300);
    return true;
  }

  return false;
}

async function inputPrompt(page: Page, prompt: string): Promise<boolean> {
  const contentEditable = await page.evaluate(() => {
    return !!document.querySelector('div[role="textbox"][contenteditable="true"]');
  });

  if (contentEditable) {
    const inputLocator = page.locator('div[role="textbox"][contenteditable="true"]').first();
    await inputLocator.click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const el = document.querySelector('div[role="textbox"][contenteditable="true"]');
      if (el) el.textContent = '';
    });
    await page.keyboard.type(prompt, { delay: 30 });
    return true;
  }

  const textareaSet = await setReactInput(page, 'textarea', prompt);
  if (textareaSet) {
    await safeClickSelector(page, 'textarea');
    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');
    return true;
  }

  return false;
}

async function clickSend(page: Page): Promise<boolean> {
  const sendSelectors = [
    'button[aria-label="发送消息"]',
    'button[aria-label="发送"]',
    'button[aria-label="Send"]',
  ];
  for (const sel of sendSelectors) {
    const clicked = await safeClickSelector(page, sel);
    if (clicked) return true;
  }

  const sendByText = await safeClickText(page, '发送');
  if (sendByText) return true;

  await page.keyboard.press('Enter');
  return true;
}

async function waitForImages(page: Page, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const urls: string[] = [];

  while (Date.now() < deadline) {
    const found = await page.evaluate(({ cdn, wanx }) => {
      const imgs = document.querySelectorAll('img');
      const result: string[] = [];
      for (const img of imgs) {
        const src = (img as HTMLImageElement).src || '';
        const loaded = (img as HTMLImageElement).naturalWidth > 50;
        // Match multiple CDN patterns
        const isCDN = src.includes(cdn) || src.includes(wanx) || (src.includes('.png') && src.includes('%2F'));
        if (loaded && isCDN) {
          result.push(src);
        }
      }
      return result;
    }, { cdn: CDN_HOST, wanx: WANX_HOST }) as string[];

    if (found.length > 0) {
      for (const u of found) {
        if (!urls.includes(u)) urls.push(u);
      }
      if (urls.length > 0) return urls;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  return urls;
}

async function captureNetworkImages(page: Page, timeoutMs: number): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const urls: string[] = [];
    setTimeout(() => {
      page.off('response', handler);
      resolve(urls);
    }, timeoutMs);

    const handler = async (resp: Response) => {
      const url = resp.url();
      const isCDN = url.includes(CDN_HOST) || url.includes(WANX_HOST) || (url.includes('.png') && url.includes('%2F'));
      if (isCDN && resp.status() === 200) {
        if (!urls.includes(url)) urls.push(url);
      }
    };

    page.on('response', handler);
  });
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'qwen',
    url: QWEN_URL,
    description: '千问 (Qwen) — AI 图片生成',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const url = page.url();
        if (url.includes('/login') || url.includes('/auth') || url.includes('/passport')) return false;
        return checkLogin(page);
      } catch {
        return false;
      }
    },
  });

  site.command('image', {
    description: '千问 AI 图片生成（文生图）',
    scope: 'browser',
    parameters: z.object({
      prompt: z.string().describe('图片描述提示词'),
      image: z.string().optional().describe('参考图片本地路径（可选，用于图生图）'),
      ratio: z.string().optional().describe('画面比例: 1:1, 16:9, 9:16, 4:3（默认 1:1）'),
      wait: z.coerce.number().int().positive().optional().describe('同步等待秒数（如 --wait 60），不传则异步提交'),
    }),
    result: z.object({ images: z.array(z.string()).optional(), status: z.string().optional(), prompt: z.string().optional(), ratio: z.string().optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser qwen image --prompt "画一只可爱的猫咪" --cdp 9221', description: '基础文生图' },
      { cmd: 'xbrowser qwen image --prompt "皮克斯风格建筑" --ratio 16:9 --cdp 9221', description: '指定比例' },
      { cmd: 'xbrowser qwen image --prompt "改成水彩风格" --image ./photo.jpg --cdp 9221', description: '图生图' },
      { cmd: 'xbrowser qwen image --prompt "赛博朋克城市" --wait 60 --cdp 9221', description: '同步等待结果' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildTips(ctx);
        const waitSeconds = typeof params.wait === 'number' ? params.wait : 0;

        await ensurePage(page);
        await page.waitForTimeout(2000);

        const loggedIn = await checkLogin(page);
        if (!loggedIn) {
          const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
          throw new Error(
            '千问 (Qwen) 未登录！\n' +
            (cdp
              ? '  使用 --cdp 连接的浏览器未登录千问，请先在浏览器中登录。'
              : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser qwen image --prompt "..." --cdp http://localhost:9221')
          );
        }
        tips.push('✅ 已确认登录');

        const entered = await enterImageMode(page);
        if (entered) {
          tips.push('✅ 已进入 AI 生图模式');
        } else {
          tips.push('⚠ 未找到"AI生图"按钮，尝试继续当前页面');
        }

        await page.waitForTimeout(1000);

        if (params.image) {
          const absPath = path.resolve(params.image);
          if (!fs.existsSync(absPath)) {
            tips.push(`⚠ 参考图不存在: ${params.image}，跳过`);
          } else {
            const refClicked = await safeClickText(page, '参考图');
            if (!refClicked) {
              await safeClickText(page, '上传图片');
            }
            await page.waitForTimeout(500);

            const uploaded = await uploadFileViaDataTransfer(page, absPath);
            if (uploaded) {
              tips.push(`✅ 已上传参考图: ${path.basename(absPath)}`);
              await page.waitForTimeout(2000);
            } else {
              tips.push('⚠ 上传参考图失败');
            }
          }
        }

        if (params.ratio) {
          const ratioSet = await setRatio(page, params.ratio);
          if (ratioSet) {
            tips.push(`✅ 已设置比例: ${params.ratio}`);
          } else {
            tips.push(`⚠ 设置比例 ${params.ratio} 失败，使用默认比例`);
          }
        }

        const inputOk = await inputPrompt(page, params.prompt);
        if (!inputOk) {
          return fail('找不到输入框', [...tips, '❌ 无法输入提示词']);
        }
        tips.push(`✅ 已输入提示词: "${params.prompt.slice(0, 40)}${params.prompt.length > 40 ? '...' : ''}"`);

        await page.waitForTimeout(500);

        let networkPromise: Promise<string[]> | null = null;
        if (waitSeconds > 0) {
          networkPromise = captureNetworkImages(page, waitSeconds * 1000);
        }

        const sent = await clickSend(page);
        if (!sent) {
          return fail('找不到发送按钮', [...tips, '❌ 无法提交生成请求']);
        }
        tips.push('✅ 生成请求已提交');

        if (waitSeconds > 0) {
          tips.push(`⏳ 等待生成（最长 ${waitSeconds}s）...`);

          const domImages = waitForImages(page, waitSeconds * 1000);
          const netImages = networkPromise!;

          const timeout = waitSeconds * 1000;
          const raceResult = await Promise.race([
            domImages.then(urls => ({ source: 'dom' as const, urls })),
            netImages.then(urls => ({ source: 'network' as const, urls })),
            new Promise<Record<string, unknown>>(resolve =>
              setTimeout(() => resolve({ source: 'timeout', urls: [] }), timeout)
            ),
          ]);

          const imageUrls = (raceResult as Record<string, unknown>).urls as string[];

          if (imageUrls.length > 0) {
            tips.push(`✅ 生成完成！共 ${imageUrls.length} 张图片`);
            for (const u of imageUrls.slice(0, 3)) {
              tips.push(`🖼 ${u}`);
            }
            tips.push('💡 URL 有时效，建议尽快下载');
            return ok(
              { images: imageUrls, prompt: params.prompt, ratio: params.ratio || '1:1' },
              tips,
            );
          }

          return ok(
            { status: 'timeout', prompt: params.prompt },
            [
              ...tips,
              `⏱ 等待 ${waitSeconds}s 超时，图片可能还在生成`,
              '检查: xbrowser qwen result --cdp 9221',
            ],
          );
        }

        return ok(
          { status: 'submitted', prompt: params.prompt },
          [
            ...tips,
            '✅ 生成请求已提交（异步模式）',
            '等待 15-60s 后检查:',
            '  xbrowser qwen result --cdp 9221',
          ],
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        return fail(msg, ['图片生成失败', msg]);
      }
    },
  });

  site.command('result', {
    description: '获取千问页面中已生成的图片 URL',
    scope: 'browser',
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(10).describe('返回条数（默认 10）'),
    }),
    result: z.object({ images: z.array(z.object({ url: z.string(), alt: z.string() }).passthrough()).optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser qwen result --cdp 9221', description: '获取已生成图片' },
      { cmd: 'xbrowser qwen result --limit 5 --cdp 9221', description: '获取最近 5 张' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildTips(ctx);

        await ensurePage(page);
        await page.waitForTimeout(2000);

        const images = await page.evaluate(({ cdn, wanx }) => {
          const imgs = document.querySelectorAll('img');
          const result: Array<{ url: string; alt: string }> = [];
          const seen = new Set<string>();
          for (const img of imgs) {
            const src = (img as HTMLImageElement).src || '';
            const loaded = (img as HTMLImageElement).naturalWidth > 50;
            const isCDN = src.includes(cdn) || src.includes(wanx) || (src.includes('.png') && src.includes('%2F'));
            if (loaded && !seen.has(src) && isCDN) {
              seen.add(src);
              result.push({
                url: src,
                alt: (img as HTMLImageElement).alt || '',
              });
            }
          }
          return result;
        }, { cdn: CDN_HOST, wanx: WANX_HOST }) as Array<{ url: string; alt: string }>;

        if (images.length === 0) {
          return ok(
            { images: [] },
            [...tips, '未找到已生成的图片。可能还未生成或页面不正确', '⏱ 未获取到图片'],
          );
        }

        const limited = images.slice(0, params.limit!);

        return ok(
          { images: limited },
          [
            ...tips,
            `共 ${images.length} 张图片`,
            ...limited.slice(0, 3).map(img => `🖼 ${img.url}`),
            '💡 URL 有时效，建议尽快下载',
            `✅ 获取到 ${limited.length} 张图片`,
          ],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['获取结果失败']);
      }
    },
  });

  async function captureAuthParams(page: Page): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('捕获认证参数超时（10s），请确认已登录')), 10000);

      const handler = (request: import('../types').Request) => {
        const url = request.url();
        if (url.includes('chat2-api.qianwen.com') && url.includes('ut=')) {
          const queryString = url.split('?')[1];
          if (queryString) {
            clearTimeout(timer);
            page.off('request', handler);
            resolve(queryString);
          }
        }
      };

      page.on('request', handler);
    });
  }

  async function fetchSessionList(page: Page, authParams: string, pageSize: number, currentPage: number): Promise<{
    sessions: Array<{ session_id: string; title: string; created_at: number }>;
    have_next_page: boolean;
  }> {
    return page.evaluate(async ({ auth, size, pg }) => {
      const resp = await fetch(
        `https://chat2-api.qianwen.com/api/v2/session/page/list?${auth}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ pageSize: size, currentPage: pg }),
        },
      );
      const json = await resp.json();
      if (json.code !== 0) throw new Error(`Session list API error: ${json.msg || json.code}`);
      return {
        sessions: (json.data?.list || []).map((s: Record<string, unknown>) => ({
          session_id: String(s.session_id || ''),
          title: String(s.title || ''),
          created_at: Number(s.created_at || 0),
        })),
        have_next_page: Boolean(json.data?.have_next_page),
      };
    }, { auth: authParams, size: pageSize, pg: currentPage });
  }

  async function fetchSessionImages(page: Page, authParams: string, sessionId: string): Promise<string[]> {
    return page.evaluate(async ({ auth, sid }) => {
      // GET request with params in query string (not POST body)
      const resp = await fetch(
        `https://chat2-api.qianwen.com/api/v1/session/msg/list?${auth}&sessionId=${encodeURIComponent(sid)}&pageSize=50&currentPage=1`,
        {
          method: 'GET',
          credentials: 'include',
        },
      );
      const json = await resp.json();
      if (json.code !== 0) return [];

      // Response structure: data.list[].response_messages[].content
      // Image URLs are embedded in markdown: ![](https://wanx.alicdn.com/...)
      const items = json.data?.list || [];
      const images = [];
      const seen = new Set();

      for (const item of items) {
        const respMsgs = item.response_messages || [];
        for (const rm of respMsgs) {
          if (typeof rm.content !== 'string') continue;
          // Extract URLs from markdown image syntax: ![...](url)
          const mdRegex = /!\[.*?\]\((https?:\/\/[^\s"'<>)]+)\)/g;
          let match;
          while ((match = mdRegex.exec(rm.content)) !== null) {
            const url = match[1];
            if (!seen.has(url)) {
              seen.add(url);
              images.push(url);
            }
          }
          // Also extract plain CDN URLs as fallback
          const urlRegex = /https?:\/\/[^\s"'<>)]+?(?:wanx\.alicdn\.com|workspace-zb-cdn\.qianwen\.com)[^\s"'<>)]*\.png[^\s"'<>)]*/g;
          while ((match = urlRegex.exec(rm.content)) !== null) {
            const url = match[0];
            if (!seen.has(url)) {
              seen.add(url);
              images.push(url);
            }
          }
        }
      }
      return images;
    }, { auth: authParams, sid: sessionId });
  }

  site.command('history', {
    description: '获取千问会话历史及生成的图片',
    scope: 'browser',
    parameters: z.object({
      limit: z.coerce.number().int().positive().optional().default(10).describe('返回会话数量'),
    }),
    result: z.object({ sessions: z.array(z.record(z.string(), z.any())).optional(), totalImages: z.number().optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser qwen history --cdp 9221', description: '列出所有会话及图片' },
      { cmd: 'xbrowser qwen history --limit 5 --cdp 9221', description: '限制 5 个会话' },
      { cmd: 'xbrowser qwen history --cdp 9221 --json', description: 'JSON 输出' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildTips(ctx);

        const currentUrl = page.url();
        let authParams: string;

        if (currentUrl.includes('qianwen.com')) {
          const probePromise = captureAuthParams(page);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          authParams = await probePromise;
        } else {
          const probePromise = captureAuthParams(page);
          await page.goto(QWEN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
          authParams = await probePromise;
        }
        tips.push('✅ 已捕获认证参数');

        const { sessions } = await fetchSessionList(page, authParams, params.limit!, 1);
        if (sessions.length === 0) {
          return ok({ sessions: [], totalImages: 0 }, [...tips, '未找到会话记录']);
        }
        tips.push(`✅ 获取到 ${sessions.length} 个会话`);

        let totalImages = 0;
        const results: Array<{
          sessionId: string;
          title: string;
          createdAt: number;
          images: string[];
        }> = [];

        for (const session of sessions) {
          const images = await fetchSessionImages(page, authParams, session.session_id);
          totalImages += images.length;
          results.push({
            sessionId: session.session_id,
            title: session.title,
            createdAt: session.created_at,
            images,
          });
        }

        return ok(
          { sessions: results, totalImages },
          [
            ...tips,
            `📊 ${results.length} 个会话，共 ${totalImages} 张图片`,
            ...results.filter(s => s.images.length > 0).slice(0, 5).map(s =>
              `🖼 [${s.images.length}张] ${s.title.slice(0, 30)}`
            ),
            totalImages > 0 ? '💡 URL 有时效，建议尽快下载' : '',
            `✅ 历史记录获取完成`,
          ].filter(Boolean),
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['获取历史记录失败']);
      }
    },
  });

  site.command('billing', {
    description: '检查千问登录状态',
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ loggedIn: z.boolean(), hasImageMode: z.boolean(), url: z.string() }).passthrough(),
    examples: [
      { cmd: 'xbrowser qwen billing --cdp 9221', description: '检查登录状态' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        const tips = buildTips(ctx);

        await ensurePage(page);
        await page.waitForTimeout(2000);

        const loggedIn = await checkLogin(page);

        const pageInfo = await page.evaluate(() => {
          const bodyText = document.body?.textContent?.trim().slice(0, 500) || '';
          const hasImageMode = !!Array.from(document.querySelectorAll('button, [role="button"]'))
            .find(el => (el.textContent || '').trim().includes('AI生图'));
          return { bodySnippet: bodyText.slice(0, 200), hasImageMode };
        }) as { bodySnippet: string; hasImageMode: boolean };

        return ok(
          { loggedIn, hasImageMode: pageInfo.hasImageMode, url: page.url() },
          [
            ...tips,
            loggedIn ? '✅ 已登录千问' : '❌ 未登录千问',
            pageInfo.hasImageMode ? '✅ AI 生图模式可用' : '⚠ 未检测到 AI 生图按钮',
          ],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', ['检查状态失败']);
      }
    },
  });

  // ── chat — 发送消息（补充命令，之前只有 image） ──
  site.command('chat', {
    description: '发送消息并等待 AI 回复',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      path: z.string().optional().describe('单附件路径'),
      paths: z.string().optional().describe('多附件路径（CSV）'),
    }),
    result: z.object({ response: z.string(), duration: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail('需要浏览器页面', []);
      const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint as string | undefined;
      try {
        // 导航
        if (!page.url().includes('qianwen.com')) {
          await page.goto(QWEN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(3000);
        }

        // 附件（如果有）
        if (params.path || params.paths) {
          const list = [
            ...(params.path ? [params.path] : []),
            ...(params.paths ? params.paths.split(',').map((x: string) => x.trim()).filter(Boolean) : []),
          ];
          const payloads = list.map((fp: string) => {
            const abs = path.resolve(fp);
            const buf = fs.readFileSync(abs);
            return { name: path.basename(abs), mimeType: 'application/octet-stream', buffer: buf };
          });
          const p = page as unknown as { setInputFiles?: (s: string, f: unknown[]) => Promise<void> };
          await p.setInputFiles?.('input[type="file"]', payloads).catch(() => {});
          await page.waitForTimeout(2000);
        }

        // 输入 + 发送
        const inputSel = 'div[role="textbox"][contenteditable="true"]';
        await page.locator(inputSel).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
        await page.keyboard.type(params.message, { delay: 20 });
        await page.waitForTimeout(400);
        await page.keyboard.press('Enter');

        // 等回复
        await page.waitForTimeout(3000);
        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(2000);
          try {
            responseText = await page.evaluate(() => {
              const sels = ['div.answer-common-card', 'div.chat-answers-card-wrap', '[class*="markdown"]'];
              for (const sel of sels) {
                const els = document.querySelectorAll(sel);
                for (let i = els.length - 1; i >= 0; i--) {
                  const t = (els[i].textContent || '').trim();
                  if (t.length > 0) return t.slice(0, 8000);
                }
              }
              return '';
            }) as string;
            if (responseText) break;
          } catch { /* continue */ }
        }

        // smart 兜底
        if (!responseText) {
          responseText = await smartExtractReply(page, params.message, 'qwen 聊天页', cdp).catch(() => '') as string;
        }

        return ok({ response: responseText, duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` },
          [responseText ? 'AI 回复已收到' : '回复超时']);
      } catch {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  // ── attach — 上传附件 ──
  site.command('attach', {
    description: '上传附件（图片/文件）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      path: z.string().optional().describe('单文件路径'),
      paths: z.string().optional().describe('多文件路径（CSV）'),
    }).refine(d => d.path || d.paths, { message: '--path 或 --paths 至少二选一' }),
    result: z.object({ uploaded: z.boolean(), files: z.array(z.string()) }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail('需要浏览器页面', []);
      const list = [
        ...(params.path ? [params.path] : []),
        ...(params.paths ? params.paths.split(',').map((x: string) => x.trim()).filter(Boolean) : []),
      ];
      const payloads = list.map((fp: string) => {
        const abs = path.resolve(fp);
        const buf = fs.readFileSync(abs);
        return { name: path.basename(abs), mimeType: 'application/octet-stream', buffer: buf };
      });
      try {
        const p = page as unknown as { setInputFiles?: (s: string, f: unknown[]) => Promise<void> };
        await p.setInputFiles?.('input[type="file"]', payloads);
        await page.waitForTimeout(2000);
        return ok({ uploaded: true, files: list }, [`✓ 已上传 ${list.length} 个文件`]);
      } catch (e) {
        return fail('上传失败', [(e as Error).message]);
      }
    },
  });

  // ── check-login ──
  site.command('check-login', {
    description: '检查千问登录状态',
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ loggedIn: z.boolean(), url: z.string().optional() }).passthrough(),
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail({ message: '需要浏览器页面' });
      const hasInput = await page.evaluate(() => !!document.querySelector('div[role="textbox"][contenteditable="true"]')).catch(() => false);
      return ok({ data: { loggedIn: hasInput, url: page.url() } }, [`登录状态: ${hasInput ? '✅' : '❌'}`]);
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(QWEN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn().catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录千问');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录千问:');
      console.log('   1. 打开 Viewer:');
      console.log(`      xbrowser viewer --session ${sessionId || 'default'}`);
      console.log('   2. 在 Viewer 页面中登录千问');
      console.log('   3. 登录后回到此终端，按 Enter 继续');
      console.log('');
    } else {
      console.log('');
      console.log('⚠️  推荐使用 --cdp 参数连接到已登录的浏览器:');
      console.log('     xbrowser qwen image --prompt "..." --cdp http://localhost:9221');
      console.log('');
    }

    if (page) {
      await page.goto(QWEN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
    console.log('✅ 继续执行');
  });

  site.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出千问登录');
  });
}
