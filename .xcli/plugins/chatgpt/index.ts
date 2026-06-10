import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import path from 'path';
import fs from 'fs';

type Page = import('../types').Page;

const CG_URL = 'https://chatgpt.com';

function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
  tips.push(`Session: ${(ctx as unknown as Record<string, unknown>).sessionId || 'default'}`);
  return tips;
}

async function ensurePage(page: Page, ctx?: CommandContext): Promise<void> {
  const url = page.url();
  if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) {
    await page.goto(CG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  try {
    await page.waitForSelector('#prompt-textarea', { state: 'attached', timeout: 15000 });
  } catch {
    await page.waitForTimeout(3000);
  }
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const loggedIn = await checkChatGPTLogin(page);
      if (!loggedIn) {
        const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
        throw new Error(
          'ChatGPT 未登录！\n' +
          (cdp
            ? '  使用 --cdp 连接的浏览器未登录 ChatGPT，请先在浏览器中登录。\n  或运行: xbrowser chatgpt login'
            : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser chatgpt list --cdp http://localhost:9221')
        );
      }
    }
  }
}

async function checkChatGPTLogin(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url === 'about:blank' || url === '') return true;
    if (!url.includes('chatgpt.com')) return true;
    if (url.includes('/auth') || url.includes('/login') || url.includes('/signup')) return false;
    const hasProfileBtn = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="accounts-profile-button"]');
    });
    if (hasProfileBtn) return true;
    const hasInput = await page.evaluate(() => {
      return !!document.querySelector('#prompt-textarea, [data-testid="chat-input"]');
    }) as boolean;
    if (hasInput) return true;
    const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '') as string;
    if ((bodyText.includes('Log in') || bodyText.includes('登录')) && !bodyText.includes('ChatGPT')) return false;
    return false;
  } catch {
    return false;
  }
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'chatgpt',
    url: CG_URL,
    description: 'ChatGPT AI 助手 — 会话管理、消息发送、附件上传、联网搜索',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        // No page or blank page — assume logged in, handler will navigate
        if (!page) return true;
        return await checkChatGPTLogin(page);
      } catch {
        return true;
      }
    },
  });

  site.command('list', {
    description: '列出所有历史会话',
    requiresLogin: true,
    scope: 'page',
    parameters: z.object({}),
    result: z.array(z.object({ index: z.number(), title: z.string(), url: z.string() }).passthrough()),
    examples: [
      { cmd: 'xbrowser chatgpt list', description: '列出所有会话' },
      { cmd: 'xbrowser chatgpt list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll('nav a[href*="/c/"], aside a[href*="/c/"]');
          return Array.from(links).map((a, i) => ({
            index: i,
            title: (a.textContent || '').trim(),
            url: (a as HTMLAnchorElement).href,
          })).filter(c => c.title.length > 0);
        }) as Array<{ index: number; title: string; url: string }>;

        const tips = buildTips(ctx);
        tips.push(`共 ${conversations.length} 个会话`);
        return ok(conversations, tips);
      } catch {
        return fail('未知错误', ['获取会话列表失败']);
      }
    },
  });

  site.command('new', {
    description: '创建新的空白对话',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ created: z.boolean() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt new', description: '新建对话' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);

        let result = await page.evaluate(() => {
          const btns = document.querySelectorAll('button[aria-label="New chat"], [data-testid="create-new-chat-button"]');
          if (btns.length > 0) {
            (btns[0] as HTMLElement).click();
            return 'clicked';
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('New chat') || node.textContent?.includes('新对话')) {
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
        const tips = buildTips(ctx);
        tips.push('已创建新对话');
        return ok({ created: true }, tips);
      } catch {
        return fail('未知错误', ['创建新对话失败']);
      }
    },
  });

  site.command('open', {
    description: '通过标题打开指定会话（模糊匹配）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('会话标题（支持模糊匹配）'),
    }),
    result: z.object({ opened: z.string() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt open "1加1等于2"', description: '打开指定会话' },
      { cmd: 'xbrowser chatgpt open "股票"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);

        const clicked = await page.evaluate((title: string) => {
          const links = document.querySelectorAll('nav a[href*="/c/"], aside a[href*="/c/"]');
          for (const link of links) {
            const text = (link.textContent || '').trim();
            if (text.toLowerCase().includes(title.toLowerCase())) {
              (link as HTMLAnchorElement).click();
              return { found: true, title: text };
            }
          }
          return { found: false, title: '' };
        }, params.title) as { found: boolean; title: string };

        if (!clicked.found) throw new Error(`未找到包含"${params.title}"的会话`);

        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);
        tips.push(`已打开会话：${clicked.title}`);
        return ok({ opened: clicked.title }, tips);
      } catch {
        return fail('未知错误', ['打开会话失败']);
      }
    },
  });

  site.command('chat', {
    description: '发送消息并等待 AI 回复',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      attach: z.string().optional().describe('附件路径（图片或文件）'),
      attachType: z.enum(['image', 'file', 'url']).optional().describe('附件类型'),
      model: z.string().optional().describe('模型名称 (如 GPT-4o, o1, o3, 4o-mini)'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    result: z.object({ response: z.string(), duration: z.string().optional(), conversationId: z.string().optional(), sources: z.record(z.string(), z.any()).optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser chatgpt chat "分析这张图" --attach /path/to/img.jpg', description: '发送消息+图片' },
      { cmd: 'xbrowser chatgpt chat "推理分析" --model o1', description: '使用 o1 推理模型' },
      { cmd: 'xbrowser chatgpt chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000);
        const tips = buildTips(ctx);

        // 切换模型
        if (params.model) {
          const modelSwitched = await page.evaluate((_modelName) => {
            const modelBtns = document.querySelectorAll('[class*="model"], [class*="Model"], [data-testid*="model"]');
            for (const btn of modelBtns) {
              if (btn.textContent?.trim() && (btn as HTMLElement).offsetParent !== null) {
                (btn as HTMLElement).click();
                return 'clicked_selector';
              }
            }
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text.includes('GPT') || text.includes('4o') || text.includes('o1') || text.includes('o3') || text.includes('mini')) 
                  && el.children.length <= 3 && (el as HTMLElement).offsetParent !== null && text.length < 30) {
                (el as HTMLElement).click();
                return 'clicked_label';
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
                if (text.toLowerCase().includes(modelName.toLowerCase()) && el.children.length <= 2 && (el as HTMLElement).offsetParent !== null) {
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
              tips.push(`⚠ 找不到模型 "${params.model}"，请手动切换`);
              await page.keyboard.press('Escape');
            }
          } else {
            tips.push(`⚠ 未找到模型选择器`);
          }
        }

        // 开启联网搜索
        if (params.search) {
          const searchEnabled = await page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text === 'Search' || text === '搜索' || text.includes('联网')) && el.children.length <= 3 && (el as HTMLElement).offsetParent !== null) {
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

        const inputFound = await fillInput(page, params.message);
        if (!inputFound) throw new Error('找不到消息输入框');

        await page.waitForTimeout(500);

        await sendMessage(page);
        tips.push('消息已发送，等待 AI 回复...');

        let conversationUrl = '';
        try {
          await page.waitForFunction(() => location.href.includes('/c/'), { timeout: 15000 });
          conversationUrl = page.url();
        } catch {
          conversationUrl = page.url();
        }

        await page.waitForTimeout(2000);
        const hasFile = !!(params as Record<string, unknown>).attach;
        const wantSources = !!(params as Record<string, unknown>).showSources;

        let capturedStream = '';
        if (wantSources) {
          await page.route('**/backend-api/conversation', async (route) => {
            const resp = await (route as unknown as import('../types.js').PluginRoute).fetch();
            const body = await resp.text();
            capturedStream += body;
            await route.fulfill({ body, headers: resp.headers(), status: resp.status() });
          }).catch(() => {});
        }

        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(2000);
          try {
            const stopBtnExists = await page.evaluate(() => {
              return !!document.querySelector('[data-testid="stop-button"]');
            });
            if (stopBtnExists) continue;

            responseText = await page.evaluate(({ fileMode: fm }) => {
              const allText = document.body.textContent || '';
              if (fm && allText.includes('Processing')) return '';

              const turns = document.querySelectorAll('section[data-testid^="conversation-turn-"]');
              if (turns.length >= 2) {
                const lastTurn = turns[turns.length - 1];
                const md = lastTurn.querySelector('.markdown');
                if (md) {
                  const txt = md.textContent?.trim() || '';
                  if (txt.length > 0) return txt.slice(0, 3000);
                }
                const clone = lastTurn.cloneNode(true) as HTMLElement;
                clone.querySelectorAll('button, [class*="sr-only"], .sr-only, [data-testid="copy-turn-action-button"]').forEach(h => h.remove());
                let txt = clone.textContent?.trim() || '';
                txt = txt.replace(/^ChatGPT\s*(said:|：)\s*/, '');
                const noisePatterns = [
                  'Is this conversation helpful so far?',
                  '这次对话有帮助吗？',
                  'Was this response better',
                  '这个回答更好吗',
                  'Good response', 'Bad response',
                ];
                for (const noise of noisePatterns) {
                  const idx = txt.indexOf(noise);
                  if (idx > 0) txt = txt.slice(0, idx).trim();
                }
                if (txt.length > 0) return txt.slice(0, 3000);
              }

              const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
              for (let i = messages.length - 1; i >= 0; i--) {
                const txt = messages[i].textContent?.trim() || '';
                if (txt.length > 0) return txt.slice(0, 3000);
              }

              if (fm) {
                if (allText.includes('error') || allText.includes('Error') || allText.includes('错误')) {
                  return '[系统提示] 检测到错误信息';
                }
              }

              return '';
            }, { fileMode: hasFile });
            if (responseText) break;

            if (conversationUrl.includes('/c/')) {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(3000);
            }
          } catch {
            // page reload failure is non-critical, continue polling
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
              await page.unroute('**/backend-api/conversation').catch(() => {});
              let allUrls: string[] = [];

              if (capturedStream) {
                const urlMatches = capturedStream.match(/https?:\/\/[^"'\s,<>\\\]\)]+/g) || [];
                for (const u of urlMatches) {
                  const clean = u.replace(/\\u002F/g, '/').split(/[)\]"'.,;:!?]+$/)[0];
                  try {
                    new URL(clean);
                    allUrls.push(clean);
                  } catch { /* invalid URL, skip */ }
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
                }) as string[];
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
                try { domains.add(new URL(u).hostname.replace(/^www\./, '')); } catch { /* invalid URL, skip */ }
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

          return ok(result, tips);
        } else {
          tips.push('AI 回复超时或未检测到');
          return ok({ response: '' }, tips);
        }
      } catch {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  site.command('attach', {
    description: '发送附件（图片/文件/URL）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      type: z.enum(['image', 'file', 'url']).describe('附件类型'),
      path: z.string().describe('文件路径 或 URL 链接'),
    }),
    result: z.object({ type: z.string().optional(), sent: z.boolean().optional(), file: z.string().optional(), uploaded: z.boolean().optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt attach image ~/photo.jpg', description: '上传图片' },
      { cmd: 'xbrowser chatgpt attach url "https://example.com"', description: '发送 URL 链接' },
      { cmd: 'xbrowser chatgpt attach file ~/doc.pdf', description: '上传文件' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);
        await page.waitForTimeout(500);
        const tips = buildTips(ctx);

        if (params.type === 'url') {
          await fillInput(page, params.path);
          await page.waitForTimeout(300);
          await sendMessage(page);
          tips.push(`URL "${params.path}" 已作为消息发送`);
          return ok({ type: 'url', sent: true }, tips);
        }

        const absPath = path.resolve(params.path);
        if (!fs.existsSync(absPath)) {
          throw new Error(`文件不存在: ${absPath}`);
        }
        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        if (!uploaded) {
          throw new Error('找不到 file input。请检查 ChatGPT 是否支持该类型的文件上传。');
        }
        await page.waitForTimeout(1000);
        tips.push(`附件 "${path.basename(absPath)}" 已上传`);
        return ok({ type: params.type, file: absPath, uploaded: true }, tips);
      } catch {
        return fail('未知错误', ['上传附件失败']);
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(CG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录 ChatGPT');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录 ChatGPT:');
      console.log('   1. 打开 Viewer（实时查看浏览器画面）:');
      console.log(`      agent-browser viewer --session ${sessionId || 'default'}`);
      console.log('   2. 在 Viewer 页面中登录 ChatGPT');
      console.log('   3. 登录后回到此终端，按 Enter 继续');
      console.log('');
      console.log('   也可以用截图模式查看当前页面状态:');
      console.log('      xbrowser screenshot --session ' + (sessionId || 'default'));
      console.log('');
    } else if (!cdp) {
      console.log('');
      console.log('⚠️  推荐使用 --cdp 参数连接到已登录的浏览器:');
      console.log('     xbrowser chatgpt list --cdp http://localhost:9221');
      console.log('');
      console.log('🔑 或者启动 Viewer 手动登录:');
      console.log('   1. 启动浏览器会话:');
      console.log('      xbrowser session open ' + CG_URL + ' --name cg-login');
      console.log('   2. 启动 Viewer:');
      console.log('      agent-browser viewer --session cg-login');
      console.log('   3. 在 Viewer 中登录后:');
      console.log('      xbrowser chatgpt list --session cg-login');
      console.log('');
    }

    if (page) {
      await page.goto(CG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
    console.log('✅ 继续执行');
  });

  site.logout(async (_ctx) => {
    console.log('⚠️  请在浏览器中手动退出 ChatGPT 登录');
  });
}

async function fillInput(page: Page, message: string): Promise<boolean> {
  const selectors = [
    '#prompt-textarea',
    '[data-testid="chat-input"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="message"]',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) {
        await loc.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await loc.click();
        await page.waitForTimeout(200);
        await loc.fill(message);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function sendMessage(page: Page): Promise<void> {
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
