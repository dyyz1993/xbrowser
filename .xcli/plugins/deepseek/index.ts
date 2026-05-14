import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

type Page = import('playwright-core').Page;

const DS_URL = 'https://chat.deepseek.com';

// ─── 工具函数 ────────────────────────────────────────

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
  if (!page.url().startsWith(DS_URL)) {
    await page.goto(DS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  // 检查登录状态（仅首次）
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '');
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
  toggleBtn: 'div[role="button"][class*="ds-toggle-button"]',
  radioBtn: '[role="radio"]',
  newChat: 'text=开启新对话',
  conversationLinks: 'a[href*="/a/chat/s/"]',
  fileInput: 'input[type="file"]',
} as const;

// ─── 帮助常量 ────────────────────────────────────────

const HELP = {
  attach: `附件支持：
  --type image --path /path/to/img.jpg   上传图片
  --type url --url "https://..."         发送 URL 链接
  --type file --path /path/to/doc.pdf    上传文件`,
};

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
        if (!page) return false;
        // DeepSeek 未登录时会在 URL 中带 /login 或在 body 显示"登录"
        const url = page.url();
        if (url.includes('/login') || url.includes('/auth')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body || body.includes('登录') && body.includes('注册')) return false;
        return true;
      } catch {
        return false;
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  1. list — 列出所有会话
  // ═══════════════════════════════════════════════════
  site.command('list', {
    description: '列出所有历史会话',
    scope: 'page',
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser deepseek list', description: '列出所有会话' },
      { cmd: 'xbrowser deepseek list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/a/chat/s/"]');
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
        return {
          data: null,
          tips: ['获取会话列表失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  2. new — 新建对话
  // ═══════════════════════════════════════════════════
  site.command('new', {
    description: '创建新的空白对话',
    scope: 'browser',
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser deepseek new', description: '新建对话' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = getPage(ctx);
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
        return {
          data: { created: true },
          tips: buildTips(ctx),
          message: '✅ 已创建新对话',
        };
      } catch (error) {
        return {
          data: null,
          tips: ['创建新对话失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  3. open <title> — 打开指定会话
  // ═══════════════════════════════════════════════════
  site.command('open', {
    description: '通过标题打开指定会话（模糊匹配）',
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('会话标题（支持模糊匹配）'),
    }),
    examples: [
      { cmd: 'xbrowser deepseek open "1加1等于2"', description: '打开指定会话' },
      { cmd: 'xbrowser deepseek open "股票"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(1000);

        const clicked = await page.evaluate((title: string) => {
          const links = document.querySelectorAll('a[href*="/a/chat/s/"]');
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
        return {
          data: { opened: clicked.title },
          tips: buildTips(ctx),
          message: `✅ 已打开会话：${clicked.title}`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['打开会话失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  4. chat <message> — 发送消息
  // ═══════════════════════════════════════════════════
  site.command('chat', {
    description: '发送消息并等待 AI 回复',
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      attach: z.string().optional().describe('附件路径（图片或文件）'),
      attachType: z.enum(['image', 'file', 'url']).optional().describe('附件类型'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    examples: [
      { cmd: 'xbrowser deepseek chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser deepseek chat "分析这张图" --attach /path/to/img.jpg', description: '发送消息+图片' },
      { cmd: 'xbrowser deepseek chat "2024诺贝尔奖" --showSources', description: '发送消息并显示搜索来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000); // 等 React 渲染
        const tips = buildTips(ctx);

        // 先上传附件（如果有）
        if (params.attach) {
          const attachType = params.attachType || 'image';
          await handleAttachment(page, params.attach, attachType, tips);
        }

        // 找输入框（多种选择器兜底）
        const inputSel = SEL.input;
        let inputFound = false;
        for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', inputSel]) {
          const count = await page.locator(sel).count();
          if (count > 0) {
            await page.locator(sel).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            await page.locator(sel).first().fill(params.message);
            inputFound = true;
            break;
          }
        }
        if (!inputFound) throw new Error('找不到消息输入框');

        await page.waitForTimeout(500);

        // 发送：Enter 键（DeepSeek SSR 会刷新页面）
        const currentUrl = page.url();
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
            const resp = await route.fetch();
            const body = await resp.text();
            capturedStream += body;
            await route.fulfill({ body, headers: resp.headers(), status: resp.status() });
          });
        }

        // 轮询 AI 回复（最多 60s）
        let responseText = '';
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
          await page.waitForTimeout(1500);
          try {
            responseText = await page.evaluate((fileMode: boolean) => {
              const allText = document.body.textContent || '';
              // 有附件时：等"文件解析中"消失
              if (fileMode && allText.includes('文件解析中')) return '';
              // 通用：等 loading 消失
              const loading = document.querySelector('[class*="loading"], [class*="typing"], [class*="spinner"], [class*="skeleton"]');
              if (loading) return '';
              if (allText.includes('深度思考') && allText.includes('...')) return '';
              // 主路径：等 markdown 内容（正常回复）
              const answers = document.querySelectorAll('[class*="ds-markdown"]');
              for (let i = answers.length - 1; i >= 0; i--) {
                const txt = answers[i].textContent?.trim() || '';
                if (txt.length > 30) return txt.slice(0, 2000);
              }
              // 有附件时：markdown 未出现但 loading 没了 → 可能有错误/提示消息
              if (fileMode) {
                // 等文件相关的提示文字出现
                if (allText.includes('异常') || allText.includes('错误') || allText.includes('删除')) {
                  const idx = allText.indexOf('异常');
                  return '[系统提示] ' + allText.slice(Math.max(0, idx-40), idx+60).trim().slice(0, 200);
                }
                return '';
              }
              // 无附件时：等引用链接出现（联网搜索完成）
              const links = document.querySelectorAll('a[href*="http"]');
              if (links.length === 0) return '';
              for (let i = answers.length - 1; i >= 0; i--) {
                const txt = answers[i].textContent?.trim() || '';
                if (txt.length > 50) return txt.slice(0, 2000);
              }
              return '';
            }, hasFile);
            if (responseText) break;
          } catch {
            // ignore
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
              let allDomains: string[] = [];

              if (capturedStream) {
                // 从 SSE 流中提取 URL
                const urlMatches = capturedStream.match(/https?:\/\/[^"'\s,<>\\\]\)]+/g) || [];
                for (const u of urlMatches) {
                  const clean = u.replace(/\\u002F/g, '/').split(/[)\]"'.,;:!?]+$/)[0];
                  try {
                    new URL(clean); // validate
                    allUrls.push(clean);
                  } catch {}
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
                });
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
                try { domains.add(new URL(u).hostname.replace(/^www\./, '')); } catch {}
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
            message: '⏱ AI 回复超时（60s），请检查页面',
          };
        }
      } catch (error) {
        return {
          data: null,
          tips: ['发送消息失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  5. mode <normal|expert> — 切换模式
  // ═══════════════════════════════════════════════════
  site.command('mode', {
    description: '切换快速模式/专家模式',
    scope: 'browser',
    parameters: z.object({
      mode: z.enum(['normal', 'expert']).describe('模式：normal=快速模式, expert=专家模式'),
    }),
    examples: [
      { cmd: 'xbrowser deepseek mode expert', description: '专家模式' },
      { cmd: 'xbrowser deepseek mode normal', description: '快速模式' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(500);

        const label = params.mode === 'expert' ? '专家模式' : '快速模式';
        await page.waitForTimeout(2000);
        const clicked = await page.evaluate((targetLabel: string) => {
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
        }, label);

        await page.waitForTimeout(500);

        if (clicked === 'not_found') {
          // 可能已经进了具体对话，模式选择器不在页面上
          return {
            data: { mode: params.mode },
            tips: [...buildTips(ctx), '提示：模式切换仅在首页可用，已进入对话时无法切换'],
            message: 'ℹ️ 模式切换仅在首页可用',
          };
        }

        const status = clicked === 'already' ? '已经是' : '已切换为';
        return {
          data: { mode: params.mode, action: clicked },
          tips: buildTips(ctx),
          message: `✅ ${status} ${label}`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['切换模式失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
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
    const btn = page.locator('div[role="button"][class*="ds-toggle-button"]', { hasText: buttonText }).first();
    const count = await btn.count();
    if (count > 0) {
      const pressed = await btn.getAttribute('aria-pressed');
      if (pressed === String(wanted)) return 'already';
      await btn.click();
      return 'clicked';
    }
    // 兜底：遍历 role=button 元素
    return await page.evaluate(([text, on]) => {
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
    }, [buttonText, wanted]);
  }

  site.command('think', {
    description: '切换深度思考模式',
    scope: 'browser',
    parameters: z.object({
      state: z.enum(['on', 'off']).describe('on=开启, off=关闭'),
    }),
    examples: [
      { cmd: 'xbrowser deepseek think on', description: '开启深度思考' },
      { cmd: 'xbrowser deepseek think off', description: '关闭深度思考' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        const targetPressed = params.state === 'on';
        const result = await toggleButton(page, '深度思考', targetPressed);
        await page.waitForTimeout(500);

        const stateName = params.state === 'on' ? '开启' : '关闭';
        if (result === 'not_found') {
          return {
            data: { think: params.state },
            tips: [...buildTips(ctx), '提示：未找到深度思考按钮，可能页面尚未完全加载'],
            message: '⚠️ 未找到深度思考按钮',
          };
        }
        const status = result === 'already' ? `已经是${stateName}状态` : `已${stateName}`;
        return {
          data: { think: params.state, action: result },
          tips: buildTips(ctx),
          message: `✅ 深度思考：${status}`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['切换深度思考失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  7. search <on|off> — 智能搜索开关
  // ═══════════════════════════════════════════════════
  site.command('search', {
    description: '切换智能搜索（联网搜索）',
    scope: 'browser',
    parameters: z.object({
      state: z.enum(['on', 'off']).describe('on=开启, off=关闭'),
    }),
    examples: [
      { cmd: 'xbrowser deepseek search on', description: '开启智能搜索' },
      { cmd: 'xbrowser deepseek search off', description: '关闭智能搜索' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        const targetPressed = params.state === 'on';
        const result = await toggleButton(page, '智能搜索', targetPressed);
        await page.waitForTimeout(500);

        const stateName = params.state === 'on' ? '开启' : '关闭';
        if (result === 'not_found') {
          return {
            data: { search: params.state },
            tips: [...buildTips(ctx), '提示：未找到智能搜索按钮，可能页面尚未完全加载'],
            message: '⚠️ 未找到智能搜索按钮',
          };
        }
        const status = result === 'already' ? `已经是${stateName}状态` : `已${stateName}`;
        return {
          data: { search: params.state, action: result },
          tips: buildTips(ctx),
          message: `✅ 智能搜索：${status}`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['切换智能搜索失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  8. attach <type> <path> — 发送附件
  // ═══════════════════════════════════════════════════
  site.command('attach', {
    description: '发送附件（图片/文件/URL）',
    scope: 'browser',
    parameters: z.object({
      type: z.enum(['image', 'file', 'url']).describe('附件类型'),
      path: z.string().describe('文件路径 或 URL 链接'),
    }),
    examples: [
      { cmd: 'xbrowser deepseek attach image ~/photo.jpg', description: '上传图片' },
      { cmd: 'xbrowser deepseek attach url "https://example.com"', description: '发送 URL 链接' },
      { cmd: 'xbrowser deepseek attach file ~/doc.pdf', description: '上传文件' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensurePage(page, ctx);
        await page.waitForTimeout(500);
        const tips = buildTips(ctx);

        if (params.type === 'url') {
          // URL 直接作为消息发送
          const inputSel = SEL.input;
          await page.waitForSelector(inputSel, { timeout: 10000 });
          await page.fill(inputSel, params.path);
          await page.waitForTimeout(300);
          await page.press(inputSel, 'Enter');
          tips.push(`URL "${params.path}" 已作为消息发送`);
          return {
            data: { type: 'url', sent: true },
            tips,
            message: `✅ URL 已发送`,
          };
        }

        // 图片或文件上传（DataTransfer 方案，绕过 OS 文件选择器）
        const absPath = path.resolve(params.path);
        if (!fs.existsSync(absPath)) {
          throw new Error(`文件不存在: ${absPath}`);
        }
        const uploaded = await uploadFileViaDataTransfer(page, absPath);
        if (!uploaded) {
          throw new Error('找不到 file input。请检查 DeepSeek 是否支持文件上传。');
        }
        await page.waitForTimeout(1000);
        tips.push(`附件 "${path.basename(absPath)}" 已上传`);
        return {
          data: { type: params.type, file: absPath, uploaded: true },
          tips,
          message: `✅ 附件 "${path.basename(absPath)}" 已上传`,
        };
      } catch (error) {
        return {
          data: null,
          tips: ['上传附件失败'],
          message: error instanceof Error ? error.message : '未知错误',
        };
      }
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
      const loggedIn = await site.isLoggedIn(ctx).catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录 DeepSeek');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录 DeepSeek:');
      console.log('   1. 打开 Viewer（实时查看浏览器画面）:');
      console.log(`      agent-browser viewer --session ${sessionId || 'default'}`);
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
      console.log('      agent-browser viewer --session ds-login');
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

// ─── 附件处理辅助函数 ─────────────────────────────────

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

/**
 * 通过 DataTransfer + File 绕过 OS 文件选择器，直接注入文件到 DeepSeek。
 * Playwright 的 setInputFiles 在这个场景不生效（React 状态管理重置），
 * 于是改用 evaluate 手动构造 File → DataTransfer → 赋值 + dispatch change。
 */
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
