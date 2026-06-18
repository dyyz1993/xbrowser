import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { checkRefusal } from "../shared/refusal-detect.js";
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import { buildTips, batchUploadFiles, handleChatAttachments, checkLoginStatus } from '../shared/ai-chat-base.js';
import { fastInput } from '../shared/fast-input.js';

type Page = import('../types').Page;

const CG_URL = 'https://chatgpt.com';

async function ensurePage(page: Page, ctx?: CommandContext): Promise<void> {
  const url = page.url() || '';
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

  // ═══════════════════════════════════════════════════
  //  0. check-login — 检查是否已登录
  // ═══════════════════════════════════════════════════
  site.command('check-login', {
    description: '检查 ChatGPT 登录状态',
    parameters: z.object({}),
    requiresLogin: false,
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail({ message: '需要浏览器页面' });
      const result = await checkLoginStatus(page, CG_URL, {
        loginUrlPatterns: ['/login', '/auth'],
        loggedInSelectors: ['#prompt-textarea'],
      });
      const tips = buildTips(ctx);
      if (result.loggedIn) {
        return ok({ data: { loggedIn: true, url: result.url, detail: result.detail }, tips });
      }
      return ok({ data: { loggedIn: false, url: result.url, detail: result.detail }, tips });
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
      path: z.string().optional().describe('单附件路径（图片/文件/URL）'),
      paths: z.string().optional().describe('多附件路径（CSV，与 --type 匹配）'),
      type: z.enum(['image', 'file', 'url']).optional().describe('附件类型（默认 image，url 模式把 path 当 URL 推入消息）'),
      model: z.string().optional().describe('模型名称 (如 GPT-4o, o1, o3, 4o-mini)'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    result: z.object({ response: z.string(), duration: z.string().optional(), conversationId: z.string().optional(), sources: z.record(z.string(), z.any()).optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser chatgpt chat "分析这张图" --path /path/to/img.jpg', description: '发送消息+单张图片' },
      { cmd: 'xbrowser chatgpt chat "对比这3张" --paths "/a.jpg,/b.png,/c.jpg"', description: '发送消息+多张图片' },
      { cmd: 'xbrowser chatgpt chat "看这个" --type url --path https://example.com', description: '发送消息+URL 链接' },
      { cmd: 'xbrowser chatgpt chat "推理分析" --model o1', description: '使用 o1 推理模型' },
      { cmd: 'xbrowser chatgpt chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000);
        const urlAfter = page.url();
        if (!urlAfter.includes('chatgpt.com')) {
          throw new Error(`ensurePage 后 page 不在 chatgpt.com (url=${urlAfter})`);
        }
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

        if (params.path || params.paths) {
          const r = await handleChatAttachments(page, params.path, params.paths, params.type || 'image', tips);
          // 强约束：上传校验未通过则中止（避免发空消息 + 误导用户）
          if (!r.ok) {
            return fail(`附件上传未通过校验 (${r.uploaded}/${r.total})`, tips);
          }
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
      } catch (e) {
        const msg = (e as Error).message || String(e);
        return fail('未知错误', ['发送消息失败', `原因: ${msg}`]);
      }
    },
  });

  site.command('attach', {
    description: '发送附件（图片/文件/URL）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      type: z.enum(['image', 'file', 'url']).describe('附件类型'),
      path: z.string().optional().describe('单文件路径 或 URL 链接'),
      paths: z.string().optional().describe('多文件路径（CSV，如 a.jpg,b.pdf）— 仅 image/file 类型有效'),
    }).refine((d) => {
      if (d.type === 'url') return Boolean(d.path) && !d.paths;
      return Boolean(d.path) || Boolean(d.paths);
    }, {
      message: 'url 类型只能用 --path（单条）；image/file 用 --path 或 --paths',
    }),
    result: z.object({ type: z.string().optional(), sent: z.boolean().optional(), file: z.string().optional(), uploaded: z.boolean().optional(), files: z.array(z.string()).optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt attach --type image --path ~/photo.jpg', description: '上传单张图片' },
      { cmd: 'xbrowser chatgpt attach --type url "https://example.com"', description: '发送 URL 链接' },
      { cmd: 'xbrowser chatgpt attach --type file --paths "~/a.pdf,~/b.docx"', description: '批量上传多文件' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      await ensurePage(page, ctx);
      await page.waitForTimeout(500);
      const tips = buildTips(ctx);

      if (params.type === 'url') {
        await fillInput(page, params.path!);
        await page.waitForTimeout(300);
        await sendMessage(page);
        tips.push(`URL "${params.path}" 已作为消息发送`);
        return ok({ type: 'url', sent: true }, tips);
      }

      // image/file：支持单 + 多
      const list = [
        ...(params.path ? [params.path] : []),
        ...(params.paths ? params.paths.split(',').map((s) => s.trim()).filter(Boolean) : []),
      ];
      if (list.length === 0) return fail('参数错误', ['--path 或 --paths 至少二选一']);

      const r = await batchUploadFiles(page, list);
      if (r.errors.length > 0) tips.push(...r.errors.map((e) => `⚠ ${e}`));
      if (r.uploaded === 0) {
        return fail('上传失败', ['找不到 file input，请检查 ChatGPT 是否支持该类型']);
      }
      await page.waitForTimeout(1000);
      tips.push(`✓ 已上传 ${r.uploaded}/${list.length} 个文件`);
      return ok({ type: params.type, files: r.files, uploaded: r.uploaded === list.length }, tips);
    },
  });

  // ── image — 文生图（DALL-E，录制确认流程 2026-06-17）──
  // ChatGPT 文生图入口：#composer-plus-btn → "创建图片" → 输入提示词 → 发送 → 等图片生成
  site.command('image', {
    description: '文生图（DALL-E 集成）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      prompt: z.string().describe('图片描述提示词'),
      session: z.string().optional().describe('会话 ID（复用已有会话 /c/{id}，保持风格延续，用于连续漫画/分镜）'),
      ratio: z.string().optional().describe('图片比例（自动/方形/宽屏，默认自动）'),
    }),
    result: z.object({ images: z.array(z.string()).optional(), status: z.string(), conversationUrl: z.string().optional(), conversationId: z.string().optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt image --prompt "画一只可爱的柴犬"', description: '文生图' },
      { cmd: 'xbrowser chatgpt image --prompt "第2镜" --session abc-123', description: '复用会话（连续漫画）' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx);
      try {
        // 0. 导航策略（关键：已在目标会话页就跳过，保持页面状态）
        //    录制确认：连续发图时页面不关，URL 保持 /c/{id} 不变。
        //    恢复会话优先用"点击侧边栏会话项"（chatgpt 内部路由，比 goto 可靠），
        //    goto 作为兜底。
        const curUrl = page.url();
        const targetSession = params.session || '';
        const alreadyOnTarget = targetSession
          ? curUrl.includes(`/c/${targetSession}`)
          : curUrl.includes('chatgpt.com');

        if (!alreadyOnTarget) {
          if (targetSession) {
            // 优先：点击侧边栏会话项（录制确认 li > a 是会话列表项结构）
            const clickedViaSidebar = await page.evaluate((sid: string) => {
              // 侧边栏会话链接：li > a[href*="/c/"]
              const links = document.querySelectorAll<HTMLAnchorElement>('nav a[href*="/c/"], aside a[href*="/c/"]');
              for (const link of links) {
                if (link.href.includes(`/c/${sid}`)) {
                  link.click();
                  return true;
                }
              }
              return false;
            }, targetSession).catch(() => false);

            if (clickedViaSidebar) {
              tips.push(`📌 点击侧边栏进入会话 ${targetSession}`);
              // 等输入框出现 = 页面加载完
              await page.waitForSelector('#prompt-textarea', { timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(2000);
            } else {
              // 兜底：goto（可能页面加载不全，但至少能到）
              tips.push(`📌 goto 会话 ${targetSession}（侧边栏未找到，用 goto）`);
              await page.goto(`https://chatgpt.com/c/${targetSession}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
              await page.waitForSelector('#prompt-textarea', { timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(2000);
            }
          } else {
            // 无 session：goto 首页
            tips.push('导航到 ChatGPT...');
            await page.goto(CG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(4000);
          }
        } else {
          tips.push('📌 已在目标会话页，跳过导航（保持页面状态）');
          await page.waitForTimeout(1000);
        }
        // 1. chatgpt 改版后不需要走"+"菜单→"创建图片"，直接输入"画..."就能生图
        //    #prompt-textarea 现在是 contenteditable DIV（不是 textarea）
        //    #composer-submit-button 只在输入有内容后才出现
        await page.locator('#prompt-textarea').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
        // contenteditable 用 keyboard.type（真键盘，React/ProseMirror 兼容）
        await page.keyboard.type(params.prompt, { delay: 15 });
        await page.waitForTimeout(400);
        // 校验写入
        const written = await page.evaluate((exp: string) => {
          const ed = document.querySelector('#prompt-textarea');
          return ed ? (ed.textContent || '').includes(exp.substring(0, Math.min(10, exp.length))) : false;
        }, params.prompt).catch(() => false);
        if (!written) {
          // 兜底：execCommand insertText（contenteditable 兼容）
          await fastInput(page, params.prompt, 'execCommand');
          await page.waitForTimeout(300);
        }
        // 2. 发送（输入后发送按钮才出现，用真鼠标点击）
        const sendCoord = await page.evaluate(() => {
          const b = document.querySelector('#composer-submit-button') as HTMLButtonElement;
          if (!b || b.disabled) return null;
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }).catch(() => null);
        if (sendCoord) {
          await page.mouse.click(sendCoord.x, sendCoord.y).catch(() => {});
        }
        await page.waitForTimeout(2000);
        tips.push('已发送文生图请求，等待 DALL-E 生成...');

        // 5. 等图片生成（锚点法：只认发送后新增的图，不抓旧图）
        //    发送前先记录页面已有图片 URL 数量作为锚点
        const imgAnchorUrls = await page.evaluate(() => {
          const selectors = [
            'div[id^="image-"] img',
            'img[src*="estuary/content"]',
            'img[src*="oaidalleapiprodscus"]',
            'img[src*="files.oaiusercontent"]',
          ];
          const seen = new Set<string>();
          for (const sel of selectors) {
            for (const img of document.querySelectorAll(sel)) {
              const src = (img as HTMLImageElement).src;
              if (src) seen.add(src);
            }
          }
          return Array.from(seen);
        }).catch(() => [] as string[]);
        tips.push(`📌 锚点：发送前已有 ${imgAnchorUrls.length} 张图`);

        const startTime = Date.now();
        const imageUrls: string[] = [];
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(3000);
          // 拒绝/错误文案检测：没新增图时才查
          const refusal = await checkRefusal(page, ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]']).catch(() => ({ refused: false, reason: null, text: '' }));
          if (refusal.refused && refusal.reason) {
            tips.push("⚠️ ChatGPT 拒绝生图（" + refusal.reason + "）：" + refusal.text.substring(0, 100));
            return fail("ChatGPT 拒绝生图", tips);
          }
          // 锚点法：只收集锚点之外的新图
          const urls = await page.evaluate((anchor: string[]) => {
            const anchorSet = new Set(anchor);
            const selectors = [
              'div[id^="image-"] img',
              'img[src*="estuary/content"]',
              'img[src*="oaidalleapiprodscus"]',
              'img[src*="files.oaiusercontent"]',
            ];
            const seen = new Set<string>();
            const out: string[] = [];
            for (const sel of selectors) {
              for (const img of document.querySelectorAll(sel)) {
                const src = (img as HTMLImageElement).src;
                if (src && !anchorSet.has(src) && !seen.has(src)) { seen.add(src); out.push(src); }
              }
            }
            return out;
          }, imgAnchorUrls).catch(() => [] as string[]) as string[];
          if (urls.length > 0) {
            imageUrls.push(...new Set(urls));
            break;
          }
        }

        if (imageUrls.length > 0) {
          tips.push(`✓ DALL-E 生成了 ${imageUrls.length} 张图片`);
          const conversationUrl = page.url();
          const conversationId = await page.evaluate(() => {
            const m = window.location.href.match(/\/c\/([a-f0-9-]+)/i);
            return m ? m[1] : '';
          }).catch(() => '') as string;
          if (conversationId) tips.push(`🔗 会话 ID: ${conversationId}（下次用 --session ${conversationId} 复用）`);
          return ok({ images: imageUrls, status: 'completed', conversationUrl, conversationId }, tips);
        }
        tips.push('⚠ DALL-E 生成超时');
        const conversationUrl = page.url();
        const conversationId = await page.evaluate(() => {
          const m = window.location.href.match(/\/c\/([a-f0-9-]+)/i);
          return m ? m[1] : '';
        }).catch(() => '') as string;
        return ok({ images: [], status: 'timeout', conversationUrl, conversationId }, tips);
      } catch (e) {
        return fail('文生图失败', ['错误详情: ' + (e instanceof Error ? e.message : String(e)), '请检查 ChatGPT 登录状态']);
      }
    },
  });

  // ── storyboard — 连续分镜（单命令内循环，页面不关，会话不断）──
  // chatgpt 跟 gemini 一样：跨命令无法保持会话状态。
  // 必须单命令内循环，页面始终不关，会话自然延续。
  // 锚点法抓图：发送前记 imgCount，只认新增。
  site.command('storyboard', {
    description: '连续分镜（单命令内循环，页面不关，会话不断）',
    scope: 'browser',
    parameters: z.object({
      shots: z.string().describe('分镜提示词 CSV（如 "画猫咪站着,画猫咪坐下,画猫咪躺下"）'),
    }),
    result: z.object({ images: z.array(z.string()).optional(), count: z.number(), status: z.string(), conversationId: z.string().optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser chatgpt storyboard --shots "画猫咪站着,画猫咪坐下,画猫咪躺下" --cdp 9221', description: '3 镜连续' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const tips = buildTips(ctx);
      const prompts = params.shots.split(',').map(s => s.trim()).filter(Boolean);
      if (prompts.length === 0) return fail('未指定分镜', ['--shots 至少一个']);
      if (prompts.length > 10) return fail('最多 10 镜', ['超过上限，请分批']);

      // 1. 导航到 chatgpt 首页（一次）
      const curUrl = page.url();
      if (!curUrl.includes('chatgpt.com')) {
        await page.goto(CG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
      await page.waitForSelector('#prompt-textarea', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      tips.push(`📌 已加载 ChatGPT，开始 ${prompts.length} 镜连续分镜`);

      const allImages: string[] = [];

      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i]!;
        tips.push(`\n📽 第${i + 1}/${prompts.length}镜：${prompt.substring(0, 40)}${prompt.length > 40 ? '...' : ''}`);

        // ── 锚点：记录发送前已有图片 URL 集合 ──
        const anchorUrls = await page.evaluate(() => {
          const sels = ['div[id^="image-"] img', 'img[src*="estuary/content"]', 'img[src*="oaidalleapiprodscus"]', 'img[src*="files.oaiusercontent"]'];
          const seen = new Set<string>();
          for (const sel of sels) for (const img of document.querySelectorAll(sel)) { const src = (img as HTMLImageElement).src; if (src) seen.add(src); }
          return Array.from(seen);
        }).catch(() => [] as string[]);

        // ── 输入（contenteditable + keyboard.type）──
        await page.locator('#prompt-textarea').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
        await page.keyboard.type(prompt, { delay: 15 });
        await page.waitForTimeout(400);
        const written = await page.evaluate((exp: string) => {
          const ed = document.querySelector('#prompt-textarea');
          return ed ? (ed.textContent || '').includes(exp.substring(0, Math.min(10, exp.length))) : false;
        }, prompt).catch(() => false);
        if (!written) {
          await fastInput(page, prompt, 'execCommand');
          await page.waitForTimeout(300);
        }

        // ── 发送（真鼠标点击 #composer-submit-button）──
        const sendCoord = await page.evaluate(() => {
          const b = document.querySelector('#composer-submit-button') as HTMLButtonElement;
          if (!b || b.disabled) return null;
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }).catch(() => null);
        if (!sendCoord) {
          tips.push(`  ❌ 第${i + 1}镜发送按钮不可用，跳过`);
          continue;
        }
        await page.mouse.click(sendCoord.x, sendCoord.y).catch(() => {});
        await page.waitForTimeout(3000);

        // ── 等图（锚点法：只认 anchor 之外的新图）──
        const startTime = Date.now();
        let gotImage = false;
        while (Date.now() - startTime < 120000) {
          await page.waitForTimeout(3000);
          const newUrls = await page.evaluate((anchor: string[]) => {
            const anchorSet = new Set(anchor);
            const sels = ['div[id^="image-"] img', 'img[src*="estuary/content"]', 'img[src*="oaidalleapiprodscus"]', 'img[src*="files.oaiusercontent"]'];
            const seen = new Set<string>();
            const out: string[] = [];
            for (const sel of sels) for (const img of document.querySelectorAll(sel)) {
              const src = (img as HTMLImageElement).src;
              if (src && !anchorSet.has(src) && !seen.has(src)) { seen.add(src); out.push(src); }
            }
            return out;
          }, anchorUrls).catch(() => [] as string[]) as string[];

          if (newUrls.length > 0) {
            tips.push(`  ✅ 第${i + 1}镜生成：${newUrls.length} 张新图（anchor=${anchorUrls.length}）`);
            allImages.push(...newUrls);
            gotImage = true;
            break;
          }
        }
        if (!gotImage) {
          tips.push(`  ⚠️ 第${i + 1}镜超时未生成新图，继续下一镜`);
        }
        await page.waitForTimeout(1000);
      }

      // 提取会话 ID
      const conversationId = await page.evaluate(() => {
        const m = window.location.href.match(/\/c\/([a-f0-9-]+)/i);
        return m ? m[1] : '';
      }).catch(() => '') as string;
      if (conversationId) tips.push(`🔗 会话 ID: ${conversationId}`);

      tips.push(`\n📦 完成：${allImages.length} 张图`);
      return ok({ images: allImages, count: allImages.length, status: 'completed', conversationId }, tips);
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
      console.log(`      xbrowser viewer --session ${sessionId || 'default'}`);
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
      console.log('      xbrowser viewer --session cg-login');
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
  // ChatGPT 的 contenteditable 不响应 CDP keyboard.press('Enter')
  // 优先点击发送按钮（#composer-submit-button），fallback 到 Enter
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('#composer-submit-button') as HTMLElement;
    if (btn && btn.offsetParent !== null) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!clicked) {
    // fallback: 真实键盘 Enter
    await page.keyboard.press('Enter');
  }
}


