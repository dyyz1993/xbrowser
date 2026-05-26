import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

type Page = import('playwright-core').Page;

const DB_URL = 'https://www.doubao.com';

/**
 * 下载媒体文件到本地，返回 { localPath, size } 或 null
 */
async function downloadMedia(url: string, prefix: string, maxRetries = 3): Promise<{ localPath: string; size: number }> {
  const downloadDir = path.join(process.env.HOME || '/tmp', '.xbrowser', 'downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
  const ext = url.includes('video') || url.includes('videoweb') ? '.mp4'
    : url.includes('audio') || url.includes('music') || url.includes('bigmusic') ? '.mp3'
    : '.png';
  const filename = `${prefix}_${Date.now()}${ext}`;
  const localPath = path.join(downloadDir, filename);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { execSync } = await import('child_process');
      execSync(`curl -sLf -o '${localPath}' '${url}'`, { timeout: 120000 });
      const stat = fs.statSync(localPath);
      if (stat.size >= 1024) {
        return { localPath, size: stat.size };
      }
      // 文件过小，可能是错误页面，删掉重试
      fs.unlinkSync(localPath);
    } catch {
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`下载失败（重试 ${maxRetries} 次）: ${url}`);
}

function formatFileSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
}

function getPage(ctx: CommandContext): Page {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接');
  return page;
}

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const options = ctxAny.options as Record<string, unknown> | undefined;
  const cdp = ctxAny.cdpEndpoint || options?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}

/** Extract audio URL from audio/download elements on the current page. */
async function extractPageAudio(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // 1) <audio> or <source> with http src (skip blob:)
    const audios = document.querySelectorAll('audio source[src], audio[src]');
    for (const a of audios) {
      const src = a.getAttribute('src') || (a as HTMLSourceElement).src || '';
      if (src.startsWith('http') && !src.startsWith('blob:')) return src;
    }
    // 2) direct download / MP3 links
    const links = document.querySelectorAll(
      'a[href*=".mp3"], a[href*=".wav"], a[href*=".flac"], a[href*=".aac"],' +
      'a[class*="download"], a[class*="audio"], a[aria-label*="下载"]'
    );
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href && href.startsWith('http')) return href;
    }
    // 3) any <a> whose text or aria-label contains "下载" near an audio player
    const downloadLinks = document.querySelectorAll(
      '[class*="download"] a[href], [class*="audio"] a[href]'
    );
    for (const a of downloadLinks) {
      const href = a.getAttribute('href');
      if (href && href.startsWith('http')) return href;
    }
    return null;
  });
}

async function ensurePage(page: Page, ctx?: CommandContext): Promise<void> {
  if (!page.url().startsWith(DB_URL)) {
    await page.goto(DB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
      if (bodyText.includes('登录') && bodyText.includes('注册') && !bodyText.includes('豆包')) {
        const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
        throw new Error(
          '豆包 (Doubao) 未登录！\n' +
          (cdp
            ? '  使用 --cdp 连接的浏览器未登录豆包，请先在浏览器中登录。\n  或运行: xbrowser doubao login'
            : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser doubao list --cdp http://localhost:9221')
        );
      }
    }
  }
}

async function uploadFileViaDataTransfer(page: Page, absPath: string): Promise<boolean> {
  const data = fs.readFileSync(absPath);
  const b64 = data.toString('base64');
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html',
    '.ts': 'text/typescript', '.tsx': 'text/typescript', '.js': 'text/javascript',
    '.py': 'text/x-python', '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.mobi': 'application/x-mobipocket-ebook', '.epub': 'application/epub+zip',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  };
  const ext = path.extname(absPath).toLowerCase();
  const mime = mimeMap[ext] || 'application/octet-stream';

  const result = await page.evaluate(({ b64data, filename, mimeType }) => {
    const fi = document.querySelector('input[type="file"]');
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
  }, { b64data: b64, filename: path.basename(absPath), mimeType: mime });

  return result;
}

async function safeClickSelector(page: Page, selector: string): Promise<boolean> {
  const handle = await page.evaluateHandle(
    (sel: string) => document.querySelector(sel),
    selector
  );
  const el = handle.asElement();
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function waitForText(page: Page, text: string, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    (t: string) => {
      const all = document.querySelectorAll('div, button, span, textarea');
      return Array.from(all).some(el => el.textContent?.trim() === t && el.offsetParent !== null);
    },
    text,
    { timeout }
  );
}

async function waitForGone(page: Page, selector: string, timeout = 5000): Promise<void> {
  await page.waitForSelector(selector, { state: 'detached', timeout });
}

async function safeClickByText(page: Page, text: string): Promise<boolean> {
  const handle = await page.evaluateHandle((t: string) => {
    const all = document.querySelectorAll('div, button, span');
    for (const el of all) {
      if (el.textContent?.trim() === t && el.offsetParent !== null) return el;
    }
    return null;
  }, text);
  const element = handle.asElement();
  if (!element) return false;
  const box = await element.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'doubao',
    url: DB_URL,
    description: '豆包 (Doubao) — 会话管理、图像/视频/音乐生成、文件管理、联网搜索',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const url = page.url();
        if (url.includes('/login') || url.includes('/auth') || url.includes('/passport')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body || body.includes('登录') && body.includes('注册')) return false;
        return true;
      } catch {
        return false;
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  SESSION MANAGEMENT (4 commands)
  // ═══════════════════════════════════════════════════

  //  1. list — 列出所有会话
  site.command('list', {
    description: '列出所有历史会话',
    scope: 'page',
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser doubao list', description: '列出所有会话' },
      { cmd: 'xbrowser doubao list --json', description: 'JSON 格式输出' },
    ],
    result: z.array(z.object({ index: z.number(), title: z.string(), url: z.string() }).passthrough()),
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/chat/"], a[href*="/c/"], [class*="conversation"] a, [class*="session"] a');
          return Array.from(links).map((a, i) => ({
            index: i,
            title: (a.textContent || '').trim(),
            url: (a as HTMLAnchorElement).href,
          })).filter(c => c.title.length > 0);
        });

        const tips = buildTips(ctx);
        tips.push(`共 ${conversations.length} 个会话`);
        return ok(conversations, tips);
      } catch (error) {
        return fail('未知错误', ['获取会话列表失败']);
      }
    },
  });

  //  2. new — 新建对话
  site.command('new', {
    description: '创建新的空白对话',
    scope: 'browser',
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser doubao new', description: '新建对话' },
    ],
    result: z.object({ created: z.boolean() }).passthrough(),
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);

        const result = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('新对话') || node.textContent?.includes('新建')) {
              const parent = node.parentElement;
              if (parent) {
                parent.click();
                return 'clicked';
              }
            }
          }
          return 'not_found';
        });

        if (result === 'not_found') {
          const fallback = await page.evaluate(() => {
            const plusBtns = document.querySelectorAll('[class*="add"], [class*="new"], [class*="create"], [class*="plus"]');
            if (plusBtns.length > 0) {
              (plusBtns[0] as HTMLElement).click();
              return 'clicked_icon';
            }
            return 'failed';
          });
          if (fallback === 'failed') throw new Error('找不到"新对话"按钮');
        }

        await page.waitForTimeout(1500);
        return ok({ created: true }, buildTips(ctx));
      } catch (error) {
        return fail('未知错误', ['创建新对话失败']);
      }
    },
  });

  //  3. open — 通过标题打开会话
  site.command('open', {
    description: '通过标题打开指定会话（模糊匹配）',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('会话标题（支持模糊匹配）'),
    }),
    examples: [
      { cmd: 'xbrowser doubao open "工作计划"', description: '打开指定会话' },
      { cmd: 'xbrowser doubao open "代码"', description: '模糊匹配打开' },
    ],
    result: z.object({ opened: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);

        const clicked = await page.evaluate((title: string) => {
          const links = document.querySelectorAll('a[href*="/chat/"], a[href*="/c/"], [class*="conversation"] a');
          for (const link of links) {
            const text = (link.textContent || '').trim();
            if (text.includes(title)) {
              (link as HTMLAnchorElement).click();
              return { found: true, title: text };
            }
          }
          return { found: false, title: '' };
        }, params.title);

        if (!clicked.found) throw new Error(`未找到包含"${params.title}"的会话`);

        await page.waitForTimeout(2000);
        return ok({ opened: clicked.title }, buildTips(ctx));
      } catch (error) {
        return fail('未知错误', ['打开会话失败']);
      }
    },
  });

  //  4. chat — 发送消息（支持文件上传 + 搜索来源提取）
  site.command('chat', {
    description: '发送消息并等待 AI 回复，支持文件上传和搜索来源提取',
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      attach: z.string().optional().describe('附件路径（图片或文件）'),
      think: z.boolean().optional().describe('开启深度思考模式'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    examples: [
      { cmd: 'xbrowser doubao chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser doubao chat "分析这张图" --attach /path/to/img.jpg', description: '发送消息+图片' },
      { cmd: 'xbrowser doubao chat "深度分析" --think', description: '开启深度思考' },
      { cmd: 'xbrowser doubao chat "2024年新闻" --search --showSources', description: '联网搜索+显示来源' },
      { cmd: 'xbrowser doubao chat "深度研究AI趋势" --think --search --showSources', description: '深度思考+联网搜索+来源' },
    ],
    result: z.object({ response: z.string(), duration: z.string().optional(), sources: z.record(z.any()).optional() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000);
        const tips = buildTips(ctx);

        // 开启深度思考模式
        if (params.think) {
          const thinkToggled = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              if (node.textContent?.includes('深度思考') || node.textContent?.includes('深度推理')) {
                const parent = node.parentElement;
                if (parent) {
                  const isActive = parent.getAttribute('aria-checked') === 'true'
                    || parent.getAttribute('aria-pressed') === 'true'
                    || parent.classList.contains('active');
                  if (!isActive) {
                    parent.click();
                    return 'toggled_on';
                  }
                  return 'already_on';
                }
              }
            }
            return 'not_found';
          });
          if (thinkToggled === 'toggled_on') {
            tips.push('已开启深度思考');
            await page.waitForTimeout(500);
          } else if (thinkToggled === 'not_found') {
            tips.push('⚠ 未找到深度思考开关');
          }
        }

        // 开启联网搜索
        if (params.search) {
          const searchEnabled = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              if (node.textContent?.includes('联网搜索') || node.textContent?.includes('搜索')) {
                const parent = node.parentElement;
                if (parent) {
                  const isActive = parent.getAttribute('aria-checked') === 'true'
                    || parent.getAttribute('aria-pressed') === 'true'
                    || parent.classList.contains('active');
                  if (!isActive) {
                    parent.click();
                    return 'toggled_on';
                  }
                  return 'already_on';
                }
              }
            }
            return 'not_found';
          });
          if (searchEnabled === 'toggled_on') {
            tips.push('已开启联网搜索');
            await page.waitForTimeout(500);
          } else if (searchEnabled === 'not_found') {
            tips.push('⚠ 未找到联网搜索开关');
          }
        }

        if (params.attach) {
          const absPath = path.resolve(params.attach);
          if (!fs.existsSync(absPath)) {
            tips.push(`⚠ 附件文件不存在: ${params.attach}，跳过附件`);
          } else {
            const uploaded = await uploadFileViaDataTransfer(page, absPath);
            if (uploaded) {
              tips.push(`已上传附件: ${path.basename(absPath)}`);
              await page.waitForTimeout(1500);
            } else {
              tips.push('⚠ 上传失败，尝试点击上传按钮');
              const uploadBtnSelectors = [
                '[class*="upload"]', '[class*="attach"]', '[class*="clip"]',
                'button[class*="image"]', '[class*="file-upload"]',
              ];
              for (const sel of uploadBtnSelectors) {
                if (await safeClickSelector(page, sel)) {
                  await page.waitForTimeout(500);
                  const retry = await uploadFileViaDataTransfer(page, absPath);
                  if (retry) {
                    tips.push(`已上传附件: ${path.basename(absPath)}`);
                    await page.waitForTimeout(1500);
                  }
                  break;
                }
              }
            }
          }
        }

        await page.waitForSelector('textarea, [contenteditable="true"], [role="textbox"]', { timeout: 15000 }).catch(() => {});
        const inputLocators = [
          'textarea', '[contenteditable="true"]', '[role="textbox"]',
          'textarea[class*="input"]', '[class*="chat-input"] textarea',
          'div[class*="input"]',
        ];

        let inputEl: Awaited<ReturnType<typeof page.locator>> | null = null;
        let inputSel: string | null = null;
        for (const sel of inputLocators) {
          const loc = page.locator(sel).first();
          if (await loc.count() > 0) {
            inputEl = loc;
            inputSel = sel;
            break;
          }
        }

        if (!inputEl || !inputSel) throw new Error('找不到消息输入框');

        await inputEl.click();
        await inputEl.fill(params.message);
        await page.waitForTimeout(500);

        const wantSources = !!params.showSources;
        let capturedStream = '';

        if (wantSources) {
          await page.route('**/doubao.com/chat/completion', async (route) => {
            const resp = await route.fetch();
            const body = await resp.text();
            capturedStream += body;
            await route.fulfill({ body, headers: resp.headers(), status: resp.status() });
          });
        }

        await page.keyboard.press('Enter');
        tips.push('消息已发送，等待 AI 回复...');
        await page.waitForTimeout(2000);

        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(1500);
          try {
            responseText = await page.evaluate((msg: string) => {
              const getText = (el: Element) => el.textContent?.trim() || '';
              const pageTxt = document.body.textContent || '';

              if (pageTxt.includes('停止生成') || pageTxt.includes('思考中') || pageTxt.includes('生成中')) return '';

              // 策略 1：message-list 中找 md-box-root（豆包 AI 回复的 markdown 渲染容器）
              const msgList = document.querySelector('[class*="message-list"]');
              if (msgList) {
                const mdBoxes = msgList.querySelectorAll('[class*="md-box-root"]');
                if (mdBoxes.length > 0) {
                  const last = mdBoxes[mdBoxes.length - 1];
                  const txt = getText(last);
                  if (txt.length > 0 && !txt.includes(msg)) return txt.slice(0, 8000);
                }
              }

              // 策略 2：message-list 中找 container-h3Yzeb（markdown body wrapper）
              if (msgList) {
                const wrappers = msgList.querySelectorAll('[class*="container-h3"]') ||
                  msgList.querySelectorAll('[class*="md-box"]');
                if (wrappers.length > 0) {
                  const last = wrappers[wrappers.length - 1];
                  const txt = getText(last);
                  if (txt.length > 0 && !txt.includes(msg)) return txt.slice(0, 8000);
                }
              }

              // 策略 3：全局 md-box-root
              const allMdBox = document.querySelectorAll('[class*="md-box-root"]');
              if (allMdBox.length > 0) {
                const last = allMdBox[allMdBox.length - 1];
                const txt = getText(last);
                if (txt.length > 0 && !txt.includes(msg)) return txt.slice(0, 8000);
              }

              // 策略 4：data-target-id message-box 中找非用户消息（AI 回复）
              const msgBoxes = document.querySelectorAll('[data-target-id="message-box-target-id"]');
              if (msgBoxes.length > 0) {
                for (let i = msgBoxes.length - 1; i >= 0; i--) {
                  const box = msgBoxes[i];
                  const userBubble = box.querySelector('[class*="whitespace-pre-wrap"][class*="bg-g-send"]');
                  if (userBubble) continue;
                  const txt = getText(box);
                  if (txt.length > 0 && !txt.includes(msg)) return txt.slice(0, 8000);
                }
              }

              return '';
            }, params.message);
            if (responseText) break;
          } catch {
            // continue polling on page evaluate failure
          }
        }

        if (responseText) {
          tips.push('AI 回复已收到');
          const result: Record<string, unknown> = {
            response: responseText,
            duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
          };

          if (wantSources) {
            await new Promise(r => setTimeout(r, 5000));
            await page.unroute('**/doubao.com/chat/completion').catch(() => {});
            let allUrls: string[] = [];

            if (capturedStream) {
              const urlMatches = capturedStream.match(/https?:\/\/[^"'\s,<>\\\]\)]+/g) || [];
              for (const u of urlMatches) {
                const clean = u.replace(/\\u002F/g, '/').split(/[)\]"'.,;:!?]+$/)[0];
                try {
                  new URL(clean);
                  allUrls.push(clean);
                } catch { /* ignore */ }
              }
            }

            if (allUrls.length === 0) {
              const domData = await page.evaluate(() => {
                const links = document.querySelectorAll('a[href*="http"]');
                const seen = new Set<string>();
                return Array.from(links).filter(a => {
                  const h = a.getAttribute('href');
                  if (!h || seen.has(h)) return false;
                  seen.add(h);
                  return true;
                }).map(a => a.getAttribute('href') || '');
              });
              allUrls = domData;
            }

            const seen = new Set<string>();
            const uniqueUrls = allUrls.filter(u => {
              const k = u.toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });

            const domains = new Set<string>();
            for (const u of uniqueUrls) {
              try { domains.add(new URL(u).hostname.replace(/^www\./, '')); } catch { /* ignore */ }
            }

            result.sources = {
              total: uniqueUrls.length,
              domains: Array.from(domains).sort(),
              urls: uniqueUrls.map(u => ({
                url: u.slice(0, 300),
                domain: (() => { try { return new URL(u).hostname; } catch { return ''; } })(),
              })),
            };
            tips.push(`搜索来源：${domains.size} 个域名, ${uniqueUrls.length} 条链接`);
          }

          return ok(result, tips);
        } else {
          tips.push('AI 回复超时或未检测到');
          return ok({ response: '' }, tips);
        }
      } catch (error) {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  IMAGE GENERATION & EDITING (5 commands)
  // ═══════════════════════════════════════════════════

  //  5. image — 文生图
  site.command('image', {
    description: '文生图（Text-to-Image）',
    scope: 'browser',
    parameters: z.object({
      prompt: z.string().describe('图片描述提示词'),
      model: z.enum(['Seedream4.5', 'Seedance']).optional().describe('模型：Seedream4.5 / Seedance'),
      ratio: z.enum(['3:4', '16:9', '1:1']).optional().describe('图片比例 3:4 / 16:9 / 1:1'),
      style: z.string().optional().describe('风格（如：写实、动漫、水彩）'),
      ref: z.string().optional().describe('参考图片路径'),
    }),
    examples: [
      { cmd: 'xbrowser doubao image --prompt "夕阳下的沙滩"', description: '基础文生图' },
      { cmd: 'xbrowser doubao image --prompt "赛博朋克城市" --model Seedance --ratio 16:9', description: '指定模型和比例' },
      { cmd: 'xbrowser doubao image --prompt "油画风格的花园" --style 水彩 --ref /path/to/ref.jpg', description: '指定风格+参考图' },
    ],
    result: z.object({ url: z.string().optional(), localPath: z.string().optional(), prompt: z.string().optional(), duration: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.goto('https://www.doubao.com/chat/create-image', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const tips = buildTips(ctx);

        if (params.ref) {
          const absPath = path.resolve(params.ref);
          if (fs.existsSync(absPath)) {
            await uploadFileViaDataTransfer(page, absPath);
            await page.waitForTimeout(1000);
            tips.push(`已上传参考图: ${path.basename(absPath)}`);
          } else {
            tips.push(`⚠ 参考图文件不存在: ${params.ref}`);
          }
        }

        const prompt = params.prompt;
        const inputFound = await page.evaluate((msg: string) => {
          const selectors = ['textarea', '[contenteditable="true"]', '[role="textbox"]', '[class*="chat-input"] textarea'];
          for (const sel of selectors) {
            const el = document.querySelector<HTMLTextAreaElement | HTMLDivElement>(sel);
            if (el) {
              if ('value' in el) {
                el.value = msg;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                el.textContent = msg;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              return true;
            }
          }
          return false;
        }, `画图: ${prompt}`);

        if (!inputFound) throw new Error('找不到输入框');

        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        tips.push('图片生成请求已提交，等待生成...');
        await page.waitForTimeout(3000);

        let imageUrl = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(2000);
          try {
            imageUrl = await page.evaluate(() => {
              const selectors = [
                'img[class*="image-item-img"]',
                'img[src*="image_generation"]',
                'img[class*="generated"]',
                'img[class*="result"]',
              ];
              for (const sel of selectors) {
                const imgs = document.querySelectorAll(sel);
                for (const img of imgs) {
                  const src = (img as HTMLImageElement).src;
                  if (src && src.startsWith('http') && !src.includes('data:image') && !src.includes('avatar') && !src.includes('BIZ_BOT')) {
                    return src;
                  }
                }
              }
              return '';
            });
            if (imageUrl) break;
          } catch { /* ignore */ }
        }

        if (imageUrl) {
          const downloaded = await downloadMedia(imageUrl, 'image');
          return ok({ url: imageUrl, localPath: downloaded.localPath, prompt, duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s` }, [...tips, `📁 图片已下载: ${downloaded.localPath} (${formatFileSize(downloaded.size)})`]);
        }

        return ok({ prompt }, [...tips, '图片可能还在生成中，请到豆包页面查看']);
      } catch (error) {
        return fail('未知错误', ['文生图失败']);
      }
    },
  });

  //  6. image-edit — 图片编辑（重绘/扩图/擦除/增强）
  site.command('image-edit', {
    description: '图片编辑：重绘(redraw)、扩图(expand)、擦除(erase)、增强(enhance)',
    scope: 'browser',
    parameters: z.object({
      action: z.enum(['redraw', 'expand', 'erase', 'enhance']).describe('编辑操作：redraw=重绘, expand=扩图, erase=擦除, enhance=增强'),
      image: z.string().describe('待编辑图片路径'),
      prompt: z.string().optional().describe('编辑提示词（仅 redraw 需要）'),
    }),
    examples: [
      { cmd: 'xbrowser doubao image-edit --action redraw --image /path/to/img.jpg --prompt "改成油画风格"', description: '重绘' },
      { cmd: 'xbrowser doubao image-edit --action erase --image /path/to/img.jpg', description: '擦除' },
      { cmd: 'xbrowser doubao image-edit --action enhance --image /path/to/img.jpg', description: '增强' },
    ],
    result: z.object({ action: z.string(), image: z.string(), submitted: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        const absPath = path.resolve(params.image);
        if (!fs.existsSync(absPath)) throw new Error(`图片文件不存在: ${absPath}`);

        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        if (!uploaded) {
          await safeClickSelector(page, '[class*="upload"], [class*="image-upload"], [class*="attach"]');
          await page.waitForTimeout(500);
          await uploadFileViaDataTransfer(page, absPath);
        }
        await page.waitForTimeout(1000);
        tips.push(`已上传图片: ${path.basename(absPath)}`);

        const actionLabels: Record<string, string> = {
          redraw: '重绘', expand: '扩图', erase: '擦除', enhance: '增强',
        };
        const label = actionLabels[params.action];

        const clicked = await page.evaluate((actionLabel: string) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes(actionLabel)) {
              const parent = node.parentElement;
              if (parent) {
                parent.click();
                return true;
              }
            }
          }
          return false;
        }, label);

        if (!clicked) tips.push(`⚠ 未找到"${label}"按钮，请确认页面已显示编辑选项`);

        if (params.prompt) {
          await page.waitForTimeout(500);
          const promptInput = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
          if (await promptInput.count() > 0) {
            await promptInput.fill(params.prompt);
            await page.waitForTimeout(300);
          }
        }

        const submitHandle = await page.evaluateHandle(() => {
          const selectors = ['button[class*="submit"]', 'button[class*="generate"]', '[class*="confirm"] button'];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          for (const btn of document.querySelectorAll('button')) {
            if (btn.textContent?.includes('生成')) return btn;
          }
          return null;
        });
        const submitEl = submitHandle.asElement();
        if (submitEl) {
          const submitBox = await submitEl.boundingBox();
          if (submitBox) await page.mouse.click(submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2);
          tips.push('编辑请求已提交，等待处理...');
        }

        await page.waitForTimeout(3000);

        return ok({ action: params.action, image: absPath, submitted: true }, tips);
      } catch (error) {
        return fail('未知错误', ['图片编辑失败']);
      }
    },
  });

  //  7. image-cutout — AI 抠图
  site.command('image-cutout', {
    description: 'AI 抠图（背景移除）',
    scope: 'browser',
    parameters: z.object({
      image: z.string().describe('待抠图图片路径'),
    }),
    examples: [
      { cmd: 'xbrowser doubao image-cutout --image /path/to/img.jpg', description: 'AI 抠图' },
    ],
    result: z.object({ resultUrl: z.string(), source: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        const absPath = path.resolve(params.image);
        if (!fs.existsSync(absPath)) throw new Error(`图片文件不存在: ${absPath}`);

        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        await page.waitForTimeout(1000);
        tips.push(`已上传图片: ${path.basename(absPath)}`);

        const cutoutClicked = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('抠图') || node.textContent?.includes('去背景')) {
              const parent = node.parentElement;
              if (parent) {
                parent.click();
                return true;
              }
            }
          }
          return false;
        });

        if (!cutoutClicked) tips.push('⚠ 未找到抠图按钮');

        await page.waitForTimeout(5000);
        let resultUrl = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(2000);
          resultUrl = await page.evaluate(() => {
            const imgs = document.querySelectorAll('img[class*="result"], img[class*="cutout"], [class*="preview"] img');
            for (const img of imgs) {
              const src = (img as HTMLImageElement).src;
              if (src && src.startsWith('http') && !src.includes('data:image')) return src;
            }
            return '';
          });
          if (resultUrl) break;
        }

        return ok({ resultUrl: resultUrl || 'processing', source: absPath }, tips);
      } catch (error) {
        return fail('未知错误', ['抠图失败']);
      }
    },
  });

  //  8. image-vary — 图片衍生（以图生图）
  site.command('image-vary', {
    description: '以图生图（Variation），基于参考图生成变体',
    scope: 'browser',
    parameters: z.object({
      image: z.string().describe('参考图片路径'),
      prompt: z.string().optional().describe('变体描述提示词'),
    }),
    examples: [
      { cmd: 'xbrowser doubao image-vary --image /path/to/img.jpg', description: '图片衍生' },
      { cmd: 'xbrowser doubao image-vary --image /path/to/img.jpg --prompt "更亮色调"', description: '带提示词的衍生' },
    ],
    result: z.object({ source: z.string(), prompt: z.string().optional(), submitted: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        const absPath = path.resolve(params.image);
        if (!fs.existsSync(absPath)) throw new Error(`图片文件不存在: ${absPath}`);

        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        await page.waitForTimeout(1000);
        tips.push(`已上传参考图: ${path.basename(absPath)}`);

        const varyClicked = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('衍生') || node.textContent?.includes('变体') || node.textContent?.includes('类似')) {
              const parent = node.parentElement;
              if (parent) {
                parent.click();
                return true;
              }
            }
          }
          return false;
        });
        if (!varyClicked) tips.push('⚠ 未找到"衍生"按钮');

        if (params.prompt) {
          await page.waitForTimeout(500);
          const promptInput = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
          if (await promptInput.count() > 0) {
            await promptInput.fill(params.prompt);
            await page.waitForTimeout(300);
          }
        }

        return ok({ source: absPath, prompt: params.prompt, submitted: true }, tips);
      } catch (error) {
        return fail('未知错误', ['图片衍生失败']);
      }
    },
  });

  //  9. my-creations — 创作历史
  site.command('my-creations', {
    description: '查看创作历史（图片/视频/全部）',
    scope: 'browser',
    parameters: z.object({
      type: z.enum(['image', 'video', 'all']).optional().describe('筛选类型：image=图片, video=视频, all=全部'),
    }),
    examples: [
      { cmd: 'xbrowser doubao my-creations', description: '查看所有创作' },
      { cmd: 'xbrowser doubao my-creations --type image', description: '只看图片' },
    ],
    result: z.array(z.object({ index: z.number(), src: z.string(), alt: z.string(), text: z.string() }).passthrough()),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        if (params.type && params.type !== 'all') {
          const tabClicked = await page.evaluate((tabName: string) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node: Text | null;
            const labels: Record<string, string[]> = { image: ['图片', '图像'], video: ['视频'] };
            const targets = labels[tabName] || [tabName];
            while ((node = walker.nextNode() as Text | null)) {
              for (const t of targets) {
                if (node.textContent?.includes(t)) {
                  const parent = node.parentElement;
                  if (parent) { parent.click(); return true; }
                }
              }
            }
            return false;
          }, params.type);
          if (!tabClicked) tips.push(`⚠ 未找到"${params.type}"筛选标签`);
          await page.waitForTimeout(1000);
        }

        const creations = await page.evaluate(() => {
          const items = document.querySelectorAll(
            '[class*="creation-item"], [class*="gallery-item"], [class*="history-item"], [class*="my-creation"] img, [class*="grid"] img'
          );
          return Array.from(items).slice(0, 50).map((el, i) => ({
            index: i,
            src: (el as HTMLImageElement).src || '',
            alt: (el as HTMLImageElement).alt || '',
            text: el.textContent?.trim() || '',
          }));
        });

        return ok(creations, [...tips, `共 ${creations.length} 条创作记录`]);
      } catch (error) {
        return fail('未知错误', ['获取创作历史失败']);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  VIDEO GENERATION (async - 3 commands)
  // ═══════════════════════════════════════════════════

  //  10. video — 提交视频生成
  site.command('video', {
    description: '提交视频生成任务（异步，返回 taskId）',
    scope: 'browser',
    parameters: z.object({
      prompt: z.string().describe('视频描述提示词'),
      model: z.enum(['Seedance2.0']).optional().describe('视频模型：Seedance2.0'),
    }),
    examples: [
      { cmd: 'xbrowser doubao video --prompt "一只猫在草地上奔跑"', description: '提交视频生成' },
      { cmd: 'xbrowser doubao video --prompt "赛博朋克城市夜景" --model Seedance2.0', description: '指定模型' },
    ],
    result: z.object({ taskId: z.string(), prompt: z.string(), status: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        const inputFound = await page.evaluate((msg: string) => {
          const selectors = ['textarea', '[contenteditable="true"]', '[role="textbox"]', '[class*="chat-input"] textarea'];
          for (const sel of selectors) {
            const el = document.querySelector<HTMLTextAreaElement | HTMLDivElement>(sel);
            if (el) {
              if ('value' in el) {
                el.value = msg;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                el.textContent = msg;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              return true;
            }
          }
          return false;
        }, `生成视频: ${params.prompt}`);

        if (!inputFound) throw new Error('找不到输入框');

        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        tips.push('视频生成任务已提交');
        await page.waitForTimeout(2000);

        const taskId = await page.evaluate(() => {
          const idEls = document.querySelectorAll('[class*="task-id"], [class*="job-id"], [data-task-id]');
          for (const el of idEls) {
            const id = el.getAttribute('data-task-id') || el.textContent?.trim() || '';
            if (id) return id;
          }
          const urlParts = window.location.href.match(/task[=/](\w+)/);
          return urlParts ? urlParts[1] : '';
        });

        return ok({ taskId: taskId || 'pending', prompt: params.prompt, status: 'submitted' }, taskId
            ? [...tips, `taskId: ${taskId}`]
            : [...tips, '无法提取 taskId，请使用 video-status 检查任务状态']);
      } catch (error) {
        return fail('未知错误', ['提交视频生成失败']);
      }
    },
  });

  //  11. video-status — 检查视频生成状态
  site.command('video-status', {
    description: '检查视频生成任务状态（pending/processing/completed/failed）',
    scope: 'browser',
    parameters: z.object({
      task: z.string().describe('任务 ID'),
    }),
    examples: [
      { cmd: 'xbrowser doubao video-status --task abc123', description: '检查状态' },
    ],
    result: z.object({ taskId: z.string(), status: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);
        const tips = buildTips(ctx);

        const status = await page.evaluate((taskId: string) => {
          const allText = document.body.textContent || '';
          const statusEl = document.querySelector(
            '[class*="status"], [class*="progress"], [class*="state"]'
          );
          const statusText = statusEl?.textContent?.trim().toLowerCase() || '';

          if (statusText.includes('完成') || statusText.includes('completed') || statusText.includes('success')) return 'completed';
          if (statusText.includes('失败') || statusText.includes('failed') || statusText.includes('error')) return 'failed';
          if (statusText.includes('处理') || statusText.includes('processing') || statusText.includes('生成')) return 'processing';
          if (statusText.includes('等待') || statusText.includes('pending') || statusText.includes('排队')) return 'pending';

          if (allText.includes('完成') || allText.includes('已生成')) return 'completed';
          if (allText.includes('失败') || allText.includes('出错')) return 'failed';
          if (allText.includes('生成中') || allText.includes('处理中')) return 'processing';
          if (allText.includes('排队') || allText.includes('等待')) return 'pending';

          return 'unknown';
        }, params.task);

        return ok({ taskId: params.task, status }, tips);
      } catch (error) {
        return fail('未知错误', ['检查状态失败']);
      }
    },
  });

  //  12. video-result — 获取视频结果
  site.command('video-result', {
    description: '获取已完成视频的 URL',
    scope: 'browser',
    parameters: z.object({
      task: z.string().describe('任务 ID'),
    }),
    examples: [
      { cmd: 'xbrowser doubao video-result --task abc123', description: '获取视频 URL' },
    ],
    result: z.object({ taskId: z.string(), url: z.string().optional(), localPath: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);
        const tips = buildTips(ctx);

        const videoUrl = await page.evaluate(() => {
          const videos = document.querySelectorAll('video source[src], video[src]');
          for (const v of videos) {
            const src = v.getAttribute('src') || (v as HTMLSourceElement).src || '';
            if (src.startsWith('http')) return src;
          }
          const links = document.querySelectorAll('a[href*=".mp4"], a[href*="video"], a[class*="download"]');
          for (const a of links) {
            const href = a.getAttribute('href');
            if (href && href.startsWith('http')) return href;
          }
          return '';
        });

        if (!videoUrl) {
          const allText = await page.evaluate(() => document.body.textContent?.slice(0, 500) || '');
          const statusMatch = allText.match(/(完成|失败|生成|error|failed|completed|success)/i);
          tips.push(`状态提示: ${statusMatch?.[0] || '任务可能还在处理'}`);
        }


        if (videoUrl) {
          const downloaded = await downloadMedia(videoUrl, 'video');
          tips.push(`📁 视频已下载: ${downloaded.localPath} (${formatFileSize(downloaded.size)})`);
          return ok({ taskId: params.task, url: videoUrl, localPath: downloaded.localPath }, tips);
        }
      } catch (error) {
        return fail('未知错误', ['获取视频结果失败']);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  MUSIC/AUDIO GENERATION (async - 3 commands)
  // ═══════════════════════════════════════════════════

  //  13. music — 音乐生成（verified flow via 音乐生成 button + bigmusic/get_video interceptor）
  site.command('music', {
    description: '通过豆包音乐生成面板创建音乐。传 --lyric 使用自定义歌词，传 --timeout 同步等待音频 URL，否则异步提交',
    scope: 'browser',
    parameters: z.object({
      description: z.string().optional().describe('歌词主题描述（如"春天的田野"、"友情岁月"），AI 写歌词模式使用'),
      lyric: z.string().optional().describe('自定义歌词（最多 200 字，超过会自动截断。传入后自动切换到自定义歌词模式，豆包将按此歌词生成音乐）'),
      style: z.string().optional().describe('音乐风格（如：流行、嘻哈、国风、DJ、摇滚、民谣、R&B、雷鬼、朋克、电音、爵士）'),
      mood: z.string().optional().describe('情绪（如：快乐、忧伤、激昂、温柔、思念、愤怒、平静、浪漫）'),
      voice: z.string().optional().describe('音色（如：女声、男声、童声）'),
      duration: z.coerce.number().int().positive().optional()
        .describe('时长（秒）：如 30、60、90'),
      timeout: z.coerce.number().int().positive().optional()
        .describe('同步等待秒数（如 --timeout 60），不传则异步提交'),
      debug: z.boolean().optional().describe('开启 debug 模式，自动记录 API 请求结构到 ~/.xbrowser/debug/'),
    }),
        examples: [
          { cmd: 'xbrowser doubao music --description "写一首快乐的歌曲，关于春天的美好" --timeout 60', description: 'AI 写歌词模式（默认）' },
          { cmd: 'xbrowser doubao music --lyric "明月几时有，把酒问青天，不知天上宫阙" --style 国风 --mood 激昂 --timeout 90', description: '自定义歌词模式，选择国风风格（最多200字）' },
          { cmd: 'xbrowser doubao music --lyric "hello world" --style 流行 --mood 快乐 --voice 女声 --duration 120 --timeout 120', description: '完整参数：自定义歌词+风格+情绪+音色+时长（歌词可短可长，最长200字）' },
          { cmd: 'xbrowser doubao music --description "励志歌曲" --voice 男声 --timeout 60', description: 'AI 写歌词模式，指定音色' },
          { cmd: 'xbrowser doubao music --lyric "测试歌词" --debug --timeout 90', description: '开启 debug 模式，记录 API 请求到 ~/.xbrowser/debug/' },
        ],
    result: z.object({
      url: z.string().optional(),
      localPath: z.string().optional(),
      conversationUrl: z.string().optional(),
      description: z.string().optional(),
      style: z.string().optional(),
      mood: z.string().optional(),
      voice: z.string().optional(),
      duration: z.union([z.string(), z.number()]).optional(),
      lyric: z.string().optional(),
      mode: z.enum(['custom_lyric', 'ai_lyric', 'description']).optional(),
      taskId: z.string().optional(),
      status: z.enum(['pending', 'submitted', 'completed', 'timeout', 'error']).optional(),
      error: z.string().optional(),
    }),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        const tips = buildTips(ctx);
        const waitSeconds = typeof params.timeout === 'number' ? params.timeout : 0;

        if (!params.description && !params.lyric) {
          return fail('❌ 缺少必要参数：需要 --description 或 --lyric', ['请提供 --description（AI 写歌词模式）或 --lyric（自定义歌词模式）']);
        }

        if (params.debug) {
          const debugDir = path.join(process.env.HOME || '', '.xbrowser', 'debug');
          if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
          page.on('request', (req) => {
            const url = req.url();
            if (url.includes('bigmusic') || url.includes('chat/completion') || url.includes('samantha')) {
              const entry = {
                timestamp: new Date().toISOString(),
                url: url.substring(0, 200),
                method: req.method(),
                postData: req.postData()?.substring(0, 2000),
              };
              fs.appendFileSync(
                path.join(debugDir, `music-${Date.now()}.jsonl`),
                JSON.stringify(entry) + '\n'
              );
            }
          });
          tips.push('🐛 Debug 模式已开启，API 请求记录到 ~/.xbrowser/debug/');
        }

        page.on('request', (req) => {
          if (req.url().includes('chat/completion') && req.method() === 'POST') {
            try {
              const body = JSON.parse(req.postData() || '{}');
              const msgs = body.messages || [];
              for (const msg of msgs) {
                if (typeof msg.content === 'string') {
                  try { JSON.parse(msg.content); } catch { /* ignore */ }
                }
              }
            } catch { /* ignore */ }
          }
        });

        // === Phase 0: Navigate to doubao ===
        if (!page.url().includes('doubao.com')) {
          await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        // === Phase 1: Click 音乐生成 ===
        const musicClicked = await safeClickByText(page, '音乐生成');
        if (!musicClicked) {
          return fail('找不到「音乐生成」按钮', ['请确保豆包页面已加载且音乐生成功能可用']);
        }
        tips.push('已点击「音乐生成」按钮');

        // Hook: wait for panel to expand (AI帮我写歌词 appears)
        try {
          await waitForText(page, 'AI 帮我写歌词', 5000);
        } catch { /* panel may already be in different state */ }

        // Register response listener for bigmusic/get_video
        const audioUrlPromise = new Promise<string | null>((resolve) => {
          const timeout = (waitSeconds > 0 ? waitSeconds : 60) * 1000;
          const timer = setTimeout(() => resolve(null), timeout);

          const responseHandler = async (response: import('playwright-core').Response) => {
            const url = response.url();
            if (url.includes('bigmusic/get_video')) {
              try {
                const json = await response.json() as Record<string, unknown>;
                const data = json.data as Record<string, unknown> | undefined;
                if (json.code === 0 && data?.url && typeof data.url === 'string') {
                  clearTimeout(timer);
                  page.off('response', responseHandler);
                  resolve(data.url);
                }
              } catch { /* keep waiting */ }
            }
          };
          page.on('response', responseHandler);
        });

        // === Phase 2: Lyric input ===
        if (params.lyric) {
          const aiClicked = await safeClickByText(page, 'AI 帮我写歌词');
          if (aiClicked) {
            tips.push('已点击「AI 帮我写歌词」');
            // Hook: wait for dropdown with 自定义歌词
            try {
              await waitForText(page, '自定义歌词', 3000);
            } catch { /* dropdown may have different text */ }

            const customClicked = await safeClickByText(page, '自定义歌词');
            if (customClicked) {
              tips.push('已选择「自定义歌词」');
            } else {
              tips.push('⚠ 未找到「自定义歌词」选项，继续使用 AI 歌词');
            }
          }

          // Lyric length limit: 200 chars
          const lyricText = params.lyric.length > 200 ? params.lyric.slice(0, 200) : params.lyric;
          const truncated = params.lyric.length !== lyricText.length;
          if (truncated) {
            tips.push(`⚠ 歌词超过 200 字，已截断到 ${lyricText.length} 字`);
          }

          // Hook: wait for textarea to appear
          try {
            await page.waitForSelector('textarea[placeholder="自定义歌词"]', { timeout: 5000 });
          } catch { /* may already exist */ }

          // Click textarea via evaluateHandle + boundingBox
          const taHandle = await page.evaluateHandle(() =>
            document.querySelector('textarea[placeholder="自定义歌词"]')
          );
          const taEl = taHandle.asElement();
          if (taEl) {
            const taBox = await taEl.boundingBox();
            if (taBox) {
              await page.mouse.click(taBox.x + taBox.width / 2, taBox.y + taBox.height / 2);
            }
          }

          await page.keyboard.type(lyricText, { delay: 30 });
          tips.push(`已输入歌词(${lyricText.length}字)`);

          // Hook: wait for confirm button to be enabled
          try {
            await page.waitForFunction(() => {
              const btns = [...document.querySelectorAll('span, button')];
              const confirm = btns.find(b => b.textContent?.trim() === '确认');
              if (!confirm) return false;
              return !(confirm as HTMLButtonElement).disabled;
            }, { timeout: 5000 });
          } catch { /* confirm button may already be enabled */ }

          const confirmClicked = await safeClickByText(page, '确认');
          if (confirmClicked) {
            tips.push('已确认歌词');
          } else {
            tips.push('⚠ 未找到确认按钮');
          }

          // Hook: wait for dialog to close
          try {
            await waitForGone(page, 'textarea[placeholder="自定义歌词"]', 3000);
          } catch { /* dialog may already be closed */ }

        } else if (params.description) {
          // AI lyric mode — type description in editable span
          const editHandle = await page.evaluateHandle(() => {
            const spans = document.querySelectorAll('span[contenteditable]');
            for (const s of spans) {
              if (s.textContent?.includes('描述歌词要表达的主题')) return s;
            }
            return null;
          });
          const editEl = editHandle.asElement();
          if (editEl) {
            const editBox = await editEl.boundingBox();
            if (editBox) await page.mouse.click(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2);
            const filled = await page.evaluate((desc) => {
              const editableSpans = document.querySelectorAll('span[contenteditable]');
              for (const s of editableSpans) {
                if (s.textContent?.includes('描述歌词要表达的主题')) {
                  s.focus();
                  document.execCommand('selectAll', false);
                  document.execCommand('insertText', false, desc);
                  return true;
                }
              }
              return false;
            }, params.description!);
            if (filled) tips.push(`已输入描述: "${params.description}"`);
            else tips.push('⚠ 描述输入失败');
          } else {
            tips.push('⚠ 未找到描述输入区域');
          }
        }

        // === Phase 4: Select style/mood/voice ===
        const genreMap: Record<string, string[]> = {
          style: ['流行', '嘻哈', '国风', 'DJ', '摇滚', '民谣', 'R&B', '雷鬼', '朋克', '电音', '爵士'],
          mood: ['快乐', '放松', '活力', '兴奋', '忧郁', '鼓舞', '伤感', '怀旧', '浪漫'],
          voice: ['女声', '男声'],
        };
        const categoryFor: Record<string, 'style' | 'mood' | 'voice'> = {
          '流行': 'style', '嘻哈': 'style', '国风': 'style', 'DJ': 'style', '摇滚': 'style', '民谣': 'style',
          'R&B': 'style', '雷鬼': 'style', '朋克': 'style', '电音': 'style', '爵士': 'style',
          '快乐': 'mood', '放松': 'mood', '活力': 'mood', '兴奋': 'mood', '忧郁': 'mood', '鼓舞': 'mood', '伤感': 'mood', '怀旧': 'mood', '浪漫': 'mood',
          '女声': 'voice', '男声': 'voice',
        };

        const selectInlineOption = async (target: string): Promise<boolean> => {
          const cat = categoryFor[target];
          if (!cat) return false;
          const candidates = genreMap[cat];
          const current = await page.evaluateHandle((opts: string[]) => {
            const all = document.querySelectorAll('span,div');
            for (const s of all) {
              const t = s.textContent.trim();
              if (t.length > 0 && t.length < 10 && opts.includes(t) && s.offsetParent !== null && !s.isContentEditable) return s;
            }
            return null;
          }, candidates);
          const curEl = current.asElement();
          if (!curEl) return false;
          const curBox = await curEl.boundingBox();
          if (!curBox) return false;
          await page.mouse.click(curBox.x + curBox.width / 2, curBox.y + curBox.height / 2);
          // Hook: wait for dropdown option to appear
          try {
            await page.waitForFunction((text: string) => {
              const all = document.querySelectorAll('span,div');
              for (const d of all) {
                if (d.textContent.trim() === text && d.offsetParent !== null && d.getAttribute('role') !== 'tab') {
                  const rect = d.getBoundingClientRect();
                  if (rect.y > 0 && rect.height < 80 && rect.height > 10) return true;
                }
              }
              return false;
            }, target, { timeout: 3000 });
          } catch { /* dropdown may not appear */ }

          const optHandle = await page.evaluateHandle((text: string) => {
            const all = document.querySelectorAll('span,div');
            for (const d of all) {
              if (d.textContent.trim() === text && d.offsetParent !== null && d.getAttribute('role') !== 'tab') {
                const rect = d.getBoundingClientRect();
                if (rect.y > 0 && rect.height < 80 && rect.height > 10) return d;
              }
            }
            return null;
          }, target);
          const optEl = optHandle.asElement();
          if (optEl) {
            const optBox = await optEl.boundingBox();
            if (optBox) {
              await page.mouse.click(optBox.x + optBox.width / 2, optBox.y + optBox.height / 2);
              return true;
            }
          }
          await page.mouse.click(10, 10).catch(() => {});
          return false;
        };

        if (params.style) {
          const selected = await selectInlineOption(params.style);
          if (selected) tips.push(`已选择风格: ${params.style}`);
          else tips.push(`⚠ 未选中风格"${params.style}"，使用默认`);
        }
        if (params.mood) {
          const selected = await selectInlineOption(params.mood);
          if (selected) tips.push(`已选择情绪: ${params.mood}`);
          else tips.push(`⚠ 未选中情绪"${params.mood}"，使用默认`);
        }
        if (params.voice) {
          const selected = await selectInlineOption(params.voice);
          if (selected) tips.push(`已选择音色: ${params.voice}`);
          else tips.push(`⚠ 未选中音色"${params.voice}"，使用默认`);
        }

        // === Phase 5: Submit ===
        // Hook: wait for auto-generated description text to appear
        try {
          await page.waitForFunction(() => {
            const all = document.querySelectorAll('div');
            return Array.from(all).some(d => {
              const t = d.textContent?.trim() || '';
              return t.startsWith('我想创作一首歌曲') && d.offsetParent !== null && t.length < 300;
            });
          }, { timeout: 10000 });
        } catch { /* description text may not appear yet */ }

        const descHandle = await page.evaluateHandle(() => {
          const all = document.querySelectorAll('div');
          for (const d of all) {
            const t = d.textContent?.trim() || '';
            if (t.startsWith('我想创作一首歌曲') && d.offsetParent !== null && t.length < 300) {
              const rect = d.getBoundingClientRect();
              if (rect.height > 10 && rect.height < 200) return d;
            }
          }
          return null;
        });
        const descEl = descHandle.asElement();
        if (descEl) {
          const descBox = await descEl.boundingBox();
          if (descBox) {
            await page.mouse.click(descBox.x + descBox.width / 2, descBox.y + descBox.height / 2);
            tips.push('已点击自动生成的描述文本');
            if (params.duration) {
              await page.keyboard.type(` ${params.duration}s`, { delay: 30 });
              tips.push(`已追加时长: ${params.duration}s`);
            }
          }
        } else if (params.duration) {
          const editorHandle = await page.evaluateHandle(() =>
            document.querySelector('div[aria-label="doc_editor"]') || document.querySelector('[contenteditable="true"]')
          );
          const editorEl = editorHandle.asElement();
          if (editorEl) {
            const editorBox = await editorEl.boundingBox();
            if (editorBox) {
              await page.mouse.click(editorBox.x + editorBox.width - 10, editorBox.y + editorBox.height / 2);
              await page.keyboard.type(` ${params.duration}s`, { delay: 30 });
              tips.push(`已追加时长: ${params.duration}s`);
            }
          }
        }

        // Click send button
        const sendHandle = await page.evaluateHandle(() => document.querySelector('#flow-end-msg-send'));
        const sendEl = sendHandle.asElement();
        if (sendEl) {
          const sendBox = await sendEl.boundingBox();
          if (sendBox) await page.mouse.click(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2);
        } else {
          await page.keyboard.press('Enter').catch(() => {});
        }
        tips.push('音乐生成请求已发送，等待 AI 生成...');

        const ctxAny = ctx as unknown as Record<string, unknown>;
        const opts = ctxAny.options as Record<string, unknown> | undefined;
        const cdpFlag = ctxAny.cdpEndpoint || opts?.cdp;
        const cdpSuffix = cdpFlag ? ` --cdp ${cdpFlag}` : '';

        const conversationUrl = page.url();
        const activeDescription = params.description || params.lyric || '';
        const mode = params.lyric ? 'custom_lyric' : 'ai_lyric';

        // === Phase 6: Wait for result ===
        if (waitSeconds > 0) {
          tips.push(`⏳ 等待音乐生成（最长 ${waitSeconds} 秒）...`);

          const startTime = Date.now();
          const maxWait = waitSeconds * 1000;
          let audioUrl: string | null = null;

          while (Date.now() - startTime < maxWait) {
            const networkResult = await Promise.race([
              audioUrlPromise.then(u => u),
              new Promise<null>(r => setTimeout(() => r(null), 5000))
            ]);
            if (networkResult) {
              audioUrl = networkResult;
              break;
            }

            const domUrl = await extractPageAudio(page);
            if (domUrl) {
              audioUrl = domUrl;
              break;
            }

            const hasError = await page.evaluate(() => {
              const body = document.body.innerText;
              return /生成失败|出错了|无法生成|请求过于频繁|请稍后再试|抱歉/.test(body);
            });
            if (hasError) break;
          }

          if (audioUrl) {
            const downloaded = await downloadMedia(audioUrl, 'music');
            return ok({
              url: audioUrl,
              localPath: downloaded.localPath,
              conversationUrl,
              description: activeDescription,
              style: params.style || undefined,
              mood: params.mood || undefined,
              voice: params.voice || undefined,
              duration: params.duration || undefined,
              lyric: params.lyric || undefined,
              mode,
              status: 'completed',
            }, [...tips, '✅ 音乐生成完成！', `📁 音频已下载: ${downloaded.localPath} (${formatFileSize(downloaded.size)})`]);
          }

          const hasError = await page.evaluate(() => {
            const errorSelectors = [
              '[class*="error"]', '[class*="toast"]', '[class*="notice"]',
              '[class*="alert"]', '[class*="warning"]', '[role="alert"]',
            ];
            for (const sel of errorSelectors) {
              const el = document.querySelector(sel);
              if (el && el.offsetParent !== null) {
                const t = (el.textContent || '').trim();
                if (t.length > 0 && t.length < 200) return true;
              }
            }
            const body = document.body.innerText;
            return /生成失败|出错了|无法生成|请求过于频繁|操作过于频繁|请稍后再试|抱歉/.test(body);
          });
          if (hasError) {
            return ok({
              error: '生成失败',
              conversationUrl,
              description: activeDescription,
              lyric: params.lyric || undefined,
              mode,
              status: 'error',
            }, [...tips, '❌ 音乐生成失败，请检查豆包页面']);
          }

          return ok({
            status: 'timeout',
            conversationUrl,
            description: activeDescription,
            lyric: params.lyric || undefined,
            mode,
          }, [
            ...tips,
            `⏱ 等待超时（${waitSeconds}秒），音乐可能还在生成中`,
            `恢复查看: 使用相同 --cdp 重新执行命令会自动回到此对话`,
            `或查看创作历史: xbrowser doubao my-creations --type all${cdpSuffix ? ' --cdp ' + cdpFlag : ''}`,
          ]);
        }

        return ok({
          status: 'submitted',
          conversationUrl,
          description: activeDescription,
          style: params.style || undefined,
          mood: params.mood || undefined,
          voice: params.voice || undefined,
          duration: params.duration || undefined,
          lyric: params.lyric || undefined,
          mode,
        }, [
          ...tips,
          `✅ 音乐生成已提交！${params.lyric ? '模式: 自定义歌词' : `描述: "${activeDescription}"`}`,
          `⏱ 预计 25-60 秒后生成完成`,
          `恢复查看: 使用相同 --cdp 重新执行命令会自动回到此对话`,
          `或查看创作历史: xbrowser doubao my-creations --type all${cdpSuffix ? ' --cdp ' + cdpFlag : ''}`,
        ]);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return fail('未知错误', ['提交音乐生成失败', `原因: ${errMsg}`]);
      }
    },
  });

  //  14. music-status — 检查音乐生成状态
  site.command('music-status', {
    description: '检查当前页面音乐生成状态（需保持同一 --session）',
    scope: 'browser',
    parameters: z.object({
      task: z.string().optional().describe('任务 ID（可选，仅供标记）'),
    }),
    examples: [
      { cmd: 'xbrowser doubao music-status --task my-music --session music-session --cdp 9221', description: '检查音乐状态' },
    ],
    result: z.object({ status: z.string(), taskId: z.string().nullable(), url: z.string().nullable() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        const tips = buildTips(ctx);

        // Try to find audio first → completed
        const audioUrl = await extractPageAudio(page);
        if (audioUrl) {
          const downloaded = await downloadMedia(audioUrl, 'music');
          return ok({ status: 'completed', url: audioUrl, localPath: downloaded.localPath, taskId: params.task || null }, [...tips, `📁 音频已下载: ${downloaded.localPath} (${formatFileSize(downloaded.size)})`]);
        }

        // Otherwise check text indicators
        const status = await page.evaluate(() => {
          const t = document.body?.textContent || '';
          if (/完成|已生成|success|completed/.test(t)) return 'completed';
          if (/生成中|处理中|processing/.test(t)) return 'processing';
          if (/失败|出错|failed|error/.test(t)) return 'failed';
          if (/排队|pending/.test(t)) return 'pending';
          return 'unknown';
        });

        const ctxAnyB = ctx as unknown as Record<string, unknown>;
        const optsB = ctxAnyB.options as Record<string, unknown> | undefined;
        const cdpFlagB = ctxAnyB.cdpEndpoint || optsB?.cdp;
        const cdpSuffixB = cdpFlagB ? ` --cdp ${cdpFlagB}` : '';
        const sessionNameB = (optsB?.session as string) || 'default';
        const sessionSuffixB = ` --session ${sessionNameB}${cdpSuffixB}`;

        return ok({ status, taskId: params.task || null, url: null }, [
            ...tips,
            status === 'completed' ? '✅ 已完成' :
            status === 'processing' ? '⏳ 生成中，请稍候' :
            status === 'failed' ? '❌ 生成失败' :
            '⏱ 状态未知，可能是新页面',
            `获取结果: xbrowser doubao music-result${sessionSuffixB}`,
            `查看创作: xbrowser doubao my-creations --type all${sessionSuffixB}`,
          ]);
      } catch (error) {
        return fail('未知错误', ['检查状态失败']);
      }
    },
  });

  //  15. music-result — 获取已生成的音乐 URL
  site.command('music-result', {
    description: '获取已完成音乐的音频 URL（需保持同一 --session）',
    scope: 'browser',
    parameters: z.object({
      task: z.string().optional().describe('任务 ID（可选，仅供标记）'),
    }),
    examples: [
      { cmd: 'xbrowser doubao music-result --session music-session --cdp 9221', description: '获取音乐 URL' },
      { cmd: 'xbrowser doubao music-result --task my-track --session music-session --cdp 9221', description: '带标记获取' },
    ],
    result: z.object({ url: z.string().nullable(), localPath: z.string().optional(), taskId: z.string().nullable() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        const tips = buildTips(ctx);

        const audioUrl = await extractPageAudio(page);

        if (audioUrl) {
          const downloaded = await downloadMedia(audioUrl, 'music');
          return ok({ url: audioUrl, localPath: downloaded.localPath, taskId: params.task || null }, [...tips, `📁 音频已下载: ${downloaded.localPath} (${formatFileSize(downloaded.size)})`]);
        }

        // No audio found — give user actionable instructions
        const ctxAnyC = ctx as unknown as Record<string, unknown>;
        const optsC = ctxAnyC.options as Record<string, unknown> | undefined;
        const cdpFlagC = ctxAnyC.cdpEndpoint || optsC?.cdp;
        const cdpSuffixC = cdpFlagC ? ` --cdp ${cdpFlagC}` : '';
        const sessionNameC = (optsC?.session as string) || 'default';
        const sessionSuffixC = ` --session ${sessionNameC}${cdpSuffixC}`;

        const hasSubmitted = await page.evaluate(() => {
          const t = document.body?.textContent || '';
          return /生成|music|音频|音乐/.test(t);
        });

        if (hasSubmitted) {
          return ok({ url: null, taskId: params.task || null }, [
              ...tips,
              '⏱ 音乐还在生成中，请稍候再试',
              `重试: xbrowser doubao music-result${sessionSuffixC}`,
              `查看创作历史: xbrowser doubao my-creations --type all${sessionSuffixC}`,
            ]);
        }

        return ok({ url: null, taskId: params.task || null }, [
            ...tips,
            '⚠ 当前页面没有找到音乐结果。可能的原因:',
            '  1. 未提交音乐生成任务，请先执行 music 命令',
            '  2. 页面不是之前提交任务的页面，需使用同一 --session',
            `  确保: xbrowser doubao music --prompt "..."${sessionSuffixC}`,
            `  然后: xbrowser doubao music-result${sessionSuffixC}`,
          ]);
      } catch (error) {
        return fail('未知错误', ['获取音乐结果失败']);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  FILE & CLOUD DRIVE (2 commands)
  // ═══════════════════════════════════════════════════

  //  16. upload — 上传文件到豆包
  site.command('upload', {
    description: '上传文件到豆包',
    scope: 'browser',
    parameters: z.object({
      path: z.string().describe('待上传文件路径'),
    }),
    examples: [
      { cmd: 'xbrowser doubao upload --path /path/to/document.pdf', description: '上传文件' },
      { cmd: 'xbrowser doubao upload --path ~/photo.jpg', description: '上传图片' },
    ],
    result: z.object({ file: z.string(), uploaded: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);
        const tips = buildTips(ctx);

        const absPath = path.resolve(params.path);
        if (!fs.existsSync(absPath)) throw new Error(`文件不存在: ${absPath}`);

        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        if (!uploaded) {
          const uploadBtnSelectors = [
            '[class*="upload"]', '[class*="attach"]', '[class*="file"]',
            '[class*="cloud-upload"]',
          ];
          let btnClicked = false;
          for (const sel of uploadBtnSelectors) {
            if (await safeClickSelector(page, sel)) {
              await page.waitForTimeout(500);
              btnClicked = true;
              break;
            }
          }
          if (!btnClicked) {
            const textHandle = await page.evaluateHandle(() => {
              return Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('上传')) || null;
            });
            const textEl = textHandle.asElement();
            if (textEl) {
              const textBox = await textEl.boundingBox();
              if (textBox) await page.mouse.click(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
              await page.waitForTimeout(500);
              btnClicked = true;
            }
          }
          if (!btnClicked) throw new Error('找不到上传按钮或文件输入框');
          const retry = await uploadFileViaDataTransfer(page, absPath);
          if (!retry) throw new Error('文件上传失败');
        }

        await page.waitForTimeout(1500);
        return ok({ file: absPath, uploaded: true }, [...tips, `文件名: ${path.basename(absPath)}`]);
      } catch (error) {
        return fail('未知错误', ['文件上传失败']);
      }
    },
  });

  //  17. cloud-drive — 云盘文件管理
  site.command('cloud-drive', {
    description: '查看豆包云盘文件列表',
    scope: 'browser',
    parameters: z.object({
      list: z.boolean().optional().describe('列出云盘文件'),
    }),
    examples: [
      { cmd: 'xbrowser doubao cloud-drive --list', description: '列出云盘文件' },
    ],
    result: z.object({ files: z.array(z.record(z.any())), total: z.number() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        const driveClicked = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('云盘') || node.textContent?.includes('我的文件') || node.textContent?.includes('空间')) {
              const parent = node.parentElement;
              if (parent) { parent.click(); return true; }
            }
          }
          return false;
        });

        if (!driveClicked) tips.push('⚠ 未找到云盘入口，请手动打开云盘页面');

        await page.waitForTimeout(2000);

        const files = await page.evaluate(() => {
          const fileItems = document.querySelectorAll(
            '[class*="file-item"], [class*="file-list"] [class*="item"], [class*="drive-item"], [class*="cloud-file"]'
          );
          return Array.from(fileItems).slice(0, 100).map((el, i) => ({
            index: i,
            name: el.textContent?.trim() || '',
            type: el.getAttribute('data-type') || el.getAttribute('data-ext') || '',
          }));
        });

        return ok({ files, total: files.length }, [...tips, `云盘中共 ${files.length} 个文件`]);
      } catch (error) {
        return fail('未知错误', ['获取云盘文件失败']);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  OTHER (3 commands)
  // ═══════════════════════════════════════════════════

  //  18. mode — 切换 AI 模型
  site.command('mode', {
    description: '切换豆包 AI 模型',
    scope: 'browser',
    parameters: z.object({
      model: z.string().describe('模型名称（如：豆包Pro、豆包1.5、Seedream、Seedance 等）'),
    }),
    examples: [
      { cmd: 'xbrowser doubao mode --model 豆包Pro', description: '切换到豆包Pro' },
      { cmd: 'xbrowser doubao mode --model Seedream', description: '切换到 Seedream' },
    ],
    result: z.object({ model: z.string(), switched: z.boolean().optional() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        const modelName = params.model;
        const clicked = await page.evaluate((name: string) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.trim() === name || node.textContent?.includes(name)) {
              const parent = node.parentElement;
              if (parent) {
                parent.click();
                return true;
              }
            }
          }
          const selectors = [
            `[class*="model"]:has-text("${name}")`,
            `[class*="model-select"] option:has-text("${name}")`,
            `[class*="dropdown"] [class*="item"]:has-text("${name}")`,
          ];
          for (const sel of selectors) {
            const el = document.querySelector<HTMLElement>(sel);
            if (el) { el.click(); return true; }
          }
          return false;
        }, modelName);

        if (!clicked) {
          return ok({ model: modelName }, [...tips, '未找到模型选择器，可能页面结构不同']);
        }

        await page.waitForTimeout(1000);
        return ok({ model: modelName, switched: true }, tips);
      } catch (error) {
        return fail('未知错误', ['切换模型失败']);
      }
    },
  });

  //  19. search — 联网搜索
  site.command('search', {
    description: '联网搜索并返回带来源的结果',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索查询词'),
    }),
    examples: [
      { cmd: 'xbrowser doubao search --query "今日热搜"', description: '联网搜索' },
    ],
    result: z.object({}).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);

        const searchEnabled = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('联网搜索') || node.textContent?.includes('搜索') || node.textContent?.includes('联网')) {
              const parent = node.parentElement;
              if (parent) {
                const isActive = parent.getAttribute('aria-checked') === 'true'
                  || parent.getAttribute('aria-pressed') === 'true'
                  || parent.classList.contains('active');
                if (!isActive) {
                  parent.click();
                  return 'toggled_on';
                }
                return 'already_on';
              }
            }
          }
          return 'not_found';
        });

        if (searchEnabled === 'not_found') {
          tips.push('⚠ 未找到联网搜索开关，可能已默认开启');
        } else if (searchEnabled === 'toggled_on') {
          tips.push('已开启联网搜索');
          await page.waitForTimeout(500);
        }

        const searchInputLocators = ['textarea', '[contenteditable="true"]', '[role="textbox"]', '[class*="chat-input"] textarea'];
        let searchInputEl: Awaited<ReturnType<typeof page.locator>> | null = null;
        let searchInputSel: string | null = null;
        for (const sel of searchInputLocators) {
          const loc = page.locator(sel).first();
          if (await loc.count() > 0) {
            searchInputEl = loc;
            searchInputSel = sel;
            break;
          }
        }

        if (!searchInputEl || !searchInputSel) throw new Error('找不到输入框');

        await safeClickSelector(page, searchInputSel);
        await page.evaluate(({ sel, msg }: { sel: string; msg: string }) => {
          const el = document.querySelector(sel) as HTMLTextAreaElement;
          if (!el) return;
          el.focus();
          if ('value' in el) {
            el.value = msg;
          } else {
            el.textContent = msg;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { sel: searchInputSel, msg: params.query });
        await page.waitForTimeout(500);
        let capturedStream = '';
        await page.route('**/doubao.com/chat/completion', async (route) => {
          const resp = await route.fetch();
          const body = await resp.text();
          capturedStream += body;
          await route.fulfill({ body, headers: resp.headers(), status: resp.status() });
        });

        await page.keyboard.press('Enter');
        tips.push('搜索请求已发送');
        await page.waitForTimeout(2000);

        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(1500);
          try {
            responseText = await page.evaluate((query: string) => {
              const getText = (el: Element) => el.textContent?.trim() || '';
              const pageTxt = document.body.textContent || '';

              if (pageTxt.includes('停止生成') || pageTxt.includes('思考中') || pageTxt.includes('生成中')) return '';

              const chatArea = document.querySelector('[class*="min-h-100"]');
              if (chatArea) {
                const containers = chatArea.querySelectorAll('div[class*="container-"]');
                if (containers.length > 0) {
                  const last = containers[containers.length - 1];
                  const txt = getText(last);
                  if (txt.length > 0 && !txt.includes(query)) return txt.slice(0, 2000);
                }
                const mdBody = chatArea.querySelector('[class*="flow-markdown-body"]');
                if (mdBody) {
                  const txt = getText(mdBody);
                  if (txt.length > 0) return txt.slice(0, 2000);
                }
              }
              const allContainers = document.querySelectorAll('div[class*="container-"]');
              if (allContainers.length > 0) {
                const last = allContainers[allContainers.length - 1];
                const txt = getText(last);
                if (txt.length > 0 && !txt.includes(query)) return txt.slice(0, 2000);
              }
              const allMd = document.querySelectorAll('[class*="flow-markdown-body"]');
              if (allMd.length > 0) {
                const last = allMd[allMd.length - 1];
                const txt = getText(last);
                if (txt.length > 0) return txt.slice(0, 2000);
              }
              return '';
            }, params.query);
            if (responseText) break;
          } catch { /* ignore */ }
        }

        await page.unroute('**/doubao.com/chat/completion').catch(() => {});

        let allUrls: string[] = [];
        if (capturedStream) {
          const urlMatches = capturedStream.match(/https?:\/\/[^"'\s,<>\\\]\)]+/g) || [];
          for (const u of urlMatches) {
            const clean = u.replace(/\\u002F/g, '/').split(/[)\]"'.,;:!?]+$/)[0];
            try { new URL(clean); allUrls.push(clean); } catch { /* ignore */ }
          }
        }

        if (allUrls.length === 0) {
          const domData = await page.evaluate(() => {
            const links = document.querySelectorAll('a[href*="http"]');
            const seen = new Set<string>();
            return Array.from(links).filter(a => {
              const h = a.getAttribute('href');
              if (!h || seen.has(h)) return false;
              seen.add(h);
              return true;
            }).map(a => a.getAttribute('href') || '');
          });
          allUrls = domData;
        }

        const seen = new Set<string>();
        const uniqueUrls = allUrls.filter(u => {
          const k = u.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        const domains = new Set<string>();
        for (const u of uniqueUrls) {
          try { domains.add(new URL(u).hostname.replace(/^www\./, '')); } catch { /* ignore */ }
        }

        return fail('未知错误', [...tips, `搜索来源：${domains.size} 个域名, ${uniqueUrls.length} 条链接`]);
      } catch (error) {
        return fail('未知错误', ['搜索失败']);
      }
    },
  });

  //  20. attach — 上传附件（支持多种文件格式，最多50个文件）
  site.command('attach', {
    description: '上传附件（支持 pdf/txt/csv/docx/xlsx/pptx/md/mobi/epub 及图片，最多50个文件）',
    scope: 'browser',
    parameters: z.object({
      type: z.enum(['image', 'file']).describe('附件类型：image=图片, file=文件'),
      path: z.string().describe('附件路径'),
    }),
    examples: [
      { cmd: 'xbrowser doubao attach image ~/photo.jpg', description: '上传图片' },
      { cmd: 'xbrowser doubao attach file ~/document.pdf', description: '上传文件' },
      { cmd: 'xbrowser doubao attach file ~/report.xlsx', description: '上传 Excel 文件' },
    ],
    result: z.object({ type: z.string(), file: z.string(), uploaded: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(500);
        const tips = buildTips(ctx);

        const absPath = path.resolve(params.path);
        if (!fs.existsSync(absPath)) throw new Error(`文件不存在: ${absPath}`);

        const ext = path.extname(absPath).toLowerCase();
        const supportedExts = ['.pdf', '.txt', '.csv', '.docx', '.xlsx', '.pptx', '.md', '.mobi', '.epub',
          '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
        if (!supportedExts.includes(ext)) {
          tips.push(`⚠ 文件格式 ${ext} 可能不受支持，将尝试上传`);
        }

        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        if (!uploaded) {
          const uploadBtnSelectors = [
            '[class*="attach"]', '[class*="upload"]',
          ];
          let clicked = false;
          for (const sel of uploadBtnSelectors) {
            if (await safeClickSelector(page, sel)) {
              await page.waitForTimeout(500);
              clicked = true;
              break;
            }
          }
          if (!clicked) {
            const textHandle = await page.evaluateHandle(() => {
              return Array.from(document.querySelectorAll('button')).find(
                b => b.textContent?.includes('上传') || b.textContent?.includes('附件')
              ) || null;
            });
            const textEl = textHandle.asElement();
            if (textEl) {
              const textBox = await textEl.boundingBox();
              if (textBox) await page.mouse.click(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
              await page.waitForTimeout(500);
              clicked = true;
            }
          }
          if (!clicked) throw new Error('找不到附件上传入口');
          const retry = await uploadFileViaDataTransfer(page, absPath);
          if (!retry) throw new Error('附件上传失败');
        }

        await page.waitForTimeout(1000);
        return ok({ type: params.type, file: absPath, uploaded: true }, [...tips, `附件: ${path.basename(absPath)}`]);
      } catch (error) {
        return fail('未知错误', ['上传附件失败']);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  LOGIN / LOGOUT
  // ═══════════════════════════════════════════════════

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(DB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录豆包');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录豆包:');
      console.log('   1. 打开 Viewer（实时查看浏览器画面）:');
      console.log(`      agent-browser viewer --session ${sessionId || 'default'}`);
      console.log('   2. 在 Viewer 页面中登录豆包');
      console.log('   3. 登录后回到此终端，按 Enter 继续');
      console.log('');
      console.log('   也可以用截图模式查看当前页面状态:');
      console.log('      xbrowser screenshot --session ' + (sessionId || 'default'));
      console.log('');
    } else if (!cdp) {
      console.log('');
      console.log('⚠️  推荐使用 --cdp 参数连接到已登录的浏览器:');
      console.log('     xbrowser doubao list --cdp http://localhost:9221');
      console.log('');
      console.log('🔑 或者启动 Viewer 手动登录:');
      console.log('   1. 启动浏览器会话:');
      console.log('      xbrowser session open ' + DB_URL + ' --name doubao-login');
      console.log('   2. 启动 Viewer:');
      console.log('      agent-browser viewer --session doubao-login');
      console.log('   3. 在 Viewer 中登录后:');
      console.log('      xbrowser doubao list --session doubao-login');
      console.log('');
    }

    if (page) {
      await page.goto(DB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
    console.log('✅ 继续执行');
  });

  site.logout(async (_ctx) => {
    console.log('⚠️  请在浏览器中手动退出豆包登录');
  });
}
