import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import * as path from 'path';
import * as fs from 'fs';
import { buildTips, checkLoginStatus } from '../shared/ai-chat-base.js';

type Page = import('../types').Page;

const DS_URL = 'https://chat.deepseek.com';

// ─── 工具函数 ────────────────────────────────────────

async function ensurePage(page: Page, ctx?: CommandContext): Promise<void> {
  if (!page.url().startsWith(DS_URL)) {
    await page.goto(DS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  // 检查登录状态（仅首次）
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '') as string;
      if (bodyText.includes('登录') && bodyText.includes('注册') && !bodyText.includes('深度思考')) {
        const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
        throw new Error(
          'DeepSeek 未登录！\n' +
          (cdp
            ? '  使用 --cdp 连接的浏览器未登录 DeepSeek，请先在浏览器中登录。\n  或运行: xbrowser deepseek login'
            : '  请使用 --cdp 参数连接已登录的浏览器:\n    xbrowser deepseek list --cdp http://localhost:9221')
        );
      }
    }
  }
}

// ─── 选择器常量（稳定版） ─────────────────────────────

const SEL = {
  input: 'textarea[name="search"]',
  // 发送按钮：录制确认的稳定 selector（DeepSeek 发送按钮无 aria-label/文字，纯图标）
  // .ds-button--primary 在输入区右下方，页面上唯一可见的 primary 按钮即发送键
  sendBtn: '.ds-button--primary',
  toggleBtn: 'div[role="button"][class*="ds-toggle-button"]',
  radioBtn: '[role="radio"]',
  newChat: 'text=开启新对话',
  conversationLinks: 'a[href*="/a/chat/s/"]',
  fileInput: 'input[type="file"]',
} as const;

/**
 * DeepSeek 专属文件上传：直接 setInputFiles 到 input[type=file]。
 * DeepSeek 的 file input 直接存在（不需要点菜单触发），与 ChatGPT 的 "+" 菜单流程不同。
 * setInputFiles 不依赖 dispatchMouseEvent，cdp-tunnel 下一直正常。
 */
async function dsUploadFiles(page: Page, filePaths: string[]): Promise<{ files: string[]; uploaded: number; errors: string[] }> {
  const absPaths = filePaths.map((fp) => path.resolve(fp));
  const errors: string[] = [];
  const valid: string[] = [];
  for (const fp of absPaths) {
    if (!fs.existsSync(fp)) { errors.push(`文件不存在: ${fp}`); continue; }
    valid.push(fp);
  }
  if (valid.length === 0) return { files: [], uploaded: 0, errors };
  const payloads = valid.map((fp) => {
    const buf = fs.readFileSync(fp);
    const ext = path.extname(fp).toLowerCase();
    const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
    return { name: path.basename(fp), mimeType: mime[ext] || 'application/octet-stream', buffer: buf };
  });
  const p = page as unknown as { setInputFiles?: (s: string, f: unknown[]) => Promise<void> };
  let uploaded = 0;
  if (typeof p.setInputFiles === 'function') {
    try {
      await p.setInputFiles('input[type="file"]', payloads);
      uploaded = valid.length;
    } catch (e) {
      errors.push(`setInputFiles 失败: ${(e as Error).message}`);
    }
  } else {
    errors.push('page.setInputFiles 不可用');
  }
  // 等待 DeepSeek 上传 loading 消失（ds-loading 元素），最多等 15s
  if (uploaded > 0) {
    for (let i = 0; i < 30; i++) {
      const stillLoading = await page.evaluate(() => !!document.querySelector('.ds-loading')).catch(() => false);
      if (!stillLoading) break;
      await page.waitForTimeout?.(500).catch?.(() => {});
    }
  }
  return { files: valid, uploaded, errors };
}


// ─── 插件入口 ────────────────────────────────────────

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'deepseek',
    url: DS_URL,
    description: 'DeepSeek 聊天助手 — 会话管理、消息发送、模式切换、附件上传',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        // No page or blank page — assume logged in, handler will navigate
        if (!page) return true;
        const url = page.url();
        if (!url || url === 'about:blank' || url === '') return true;
        // DeepSeek 未登录时会在 URL 中带 /login 或在 body 显示"登录"
        if (url.includes('/login') || url.includes('/auth')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
        if (!body || (body.includes('登录') && body.includes('注册'))) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  0. check-login — 检查是否已登录
  // ═══════════════════════════════════════════════════
  site.command('check-login', {
    description: '检查 DeepSeek 登录状态',
    parameters: z.object({}),
    requiresLogin: false,
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail({ message: '需要浏览器页面' });
      const result = await checkLoginStatus(page, DS_URL, {
        loginUrlPatterns: ['/login', '/auth'],
        loginTextPatterns: ['登录', '注册'],
      });
      const tips = buildTips(ctx);
      if (result.loggedIn) {
        return ok({ data: { loggedIn: true, url: result.url, detail: result.detail }, tips });
      }
      return ok({ data: { loggedIn: false, url: result.url, detail: result.detail }, tips });
    },
  });

  // ═══════════════════════════════════════════════════
  //  1. list — 列出所有会话
  // ═══════════════════════════════════════════════════
  const listResultSchema = z.array(z.object({ index: z.number(), title: z.string(), url: z.string() }).passthrough());
  site.command('list', {
    description: '列出所有历史会话',
    requiresLogin: true,
    scope: 'page',
    parameters: z.object({}),
    result: listResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek list', description: '列出所有会话' },
      { cmd: 'xbrowser deepseek list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error("需要浏览器页面");
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/a/chat/s/"]');
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

  // ═══════════════════════════════════════════════════
  //  2. new — 新建对话
  // ═══════════════════════════════════════════════════
  const newResultSchema = z.object({ created: z.boolean() }).passthrough();
  site.command('new', {
    description: '创建新的空白对话',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({}),
    result: newResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek new', description: '新建对话' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error("需要浏览器页面");
        await ensurePage(page, ctx);

        const result = await page.evaluate(() => {
          // 遍历查找"开启新对话"文本元素
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes('开启新对话')) {
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
          // 兜底：点击侧栏第一个大图标按钮
          const fallback = await page.evaluate(() => {
            const iconBtns = document.querySelectorAll('[class*="ds-icon-button--l"]');
            if (iconBtns.length > 0) {
              (iconBtns[0] as HTMLElement).click();
              return 'clicked_icon';
            }
            return 'failed';
          });
          if (fallback === 'failed') throw new Error('找不到"开启新对话"按钮');
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

  // ═══════════════════════════════════════════════════
  //  3. open <title> — 打开指定会话
  // ═══════════════════════════════════════════════════
  const openResultSchema = z.object({ opened: z.string() }).passthrough();
  site.command('open', {
    description: '通过标题打开指定会话（模糊匹配）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('会话标题（支持模糊匹配）'),
    }),
    result: openResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek open "1加1等于2"', description: '打开指定会话' },
      { cmd: 'xbrowser deepseek open "股票"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error("需要浏览器页面");
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);

        const clicked = await page.evaluate(({ searchTitle }) => {
          const links = document.querySelectorAll('a[href*="/a/chat/s/"]');
          for (const link of links) {
            const text = (link.textContent || '').trim();
            if (text.includes(searchTitle)) {
              (link as HTMLAnchorElement).click();
              return { found: true, title: text };
            }
          }
          return { found: false, title: '' };
        }, { searchTitle: params.title }) as { found: boolean; title: string };

        if (!clicked.found) throw new Error(`未找到包含"${params.title}"的会话`);

        await page.waitForTimeout(2000);
        const tips = buildTips(ctx);
        tips.push(`已打开会话：${clicked.title}`);
        return ok({ opened: clicked.title }, tips)
      } catch {
        return fail('未知错误', ['打开会话失败'])
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  4. chat <message> — 发送消息
  // ═══════════════════════════════════════════════════
  const chatResultSchema = z.object({ response: z.string(), duration: z.string().optional(), conversationId: z.string().optional(), sources: z.record(z.string(), z.any()).optional() }).passthrough();
  site.command('chat', {
    description: '发送消息并等待 AI 回复',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      path: z.string().optional().describe('单附件路径（图片/文件/URL）'),
      paths: z.string().optional().describe('多附件路径（CSV，与 --type 匹配）'),
      type: z.enum(['image', 'file', 'url']).optional().describe('附件类型（默认 image）'),
      mode: z.enum(['normal', 'expert']).optional().describe('对话模式: normal=快速模式, expert=专家模式'),
      think: z.boolean().optional().describe('开启深度思考模式'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    result: chatResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser deepseek chat "分析这张图" --path /path/to/img.jpg', description: '发送消息+单张图片' },
      { cmd: 'xbrowser deepseek chat "对比这3张" --paths "/a.jpg,/b.png,/c.jpg"', description: '发送消息+多张图片' },
      { cmd: 'xbrowser deepseek chat "深度分析" --think', description: '开启深度思考' },
      { cmd: 'xbrowser deepseek chat "专家级分析" --mode expert', description: '使用专家模式' },
      { cmd: 'xbrowser deepseek chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
      { cmd: 'xbrowser deepseek chat "深度研究" --think --search --showSources', description: '深度思考+联网+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error("需要浏览器页面");
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000); // 等 React 渲染
        const tips = buildTips(ctx);

        // 切换对话模式（快速/专家）
        if (params.mode) {
          const modeToggled = await page.evaluate(({ targetMode }) => {
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const text = el.textContent?.trim() || '';
              if ((text.includes('专家模式') || text.includes('深度思考')) && el.children.length <= 3 && (el as HTMLElement).offsetParent !== null) {
                if (targetMode === 'expert' && !text.includes('专家')) {
                  (el as HTMLElement).click();
                  return 'expert_toggled';
                }
                break;
              }
            }
            for (const el of allElements) {
              const text = el.textContent?.trim() || '';
              if (targetMode === 'expert' && text.includes('专家') && (el as HTMLElement).offsetParent !== null) {
                (el as HTMLElement).click();
                return 'expert_clicked';
              }
            }
            return 'not_found';
          }, { targetMode: params.mode });
          if (modeToggled !== 'not_found') {
            tips.push(`已切换到${params.mode === 'expert' ? '专家' : '快速'}模式`);
            await page.waitForTimeout(500);
          }
        }

        // 开启深度思考
        if (params.think) {
          const thinkToggled = await page.evaluate(() => {
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const text = el.textContent?.trim() || '';
              if (text === '深度思考' || text === 'DeepThink' || text === '深度推理') {
                const parent = el.closest('button, [role="switch"], [role="button"]') || el.parentElement;
                if (parent) {
                  const isActive = parent.getAttribute('aria-checked') === 'true'
                    || parent.getAttribute('aria-pressed') === 'true'
                    || parent.classList.contains('active');
                  if (!isActive) {
                    (parent instanceof HTMLElement ? parent : parent.parentElement)?.click();
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
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const text = el.textContent?.trim() || '';
              if (text === '联网搜索' || text === '搜索' || text === 'Search') {
                const parent = el.closest('button, [role="switch"], [role="button"]') || el.parentElement;
                if (parent) {
                  const isActive = parent.getAttribute('aria-checked') === 'true'
                    || parent.getAttribute('aria-pressed') === 'true'
                    || parent.classList.contains('active');
                  if (!isActive) {
                    (parent instanceof HTMLElement ? parent : parent.parentElement)?.click();
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

        // 先上传附件（如果有）
        if (params.path || params.paths) {
          const list = [
            ...(params.path ? [params.path] : []),
            ...(params.paths ? params.paths.split(',').map((s2) => s2.trim()).filter(Boolean) : []),
          ];
          const r = await dsUploadFiles(page, list);
          if (r.errors.length > 0) tips.push(...r.errors.map((e) => `⚠ ${e}`));
          if (r.uploaded === 0) return fail('附件上传失败', r.errors.length ? r.errors : ['未上传任何文件']);
          tips.push(`✓ 已上传 ${r.uploaded}/${list.length} 个附件`);
        }


        // 填充输入框：click 聚焦 + keyboard.type 逐字输入（带延迟，模拟人类打字）。
        // cdp-tunnel 的 Input 转发 bug 已修复（2026-06-17），keyboard/mouse 事件正常到 DOM。
        const inputSel = SEL.input;
        let inputFound = false;
        for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', inputSel]) {
          const count = await page.locator(sel).count();
          if (count > 0) {
            await page.locator(sel).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            await page.locator(sel).first().click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(150);
            await page.keyboard.type(params.message, { delay: 5 });
            inputFound = true;
            break;
          }
        }
        if (!inputFound) throw new Error('找不到消息输入框');

        await page.waitForTimeout(400);

        // 发送：keyboard.press('Enter')（录制确认 DeepSeek 用 Enter 发送，触发 completion）。
        await page.keyboard.press('Enter');
        tips.push('消息已发送，等待 AI 回复...');

        // 等页面稳定
        await page.waitForTimeout(2000);
        const hasFile = !!(params as Record<string, unknown>).attach;
        const wantSources = !!(params as Record<string, unknown>).showSources;

        // 如果需要提取搜索来源，用 route 拦截 SSE 流
        let capturedStream = '';
        if (wantSources) {
          await page.route('**/api/v0/chat/completion', async (route) => {
            const r = route as unknown as { fetch(): Promise<{ text(): Promise<string>; headers(): Record<string, string>; status(): number }> };
            const resp = await r.fetch();
            const body = await resp.text();
            capturedStream += body;
            await route.fulfill({ body, headers: resp.headers(), status: resp.status() });
          });
        }

        // 等页面稳定
        await page.waitForTimeout(2000);
        // 轮询策略：先提取回复内容，再用「停止生成按钮」判断是否还在生成。
        // ⚠️ 不能用 [class*=loading] 早返回——DeepSeek 底部模式切换器常带 loading class，
        //    会导致轮询永远返回空（之前 chat 超时的根因）。
        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(1500);
          try {
            const poll = await page.evaluate(({ fileMode }) => {
              const allText = document.body.textContent || '';
              // 文件解析中：跳过本轮
              if (fileMode && allText.includes('文件解析中')) return { text: '', generating: true };

              // 1. 提取 AI 回复：优先 ds-assistant-message-main-content，兜底 ds-markdown
              const pickLast = (sel: string): string => {
                const els = document.querySelectorAll(sel);
                for (let i = els.length - 1; i >= 0; i--) {
                  const txt = (els[i].textContent || '').trim();
                  if (txt.length > 0) return txt.slice(0, 2000);
                }
                return '';
              };
              let text = pickLast('[class*="ds-assistant-message-main-content"]');
              if (!text) text = pickLast('[class*="ds-markdown"]');

              // 2. 判断是否还在生成：有「停止生成」按钮（DeepSeek 生成中会显示 stop 图标）
              //    停止按钮通常含 stop/pause 类，或发送按钮变成 loading 状态
              const stopBtn = document.querySelector('[class*="stop"], [class*="pause"], [aria-label*="停止"], [aria-label*="stop"]');
              const generating = !!stopBtn;

              // 3. 文件模式错误检测
              if (fileMode && !text && (allText.includes('异常') || allText.includes('错误'))) {
                const idx = allText.indexOf('异常');
                return { text: '[系统提示] ' + allText.slice(Math.max(0, idx - 40), idx + 60).trim().slice(0, 200), generating: false };
              }
              return { text, generating };
            }, { fileMode: hasFile }) as { text: string; generating: boolean };

            // 有文本且不再生成 → 完成
            if (poll.text && !poll.generating) {
              responseText = poll.text;
              break;
            }
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

          // 等 SSE 流收完搜索数据（额外等几秒）
          if (wantSources) {
            await new Promise(r => setTimeout(r, 5000));
          }

          // 提取联网搜索来源（优先用 SSE 流，兜底用 DOM）
          if (wantSources) {
            try {
              await page.unroute('**/api/v0/chat/completion').catch(() => {});
              let allUrls: string[] = [];

              if (capturedStream) {
                // 从 SSE 流中提取 URL
                const urlMatches = capturedStream.match(/https?:\/\/[^"'\s,<>\\\]\)]+/g) || [];
                for (const u of urlMatches) {
                  const clean = u.replace(/\\u002F/g, '/').split(/[)\]"'.,;:!?]+$/)[0];
                  try {
                    new URL(clean); // validate
                    allUrls.push(clean);
                  } catch { /* invalid URL, skip */ }
                }
              }

              if (allUrls.length === 0) {
                // 兜底：从 DOM 获取
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

              // 去重
              const seen = new Set<string>();
              const uniqueUrls = allUrls.filter(u => {
                const k = u.toLowerCase();
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
              });

              // 提取域名
              const domains = new Set<string>();
              for (const u of uniqueUrls) {
                try { domains.add(new URL(u).hostname.replace(/^www\./, '')); } catch { /* invalid URL, skip */ }
              }
              // 也捕获 site-icons 域名
              const siteIcons = capturedStream.match(/site-icons\/([a-zA-Z0-9.-]+)/g) || [];
              for (const si of siteIcons) {
                const d = si.replace('site-icons/', '');
                if (d.includes('.')) domains.add(d);
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

          return ok(result, tips)
        } else {
          tips.push('AI 回复超时或未检测到');
          return ok({ response: '' }, tips)
        }
      } catch {
        return fail('未知错误', ['发送消息失败'])
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  5. mode <normal|expert> — 切换模式
  // ═══════════════════════════════════════════════════
  const modeResultSchema = z.object({ mode: z.string(), action: z.string().optional() }).passthrough();
  site.command('mode', {
    description: '切换快速模式/专家模式',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      mode: z.enum(['normal', 'expert']).describe('模式：normal=快速模式, expert=专家模式'),
    }),
    result: modeResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek mode expert', description: '专家模式' },
      { cmd: 'xbrowser deepseek mode normal', description: '快速模式' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error("需要浏览器页面");
        await ensurePage(page, ctx);
        await page.waitForTimeout(500);

        const label = params.mode === 'expert' ? '专家模式' : '快速模式';
        await page.waitForTimeout(2000);
        const clicked = await page.evaluate(({ targetLabel }) => {
          const radios = document.querySelectorAll('[role="radio"]');
          for (const radio of radios) {
            const text = radio.textContent?.trim().replace(/\s+/g, '') || '';
            if (text.includes(targetLabel)) {
              if (radio.getAttribute('aria-checked') === 'true') {
                return 'already';
              }
              (radio as HTMLElement).click();
              return 'clicked';
            }
          }
          return 'not_found';
        }, { targetLabel: label });

        await page.waitForTimeout(500);

        if (clicked === 'not_found') {
          // 可能已经进了具体对话，模式选择器不在页面上
          return ok({ mode: params.mode }, [...buildTips(ctx), '提示：模式切换仅在首页可用，已进入对话时无法切换']);
        }

        const status = clicked === 'already' ? '已经是' : '已切换为';
        const tips = buildTips(ctx);
        tips.push(`${status} ${label}`);
        return ok({ mode: params.mode, action: clicked }, tips)
      } catch {
        return fail('未知错误', ['切换模式失败'])
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  6. think <on|off> — 深度思考开关
  // ═══════════════════════════════════════════════════
  // 通用：切换底部开关按钮（深度思考/智能搜索）
  // DeepSeek 的按钮是 <div role="button" class="ds-toggle-button"> 内含 <span> 文本
  async function toggleButton(page: Page, buttonText: string, wanted: boolean): Promise<string> {
    await page.waitForTimeout(2000);
    // 主方案：locator + 稳定 class 选择器
    const btn = page.locator('div[role="button"][class*="ds-toggle-button"]').first();
    const count = await btn.count();
    if (count > 0) {
      const pressed = await btn.getAttribute('aria-pressed');
      if (pressed === String(wanted)) return 'already';
      await btn.click();
      return 'clicked';
    }
    // 兜底：遍历 role=button 元素
    return await page.evaluate(({ text, on }) => {
      const all = document.querySelectorAll('[role="button"]');
      for (const el of all) {
        if (el.textContent?.trim().includes(text)) {
          const pressed = el.getAttribute('aria-pressed') || (el.matches('[pressed]') ? 'true' : 'false');
          if ((pressed === 'true') === on) return 'already';
          (el as HTMLElement).click();
          return 'clicked';
        }
      }
      return 'not_found';
    }, { text: buttonText, on: wanted }) as string;
  }

  const thinkResultSchema = z.object({ think: z.string(), action: z.string().optional() }).passthrough();
  site.command('think', {
    description: '切换深度思考模式',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      state: z.enum(['on', 'off']).describe('on=开启, off=关闭'),
    }),
    result: thinkResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek think on', description: '开启深度思考' },
      { cmd: 'xbrowser deepseek think off', description: '关闭深度思考' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error("需要浏览器页面");
        await ensurePage(page, ctx);
        const targetPressed = params.state === 'on';
        const toggleResult = await toggleButton(page, '深度思考', targetPressed);
        await page.waitForTimeout(500);

        const stateName = params.state === 'on' ? '开启' : '关闭';
        if (toggleResult === 'not_found') {
          return ok({ think: params.state }, [...buildTips(ctx), '提示：未找到深度思考按钮，可能页面尚未完全加载']);
        }
        const status = toggleResult === 'already' ? `已经是${stateName}状态` : `已${stateName}`;
        const tips = buildTips(ctx);
        tips.push(`深度思考：${status}`);
        return ok({ think: params.state, action: toggleResult }, tips);
      } catch {
        return fail('未知错误', ['切换深度思考失败']);
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  7. search <on|off> — 智能搜索开关
  // ═══════════════════════════════════════════════════
  const searchResultSchema = z.object({ search: z.string(), action: z.string().optional() }).passthrough();
  site.command('search', {
    description: '切换智能搜索（联网搜索）',
    requiresLogin: false,
    scope: 'browser',
    parameters: z.object({
      state: z.enum(['on', 'off']).describe('on=开启, off=关闭'),
    }),
    result: searchResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek search on', description: '开启智能搜索' },
      { cmd: 'xbrowser deepseek search off', description: '关闭智能搜索' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error("需要浏览器页面");
        await ensurePage(page, ctx);
        const targetPressed = params.state === 'on';
        const toggleResult = await toggleButton(page, '智能搜索', targetPressed);
        await page.waitForTimeout(500);

        const stateName = params.state === 'on' ? '开启' : '关闭';
        if (toggleResult === 'not_found') {
          return ok({ search: params.state }, [...buildTips(ctx), '提示：未找到智能搜索按钮，可能页面尚未完全加载'])
        }
        const status = toggleResult === 'already' ? `已经是${stateName}状态` : `已${stateName}`;
        const tips = buildTips(ctx);
        tips.push(`智能搜索：${status}`);
        return ok({ search: params.state, action: toggleResult }, tips)
      } catch {
        return fail('未知错误', ['切换智能搜索失败'])
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  8. attach <type> <path> — 发送附件
  //  规范：AGENTS.md §10.0.3.1（type 走 --type，单/多张走 --path / --paths）
  // ═══════════════════════════════════════════════════
  const attachResultSchema = z.object({ type: z.string().optional(), sent: z.boolean().optional(), file: z.string().optional(), uploaded: z.boolean().optional(), files: z.array(z.string()).optional() }).passthrough();
  site.command('attach', {
    description: '发送附件（图片/文件/URL）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      type: z.enum(['image', 'file', 'url']).describe('附件类型'),
      path: z.string().optional().describe('单文件路径 或 URL 链接'),
      paths: z.string().optional().describe('多文件路径（CSV）— 仅 image/file 类型有效'),
    }).refine((d) => {
      if (d.type === 'url') return Boolean(d.path) && !d.paths;
      return Boolean(d.path) || Boolean(d.paths);
    }, {
      message: 'url 类型只能用 --path；image/file 用 --path 或 --paths',
    }),
    result: attachResultSchema,
    examples: [
      { cmd: 'xbrowser deepseek attach --type image --path ~/photo.jpg', description: '上传单张图片' },
      { cmd: 'xbrowser deepseek attach --type url "https://example.com"', description: '发送 URL 链接' },
      { cmd: 'xbrowser deepseek attach --type file --paths "~/a.pdf,~/b.docx"', description: '批量上传多文件' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      await ensurePage(page, ctx);
      await page.waitForTimeout(500);
      const tips = buildTips(ctx);

      if (params.type === 'url') {
        const inputSel = SEL.input;
        await page.waitForSelector(inputSel, { timeout: 10000 });
        await page.fill(inputSel, params.path!);
        await page.waitForTimeout(300);
        await page.press(inputSel, 'Enter');
        tips.push(`URL "${params.path}" 已作为消息发送`);
        return ok({ type: 'url', sent: true }, tips);
      }

      const list = [
        ...(params.path ? [params.path] : []),
        ...(params.paths ? params.paths.split(',').map((s) => s.trim()).filter(Boolean) : []),
      ];
      if (list.length === 0) return fail('参数错误', ['--path 或 --paths 至少二选一']);

      const r = await dsUploadFiles(page, list);
      if (r.errors.length > 0) tips.push(...r.errors.map((e) => `⚠ ${e}`));
      if (r.uploaded === 0) return fail('上传失败', r.errors.length ? r.errors : ['未上传任何文件']);
      tips.push(`✓ 已上传 ${r.uploaded}/${list.length} 个文件`);
      return ok({ type: params.type, files: r.files, uploaded: r.uploaded === list.length }, tips);
    },
  });

  // ═══════════════════════════════════════════════════
  //  9. login / logout — 登录态管理
  // ═══════════════════════════════════════════════════
  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(DS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn();
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录 DeepSeek');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录 DeepSeek:');
      console.log('   1. 打开 Viewer（实时查看浏览器画面）:');
      console.log(`      xbrowser viewer --session ${sessionId || 'default'}`);
      console.log('   2. 在 Viewer 页面中登录 DeepSeek');
      console.log('   3. 登录后回到此终端，按 Enter 继续');
      console.log('');
      console.log('   也可以用截图模式查看当前页面状态:');
      console.log('      xbrowser screenshot --session ' + (sessionId || 'default'));
      console.log('');
    } else if (!cdp) {
      console.log('');
      console.log('⚠️  推荐使用 --cdp 参数连接到已登录的浏览器:');
      console.log('     xbrowser deepseek list --cdp http://localhost:9221');
      console.log('');
      console.log('🔑 或者启动 Viewer 手动登录:');
      console.log('   1. 启动浏览器会话:');
      console.log('      xbrowser session open ' + DS_URL + ' --name ds-login');
      console.log('   2. 启动 Viewer:');
      console.log('      xbrowser viewer --session ds-login');
      console.log('   3. 在 Viewer 中登录后:');
      console.log('      xbrowser deepseek list --session ds-login');
      console.log('');
    }

    // 打开页面让用户登录
    if (page) {
      await page.goto(DS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    console.log('   按 Enter 继续...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
    console.log('✅ 继续执行');
  });

  site.logout(async (_ctx) => {
    // DeepSeek 无 API 方式登出，提示用户手动操作
    console.log('⚠️  请在浏览器中手动退出 DeepSeek 登录');
  });
}


