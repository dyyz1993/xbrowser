import type { XCLIAPI, CommandContext, ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

type Page = import('playwright-core').Page;

const SITE_URL = 'https://www.qianwen.com';

const SEL = {
  input: 'div[role="textbox"][contenteditable="true"]',
  newChat: 'button',
  sendButton: 'button[aria-label="发送消息"]',
  conversationLinks: 'a[href*="/chat/"], [class*="conversation"] a, [class*="session"] a',
  replyContainer: '[class*="markdown"]',
  fileInput: 'input[type="file"]',
} as const;

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
  const url = page.url();
  if (!url.includes('qianwen.com') && !url.includes('tongyi.aliyun.com')) {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const hasInput = await page.evaluate(() => {
        const input = document.querySelector('div[role="textbox"][contenteditable="true"]');
        return !!input;
      });
      if (!hasInput) {
        const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
        if (bodyText.includes('登录') && !bodyText.includes('通义千问')) {
          const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
          throw new Error(
            '通义千问 (Qianwen) 未登录！\n' +
            (cdp
              ? '  使用 --cdp 连接的浏览器未登录通义千问，请先在浏览器中登录。\n  或运行: xbrowser qianwen login'
              : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser qianwen list --cdp http://localhost:9221')
          );
        }
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

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'qianwen',
    url: SITE_URL,
    description: '通义千问 (Qianwen) — 会话管理、消息发送、附件上传',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        const url = page.url();
        if (url.includes('/login') || url.includes('/auth') || url.includes('/passport')) return false;
        const input = await page.evaluate(() => {
          return !!document.querySelector('div[role="textbox"][contenteditable="true"]');
        });
        return input;
      } catch {
        return false;
      }
    },
  });

  site.command('list', {
    description: '列出所有历史会话',
    scope: 'page',
    parameters: z.object({}),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser qianwen list', description: '列出所有会话' },
      { cmd: 'xbrowser qianwen list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/chat/"], [class*="conversation"] a, [class*="session"] a');
          return Array.from(links).map((a, i) => ({
            index: i,
            title: (a.textContent || '').trim(),
            url: (a as HTMLAnchorElement).href,
          })).filter(c => c.title.length > 0);
        });

        const tips = buildTips(ctx);
        tips.push(`共 ${conversations.length} 个会话`);
    return ok(conversations, []);
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['获取会话列表失败']);
      }
    },
  });

  site.command('new', {
    description: '创建新的空白对话',
    scope: 'browser',
    parameters: z.object({}),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser qianwen new', description: '新建对话' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);

        const result = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('新建对话')) {
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
          if (fallback === 'failed') throw new Error('找不到"新建对话"按钮');
        }

        await page.waitForTimeout(1500);
    return ok({ created: true }, []);
          tips: buildTips(ctx),
          message: '✅ 已创建新对话',
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['创建新对话失败']);
      }
    },
  });

  site.command('open', {
    description: '通过标题打开指定会话（模糊匹配）',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('会话标题（支持模糊匹配）'),
    }),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser qianwen open "工作计划"', description: '打开指定会话' },
      { cmd: 'xbrowser qianwen open "代码"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);

        const clicked = await page.evaluate((title: string) => {
          const links = document.querySelectorAll('a[href*="/chat/"], [class*="conversation"] a, [class*="session"] a');
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
    return ok({ opened: clicked.title }, []);
          tips: buildTips(ctx),
          message: `✅ 已打开会话：${clicked.title}`,
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['打开会话失败']);
      }
    },
  });

  site.command('chat', {
    description: '发送消息并等待 AI 回复',
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      attach: z.string().optional().describe('附件路径（图片或文件）'),
      attachType: z.enum(['image', 'file', 'url']).optional().describe('附件类型'),
      think: z.boolean().optional().describe('开启深度思考模式'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser qianwen chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser qianwen chat "分析这张图" --attach /path/to/img.jpg', description: '发送消息+图片' },
      { cmd: 'xbrowser qianwen chat "深度分析" --think', description: '开启深度思考' },
      { cmd: 'xbrowser qianwen chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000);
        const tips = buildTips(ctx);

        if (params.think) {
          const thinkToggled = await page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text === '深度思考' || text === '思考' || text.includes('Think'))
                  && el.children.length <= 3 && el.offsetParent !== null) {
                const btn = el.closest('button, [role="switch"]') || el.parentElement;
                if (btn instanceof HTMLElement) {
                  btn.click();
                  return 'toggled';
                }
              }
            }
            return 'not_found';
          });
          if (thinkToggled !== 'not_found') {
            tips.push('已开启深度思考');
            await page.waitForTimeout(500);
          } else {
            tips.push('⚠ 未找到深度思考开关');
          }
        }

        if (params.search) {
          const searchEnabled = await page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text === '联网搜索' || text === '搜索' || text.includes('Search'))
                  && el.children.length <= 3 && el.offsetParent !== null) {
                const btn = el.closest('button, [role="switch"]') || el.parentElement;
                if (btn instanceof HTMLElement) {
                  btn.click();
                  return 'toggled';
                }
              }
            }
            return 'not_found';
          });
          if (searchEnabled !== 'not_found') {
            tips.push('已开启联网搜索');
            await page.waitForTimeout(500);
          } else {
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
              tips.push('⚠ 上传失败，未找到文件输入控件');
            }
          }
        }

        const inputLocator = page.locator('div[role="textbox"][contenteditable="true"]').first();
        if (await inputLocator.count() === 0) throw new Error('找不到消息输入框');
        await inputLocator.click();
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const el = document.querySelector('div[role="textbox"][contenteditable="true"]');
          if (el) { el.textContent = ''; }
        });
        await page.keyboard.type(params.message, { delay: 30 });

        await page.waitForTimeout(500);

        const sendClicked = await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement | null;
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });

        if (!sendClicked) {
          await page.keyboard.press('Enter');
        }

        tips.push('消息已发送，等待 AI 回复...');
        await page.waitForTimeout(2000);

        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(1500);
          try {
            responseText = await page.evaluate((msg: string) => {
              const pageText = document.body.textContent || '';

              if (pageText.includes('生成中') || pageText.includes('思考中') || pageText.includes('停止生成')) return '';

              const answerCards = document.querySelectorAll('div.answer-common-card');
              for (let i = answerCards.length - 1; i >= 0; i--) {
                const txt = (answerCards[i].textContent || '').trim();
                if (txt.length > 10) {
                  const lines = txt.split('\n').filter(l => !l.includes('思考已完成') && !l.includes('Qwen3-Max-Thinking') && l.trim().length > 0);
                  if (lines.length > 0) return lines.join('\n').slice(0, 2000);
                }
              }

              const chatAnswers = document.querySelectorAll('div.chat-answers-card-wrap');
              for (let i = chatAnswers.length - 1; i >= 0; i--) {
                const txt = (chatAnswers[i].textContent || '').trim();
                if (txt.length > msg.length + 20) {
                  const lines = txt.split('\n').filter(l => !l.includes('Qwen3') && !l.includes('思考已完成') && !l.includes('用户发送了一条') && l.trim().length > 5);
                  if (lines.length > 0) return lines.join('\n').slice(0, 2000);
                }
              }

              const markdownEls = document.querySelectorAll('[class*="markdown"]');
              for (let i = markdownEls.length - 1; i >= 0; i--) {
                const txt = (markdownEls[i].textContent || '').trim();
                const parentText = markdownEls[i].parentElement?.textContent || '';
                if (txt.length > 10 && !txt.includes(msg) && !parentText.includes('Qwen3-Max-Thinking')) {
                  const lines = txt.split('\n').filter(l => !l.includes('思考已完成') && l.trim().length > 0);
                  if (lines.length > 0) return lines.join('\n').slice(0, 2000);
                }
              }

              return '';
            }, params.message);
            if (responseText) break;
          } catch {
            // ignore
          }
        }

        if (responseText) {
          tips.push('AI 回复已收到');
    return ok({, []);
            },
            tips,
            message: `✅ AI 回复 (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
          };
        } else {
          tips.push('AI 回复超时或未检测到');
    return ok({ response: '' }, []);
            tips,
            message: '⏱ AI 回复超时（60s），请检查页面',
          };
        }
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['发送消息失败']);
      }
    },
  });

  site.command('attach', {
    description: '上传附件（图片或文件）',
    scope: 'browser',
    parameters: z.object({
      file: z.string().describe('文件路径'),
    }),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser qianwen attach /path/to/img.jpg', description: '上传图片' },
      { cmd: 'xbrowser qianwen attach /path/to/doc.pdf', description: '上传文件' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(500);
        const tips = buildTips(ctx);

        const absPath = path.resolve(params.file);
        if (!fs.existsSync(absPath)) {
          throw new Error(`文件不存在: ${absPath}`);
        }

        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        if (!uploaded) {
          throw new Error('找不到 file input，上传失败');
        }

        await page.waitForTimeout(1000);
        tips.push(`附件 "${path.basename(absPath)}" 已上传`);
    return ok({ file: absPath, []);
          tips,
          message: `✅ 附件 "${path.basename(absPath)}" 已上传`,
        };
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['上传附件失败']);
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录通义千问');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录通义千问:');
      console.log('   1. 打开 Viewer（实时查看浏览器画面）:');
      console.log(`      agent-browser viewer --session ${sessionId || 'default'}`);
      console.log('   2. 在 Viewer 页面中登录通义千问');
      console.log('   3. 登录后回到此终端，按 Enter 继续');
      console.log('');
      console.log('   也可以用截图模式查看当前页面状态:');
      console.log('      xbrowser screenshot --session ' + (sessionId || 'default'));
      console.log('');
    } else if (!cdp) {
      console.log('');
      console.log('⚠️  推荐使用 --cdp 参数连接到已登录的浏览器:');
      console.log('     xbrowser qianwen list --cdp http://localhost:9221');
      console.log('');
      console.log('🔑 或者启动 Viewer 手动登录:');
      console.log('   1. 启动浏览器会话:');
      console.log('      xbrowser session open ' + SITE_URL + ' --name qw-login');
      console.log('   2. 启动 Viewer:');
      console.log('      agent-browser viewer --session qw-login');
      console.log('   3. 在 Viewer 中登录后:');
      console.log('      xbrowser qianwen list --session qw-login');
      console.log('');
    }

    if (page) {
      await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
    console.log('✅ 继续执行');
  });

  site.logout(async (_ctx) => {
    console.log('⚠️  请在浏览器中手动退出通义千问登录');
  });
}
