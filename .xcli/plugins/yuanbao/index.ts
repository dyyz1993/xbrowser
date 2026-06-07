import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

type Page = import('../types').Page;

const SITE_URL = 'https://yuanbao.tencent.com';

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

async function ensurePage(page: Page, ctx?: CommandContext): Promise<void> {
  if (!page.url().startsWith(SITE_URL)) {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
      if (bodyText.includes('登录') && !bodyText.includes('元宝')) {
        const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
        throw new Error(
          '腾讯元宝 (Yuanbao) 未登录！\n' +
          (cdp
            ? '  使用 --cdp 连接的浏览器未登录元宝，请先在浏览器中登录。\n  或运行: xbrowser yuanbao login'
            : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser yuanbao list --cdp http://localhost:9221')
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

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'yuanbao',
    url: SITE_URL,
    description: '腾讯元宝 (Yuanbao) — 会话管理、消息发送、附件上传',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const url = page.url();
        if (url.includes('/login') || url.includes('/auth') || url.includes('/passport')) return false;
        const hasInput = await page.evaluate(() => {
          const editor = document.querySelector('.ql-editor, #searchbar-editor, [contenteditable="true"]');
          return !!editor;
        });
        if (hasInput) return true;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body || (body.includes('登录') && body.includes('注册'))) return false;
        return true;
      } catch {
        return false;
      }
    },
  });

  site.command('list', {
    description: '列出所有历史会话',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({}),
    result: z.array(z.object({ index: z.number(), title: z.string(), url: z.string() }).passthrough()),
    examples: [
      { cmd: 'xbrowser yuanbao list', description: '列出所有会话' },
      { cmd: 'xbrowser yuanbao list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll(
            'a[href*="/chat/"], [class*="conversation"] a, [class*="history"] a, [class*="session"] a'
          );
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

  site.command('new', {
    description: '创建新的空白对话',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ created: z.boolean() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao new', description: '新建对话' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);

        const result = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            const txt = node.textContent || '';
            if (txt.includes('新建对话') || txt.includes('发起新对话') || txt.includes('新对话')) {
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
            const btns = document.querySelectorAll('[class*="new"] button, [class*="add"] button, [class*="create"] button, [class*="plus"] button, button[class*="new"], button[class*="add"]');
            if (btns.length > 0) {
              (btns[0] as HTMLElement).click();
              return 'clicked_icon';
            }
            const newLinks = document.querySelectorAll('a[href*="/chat/new"], a[href*="/new"]');
            if (newLinks.length > 0) {
              (newLinks[0] as HTMLAnchorElement).click();
              return 'clicked_link';
            }
            return 'failed';
          });
          if (fallback === 'failed') throw new Error('找不到"新建对话"按钮');
        }

        await page.waitForTimeout(1500);
        return ok({ created: true }, buildTips(ctx));
      } catch (error) {
        return fail('未知错误', ['创建新对话失败']);
      }
    },
  });

  site.command('open', {
    description: '通过标题打开指定会话（模糊匹配）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('会话标题（支持模糊匹配）'),
    }),
    result: z.object({ opened: z.string() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao open "工作计划"', description: '打开指定会话' },
      { cmd: 'xbrowser yuanbao open "代码"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);

        const clicked = await page.evaluate((title: string) => {
          const links = document.querySelectorAll(
            'a[href*="/chat/"], [class*="conversation"] a, [class*="history"] a, [class*="session"] a'
          );
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

  site.command('chat', {
    description: '发送消息并等待 AI 回复，支持文件上传',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      attach: z.string().optional().describe('附件路径（图片或文件）'),
      attachType: z.enum(['image', 'file', 'url']).optional().describe('附件类型'),
      think: z.boolean().optional().describe('开启深度思考模式'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    result: z.object({ response: z.string(), duration: z.string().optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser yuanbao chat "分析这张图" --attach /path/to/img.jpg', description: '发送消息+图片' },
      { cmd: 'xbrowser yuanbao chat "深度分析" --think', description: '开启深度思考' },
      { cmd: 'xbrowser yuanbao chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000);
        const tips = buildTips(ctx);

        // 开启深度思考
        if (params.think) {
          try {
            const thinkResult = await page.evaluate(() => {
              const allEls = document.querySelectorAll('*');
              let candidates: Array<{ element: Element; text: string; tag: string; class: string; visible: boolean }> = [];

              for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if ((text === '深度思考' || text === '思考' || text.includes('Think'))
                    && el.children.length <= 3) {
                  const rect = el.getBoundingClientRect();
                  candidates.push({
                    element: el,
                    text,
                    tag: el.tagName,
                    class: el.className,
                    visible: rect.width > 0 && rect.height > 0
                  });
                }
              }

              // 优先选择可见的元素
              const visibleCandidates = candidates.filter(c => c.visible);
              const candidate = visibleCandidates.length > 0 ? visibleCandidates[0] : candidates[0];

              if (!candidate) {
                return { found: false, count: 0 };
              }

              const btn = candidate.element.closest('button, [role="switch"]') || candidate.element.parentElement;
              if (btn && btn instanceof HTMLElement) {
                btn.click();
                return { found: true, text: candidate.text, count: candidates.length };
              }
              return { found: false, count: candidates.length };
            });

            if (thinkResult.found) {
              tips.push(`已开启深度思考 (找到 ${thinkResult.count} 个候选元素)`);
              await page.waitForTimeout(1000);
            } else {
              tips.push(`⚠ 未找到深度思考开关 (搜索到 ${thinkResult.count} 个候选元素)`);
            }
          } catch (err) {
            tips.push(`⚠ 开启深度思考失败: ${err instanceof Error ? err.message : '未知错误'}`);
          }
        }

        // 开启联网搜索
        if (params.search) {
          try {
            const searchResult = await page.evaluate(() => {
              const allEls = document.querySelectorAll('*');
              let candidates: Array<{ element: Element; text: string; tag: string; class: string; visible: boolean }> = [];

              for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if ((text === '联网搜索' || text === '搜索' || text.includes('Search'))
                    && el.children.length <= 3) {
                  const rect = el.getBoundingClientRect();
                  candidates.push({
                    element: el,
                    text,
                    tag: el.tagName,
                    class: el.className,
                    visible: rect.width > 0 && rect.height > 0
                  });
                }
              }

              // 优先选择可见的元素
              const visibleCandidates = candidates.filter(c => c.visible);
              const candidate = visibleCandidates.length > 0 ? visibleCandidates[0] : candidates[0];

              if (!candidate) {
                return { found: false, count: 0 };
              }

              const btn = candidate.element.closest('button, [role="switch"]') || candidate.element.parentElement;
              if (btn && btn instanceof HTMLElement) {
                btn.click();
                return { found: true, text: candidate.text, count: candidates.length };
              }
              return { found: false, count: candidates.length };
            });

            if (searchResult.found) {
              tips.push(`已开启联网搜索 (找到 ${searchResult.count} 个候选元素)`);
              await page.waitForTimeout(1000);
            } else {
              tips.push(`⚠ 未找到联网搜索开关 (搜索到 ${searchResult.count} 个候选元素)`);
            }
          } catch (err) {
            tips.push(`⚠ 开启联网搜索失败: ${err instanceof Error ? err.message : '未知错误'}`);
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

        const inputLocator = page.locator('.ql-editor, #searchbar-editor, [contenteditable="true"]').first();
        if (await inputLocator.count() === 0) throw new Error('找不到消息输入框');
        await inputLocator.click();
        await page.waitForTimeout(200);
        await page.keyboard.type(params.message, { delay: 30 });

        await page.waitForTimeout(500);

        const sent = await page.evaluate(() => {
          const sendLink = document.querySelector('a[class*="send-btn"], a[class*="sendBtn"]');
          if (sendLink) { (sendLink as HTMLElement).click(); return true; }

          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            const label = btn.getAttribute('aria-label') || '';
            const cls = btn.className?.toString?.()?.toLowerCase() || '';
            if (label.includes('发送') || label.includes('send') || cls.includes('send') || cls.includes('submit')) {
              (btn as HTMLElement).click();
              return true;
            }
          }

          const editor = document.querySelector('.ql-editor, #searchbar-editor');
          if (editor) {
            const rect = editor.getBoundingClientRect();
            const candidates = document.querySelectorAll('a, button, [role="button"]');
            for (const el of candidates) {
              const elRect = el.getBoundingClientRect();
              if (elRect.left > rect.right - 100 && Math.abs(elRect.top - rect.bottom) < 100 && elRect.width > 15) {
                (el as HTMLElement).click();
                return true;
              }
            }
          }
          return false;
        });

        if (!sent) {
          await page.keyboard.press('Enter');
          tips.push('通过 Enter 发送');
        }

        tips.push('消息已发送，等待 AI 回复...');
        await page.waitForTimeout(2000);

        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(1500);
          try {
            responseText = await page.evaluate((msg: string) => {
              const pageTxt = document.body.textContent || '';
              if (pageTxt.includes('生成中') || pageTxt.includes('思考中') || pageTxt.includes('正在')) return '';

              const strategies = [
                () => {
                  const mdEls = document.querySelectorAll('[class*="markdown"]');
                  if (mdEls.length > 0) {
                    const last = mdEls[mdEls.length - 1];
                    const txt = (last.textContent || '').trim();
                    if (txt.length > 30 && !txt.includes(msg)) return txt.slice(0, 1000);
                  }
                  return '';
                },
                () => {
                  const msgEls = document.querySelectorAll('[class*="message"]');
                  if (msgEls.length > 0) {
                    const last = msgEls[msgEls.length - 1];
                    const txt = (last.textContent || '').trim();
                    if (txt.length > 30 && !txt.includes(msg)) return txt.slice(0, 1000);
                  }
                  return '';
                },
                () => {
                  const containers = document.querySelectorAll('[class*="assistant"], [class*="bot"], [class*="ai-"]');
                  if (containers.length > 0) {
                    const last = containers[containers.length - 1];
                    const txt = (last.textContent || '').trim();
                    if (txt.length > 30) return txt.slice(0, 1000);
                  }
                  return '';
                },
              ];

              for (const fn of strategies) {
                const result = fn();
                if (result) return result;
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
          return ok({
              response: responseText,
              duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
            }, tips);
        } else {
          tips.push('AI 回复超时或未检测到');
          return ok({ response: '' }, tips);
        }
      } catch (error) {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  site.command('attach', {
    description: '上传附件到当前对话',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      file: z.string().describe('附件文件路径'),
    }),
    result: z.object({ file: z.string(), uploaded: z.boolean() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao attach /path/to/file.pdf', description: '上传文件' },
      { cmd: 'xbrowser yuanbao attach /path/to/image.png', description: '上传图片' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        const tips = buildTips(ctx);

        const absPath = path.resolve(params.file);
        if (!fs.existsSync(absPath)) throw new Error(`文件不存在: ${absPath}`);

        let uploaded = await uploadFileViaDataTransfer(page, absPath);

        if (!uploaded) {
          const uploadBtnSelectors = [
            '[class*="upload"]', '[class*="attach"]', '[class*="clip"]',
            'button[class*="image"]', '[class*="file-upload"]',
          ];
          for (const sel of uploadBtnSelectors) {
            if (await safeClickSelector(page, sel)) {
              await page.waitForTimeout(500);
              uploaded = await uploadFileViaDataTransfer(page, absPath);
              if (uploaded) break;
            }
          }
        }

        if (!uploaded) throw new Error('上传失败：找不到文件上传入口');

        await page.waitForTimeout(1000);
        tips.push(`已上传: ${path.basename(absPath)}`);
        return ok({ file: absPath, uploaded: true }, tips);
      } catch (error) {
        return fail('未知错误', ['上传附件失败']);
      }
    },
  });
}
