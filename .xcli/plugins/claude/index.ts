import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

type Page = import('playwright-core').Page;

const CLAUDE_URL = 'https://claude.ai';

function getPage(ctx: CommandContext): Page {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接');
  return page;
}

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
  tips.push(`Session: ${(ctx as unknown as Record<string, unknown>).sessionId || 'default'}`);
  return tips;
}

async function ensurePage(page: Page, ctx?: CommandContext): Promise<void> {
  const url = page.url();
  if (!url.includes('claude.ai')) {
    await page.goto(CLAUDE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const loggedIn = await checkClaudeLogin(page);
      if (!loggedIn) {
        const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
        throw new Error(
          'Claude 未登录！\n' +
          (cdp
            ? '  使用 --cdp 连接的浏览器未登录 Claude，请先在浏览器中登录。\n  或运行: xbrowser claude login'
            : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser claude list --cdp http://localhost:9221')
        );
      }
    }
  }
}

async function checkClaudeLogin(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes('/login') || url.includes('/signup') || url.includes('/auth')) return false;
    const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
    if ((bodyText.includes('Log in') || bodyText.includes('Sign up')) && !bodyText.includes('Claude')) return false;
    if ((bodyText.includes('登录') || bodyText.includes('注册')) && !bodyText.includes('Claude')) return false;
    const hasInput = await page.evaluate(() => {
      return !!document.querySelector('[contenteditable="true"][data-placeholder], [contenteditable="true"].ProseMirror, [role="textbox"][contenteditable="true"], div[contenteditable="true"]');
    });
    if (hasInput) return true;
    const hasNewChat = await page.evaluate(() => {
      return !!document.querySelector('button:has-text("New chat"), button[aria-label*="New chat"], div:has-text("新对话")');
    });
    return hasNewChat;
  } catch {
    return false;
  }
}

const SEL = {
  input: 'div[contenteditable="true"][data-placeholder], div[contenteditable="true"].ProseMirror, div[role="textbox"][contenteditable="true"]',
  newChat: 'button:has-text("New chat"), button[aria-label*="New chat"], nav a:first-child',
  conversationLinks: 'a[href*="/chat/"], nav a[href*="/chat/"]',
  sendButton: 'button[aria-label="Send"]',
  fileInput: 'input[type="file"]',
  aiResponse: '[class*="message-content"], [class*="response-message"], div[data-testid="response"], [class*="markdown"]',
  stopButton: 'button[aria-label*="Stop"], button:has-text("Stop")',
} as const;

const HELP = {
  attach: `附件支持：
   --type image --path /path/to/img.jpg   上传图片
   --type url --url "https://..."         发送 URL 链接
   --type file --path /path/to/doc.pdf    上传文件`,
};

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'claude',
    url: CLAUDE_URL,
    description: 'Claude AI 助手 — 会话管理、消息发送、联网搜索、附件上传',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        if (!page) return false;
        return await checkClaudeLogin(page);
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
      { cmd: 'xbrowser claude list', description: '列出所有会话' },
      { cmd: 'xbrowser claude list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/chat/"], nav a[href*="/chat/"]');
          return Array.from(links).map((a, i) => ({
            index: i,
            title: (a.textContent || '').trim(),
            url: (a as HTMLAnchorElement).href,
          })).filter(c => c.title.length > 0);
        });

        const tips = buildTips(ctx);
        tips.push(`共 ${conversations.length} 个会话`);
        return {
          data: conversations,
          tips,
          message: `找到 ${conversations.length} 个会话`,
        };
      } catch (error) {
        return fail('未知错误', ['获取会话列表失败']);
      }
    },
  });

  site.command('new', {
    description: '创建新的空白对话',
    scope: 'browser',
    parameters: z.object({}),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser claude new', description: '新建对话' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);

        let result = await page.evaluate(() => {
          const btns = document.querySelectorAll('button:has-text("New chat"), button[aria-label*="New chat"]');
          if (btns.length > 0) {
            (btns[0] as HTMLElement).click();
            return 'clicked';
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('New chat') || node.textContent?.includes('新对话') || node.textContent?.includes('+ New')) {
              const parent = node.parentElement;
              if (parent) {
                parent.click();
                return 'clicked_text';
              }
            }
          }
          return 'not_found';
        });

        if (result === 'not_found') {
          const fallback = await page.evaluate(() => {
            const navFirst = document.querySelector('nav a:first-child');
            if (navFirst) {
              (navFirst as HTMLElement).click();
              return 'clicked_nav';
            }
            return 'failed';
          });
          if (fallback === 'failed') throw new Error('找不到"New chat"按钮');
        }

        await page.waitForTimeout(1500);
        return {
          data: { created: true },
          tips: buildTips(ctx),
          message: '✅ 已创建新对话',
        };
      } catch (error) {
        return fail('未知错误', ['创建新对话失败']);
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
      { cmd: 'xbrowser claude open "1加1等于2"', description: '打开指定会话' },
      { cmd: 'xbrowser claude open "股票"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);

        const clicked = await page.evaluate((title: string) => {
          const links = document.querySelectorAll('a[href*="/chat/"], nav a[href*="/chat/"]');
          for (const link of links) {
            const text = (link.textContent || '').trim();
            if (text.toLowerCase().includes(title.toLowerCase())) {
              (link as HTMLAnchorElement).click();
              return { found: true, title: text };
            }
          }
          return { found: false, title: '' };
        }, params.title);

        if (!clicked.found) throw new Error(`未找到包含"${params.title}"的会话`);

        await page.waitForTimeout(2000);
        return {
          data: { opened: clicked.title },
          tips: buildTips(ctx),
          message: `✅ 已打开会话：${clicked.title}`,
        };
      } catch (error) {
        return fail('未知错误', ['打开会话失败']);
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
      model: z.string().optional().describe('模型名称 (如 Sonnet, Opus, Haiku)'),
      think: z.boolean().optional().describe('开启扩展思考 (Extended Thinking)'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser claude chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser claude chat "分析这张图" --attach /path/to/img.jpg', description: '发送消息+图片' },
      { cmd: 'xbrowser claude chat "深度推理" --model Opus --think', description: 'Opus+扩展思考' },
      { cmd: 'xbrowser claude chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000);
        const tips = buildTips(ctx);

        // 切换模型
        if (params.model) {
          const modelSwitched = await page.evaluate((modelName) => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text.includes('Sonnet') || text.includes('Opus') || text.includes('Haiku') || text.includes('Claude'))
                  && el.children.length <= 3 && el.offsetParent !== null && text.length < 40) {
                (el as HTMLElement).click();
                return 'clicked_selector';
              }
            }
            return 'not_found';
          }, params.model);
          
          if (modelSwitched !== 'not_found') {
            await page.waitForTimeout(800);
            const selected = await page.evaluate((modelName) => {
              const allEls = document.querySelectorAll('*');
              for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if (text.toLowerCase().includes(modelName.toLowerCase()) && el.children.length <= 2 && el.offsetParent !== null) {
                  (el as HTMLElement).click();
                  return true;
                }
              }
              return false;
            }, params.model);
            if (selected) {
              tips.push(`已切换到模型: ${params.model}`);
              await page.waitForTimeout(500);
            } else {
              tips.push(`⚠ 找不到模型 "${params.model}"`);
              await page.keyboard.press('Escape');
            }
          }
        }

        // 开启扩展思考
        if (params.think) {
          const thinkToggled = await page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text.includes('Extended') || text.includes('扩展思考') || text.includes('thinking'))
                  && el.children.length <= 3 && el.offsetParent !== null) {
                const btn = el.closest('button, [role="switch"]') || el;
                if (btn instanceof HTMLElement) {
                  btn.click();
                  return 'toggled';
                }
              }
            }
            return 'not_found';
          });
          if (thinkToggled !== 'not_found') {
            tips.push('已开启扩展思考');
            await page.waitForTimeout(500);
          } else {
            tips.push('⚠ 未找到扩展思考开关');
          }
        }

        // 开启联网搜索
        if (params.search) {
          const searchEnabled = await page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text.includes('Search') || text.includes('搜索') || text.includes('Web'))
                  && el.children.length <= 3 && el.offsetParent !== null && text.length < 30) {
                const btn = el.closest('button, [role="switch"]') || el;
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
          const attachType = params.attachType || 'image';
          await handleAttachment(page, params.attach, attachType, tips);
        }

        const inputFound = await fillClaudeInput(page, params.message);
        if (!inputFound) throw new Error('找不到消息输入框');

        await page.waitForTimeout(500);

        await sendMessage(page);
        tips.push('消息已发送，等待 AI 回复...');

        await page.waitForTimeout(2000);
        const hasFile = !!(params as Record<string, unknown>).attach;
        const wantSources = !!(params as Record<string, unknown>).showSources;

        let capturedStream = '';
        if (wantSources) {
          await page.route('**/api/**', async (route) => {
            const resp = await route.fetch();
            const body = await resp.text();
            capturedStream += body;
            await route.fulfill({ body, headers: resp.headers(), status: resp.status() });
          }).catch(() => {});
        }

        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(1500);
          try {
            responseText = await page.evaluate((fileMode: boolean) => {
              const allText = document.body.textContent || '';
              const stopBtn = document.querySelector('button[aria-label*="Stop"], button:has-text("Stop")');
              if (stopBtn) return '';

              const messages = document.querySelectorAll('[class*="message-content"], [class*="response-message"], [class*="markdown"], article');
              for (let i = messages.length - 1; i >= 0; i--) {
                const el = messages[i];
                const txt = el.textContent?.trim() || '';
                if (txt.length > 30 && !el.closest('[class*="loading"], [class*="typing"], [class*="spinner"]')) {
                  return txt.slice(0, 3000);
                }
              }

              const textBlocks = document.querySelectorAll('article p, article li, article pre code, [class*="prose"] p, [class*="prose"] li');
              let combined = '';
              for (let i = textBlocks.length - 1; i >= Math.max(0, textBlocks.length - 20); i--) {
                combined += (textBlocks[i].textContent || '').trim() + '\n';
              }
              if (combined.trim().length > 50) return combined.trim().slice(0, 3000);

              if (fileMode) {
                if (allText.includes('error') || allText.includes('Error') || allText.includes('错误')) {
                  return '[系统提示] 检测到错误信息';
                }
                return '';
              }

              return '';
            }, hasFile);
            if (responseText) break;
          } catch {
          }
        }

        if (responseText) {
          tips.push('AI 回复已收到');
          const result: Record<string, unknown> = {
            response: responseText,
            duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
          };

          if (wantSources) {
            await new Promise(r => setTimeout(r, 3000));
            try {
              await page.unroute('**/api/**').catch(() => {});
              let allUrls: string[] = [];

              if (capturedStream) {
                const urlMatches = capturedStream.match(/https?:\/\/[^"'\s,<>\\\]\)]+/g) || [];
                for (const u of urlMatches) {
                  const clean = u.replace(/\\u002F/g, '/').split(/[)\]"'.,;:!?]+$/)[0];
                  try {
                    new URL(clean);
                    allUrls.push(clean);
                  } catch {}
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
                try { domains.add(new URL(u).hostname.replace(/^www\./, '')); } catch {}
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
            } catch (e) {
              tips.push('无法提取搜索来源: ' + ((e as Error).message || ''));
            }
          }

          return {
            data: result,
            tips,
            message: `✅ AI 回复 (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
          };
        } else {
          tips.push('AI 回复超时或未检测到');
          return {
            data: { response: '' },
            tips,
            message: '⏱ AI 回复超时（120s），请检查页面',
          };
        }
      } catch (error) {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  site.command('attach', {
    description: '发送附件（图片/文件/URL）',
    scope: 'browser',
    parameters: z.object({
      type: z.enum(['image', 'file', 'url']).describe('附件类型'),
      path: z.string().describe('文件路径 或 URL 链接'),
    }),
    result: z.any(),
    examples: [
      { cmd: 'xbrowser claude attach image ~/photo.jpg', description: '上传图片' },
      { cmd: 'xbrowser claude attach url "https://example.com"', description: '发送 URL 链接' },
      { cmd: 'xbrowser claude attach file ~/doc.pdf', description: '上传文件' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(500);
        const tips = buildTips(ctx);

        if (params.type === 'url') {
          await fillClaudeInput(page, params.path);
          await page.waitForTimeout(300);
          await sendMessage(page);
          tips.push(`URL "${params.path}" 已作为消息发送`);
          return {
            data: { type: 'url', sent: true },
            tips,
            message: '✅ URL 已发送',
          };
        }

        const absPath = path.resolve(params.path);
        if (!fs.existsSync(absPath)) {
          throw new Error(`文件不存在: ${absPath}`);
        }
        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        if (!uploaded) {
          throw new Error('找不到 file input。请检查 Claude 是否支持该类型的文件上传。');
        }
        await page.waitForTimeout(1000);
        tips.push(`附件 "${path.basename(absPath)}" 已上传`);
        return {
          data: { type: params.type, file: absPath, uploaded: true },
          tips,
          message: `✅ 附件 "${path.basename(absPath)}" 已上传`,
        };
      } catch (error) {
        return fail('未知错误', ['上传附件失败']);
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(CLAUDE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录 Claude');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录 Claude:');
      console.log('   1. 打开 Viewer（实时查看浏览器画面）:');
      console.log(`      agent-browser viewer --session ${sessionId || 'default'}`);
      console.log('   2. 在 Viewer 页面中登录 Claude');
      console.log('   3. 登录后回到此终端，按 Enter 继续');
      console.log('');
      console.log('   也可以用截图模式查看当前页面状态:');
      console.log('      xbrowser screenshot --session ' + (sessionId || 'default'));
      console.log('');
    } else if (!cdp) {
      console.log('');
      console.log('⚠️  推荐使用 --cdp 参数连接到已登录的浏览器:');
      console.log('     xbrowser claude list --cdp http://localhost:9221');
      console.log('');
      console.log('🔑 或者启动 Viewer 手动登录:');
      console.log('   1. 启动浏览器会话:');
      console.log('      xbrowser session open ' + CLAUDE_URL + ' --name claude-login');
      console.log('   2. 启动 Viewer:');
      console.log('      agent-browser viewer --session claude-login');
      console.log('   3. 在 Viewer 中登录后:');
      console.log('      xbrowser claude list --session claude-login');
      console.log('');
    }

    if (page) {
      await page.goto(CLAUDE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
    console.log('✅ 继续执行');
  });

  site.logout(async (_ctx) => {
    console.log('⚠️  请在浏览器中手动退出 Claude 登录');
  });
}

async function fillClaudeInput(page: Page, message: string): Promise<boolean> {
  const selectors = [
    SEL.input,
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][data-placeholder]',
    '[contenteditable="true"]',
  ];
  for (const sel of selectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const el = page.locator(sel).first();
        await el.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await el.click();
        await page.evaluate(({ selector, text }) => {
          const input = document.querySelector(selector) as HTMLElement | null;
          if (!input) return false;
          input.focus();
          document.execCommand('insertText', false, text);
          return input.textContent === text;
        }, { selector: sel.split(',')[0].trim(), text: message });
        const currentText = await el.textContent();
        if (currentText && currentText.trim().length > 0) return true;
        await el.fill('');
        await el.type(message, { delay: 10 });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function sendMessage(page: Page): Promise<void> {
  const sendSelectors = [SEL.sendButton, 'button[aria-label="Send"]'];
  for (const sel of sendSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible()) {
        await btn.click();
        return;
      }
    } catch {
      continue;
    }
  }
  await page.keyboard.press('Enter');
}

async function handleAttachment(
  page: Page,
  filePath: string,
  attachType: string,
  tips: string[]
): Promise<void> {
  if (attachType === 'url') {
    tips.push(`URL 将通过消息发送: ${filePath}`);
    return;
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    tips.push(`⚠ 附件文件不存在: ${filePath}，跳过附件`);
    return;
  }

  await page.waitForTimeout(500);
  const success = await uploadFileViaDataTransfer(page, absPath);
  if (success) {
    tips.push(`已上传附件: ${path.basename(absPath)}`);
    await page.waitForTimeout(1000);
  } else {
    tips.push('⚠ 上传失败，找不到 file input');
  }
}

async function uploadFileViaDataTransfer(page: Page, absPath: string): Promise<boolean> {
  const data = fs.readFileSync(absPath);
  const b64 = data.toString('base64');
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html',
    '.ts': 'text/typescript', '.tsx': 'text/typescript', '.js': 'text/javascript',
    '.py': 'text/x-python', '.yaml': 'text/yaml', '.yml': 'text/yaml',
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
