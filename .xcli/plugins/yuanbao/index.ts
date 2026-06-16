import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import { buildTips, batchUploadFiles, handleChatAttachments, checkLoginStatus } from '../shared/ai-chat-base.js';

type Page = import('../types').Page;

const SITE_URL = 'https://yuanbao.tencent.com';

async function ensurePage(page: Page, ctx?: CommandContext): Promise<void> {
  if (!page.url().startsWith(SITE_URL)) {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  if (ctx) {
    const isLogin = (ctx as unknown as Record<string, unknown>).__loginChecked as boolean;
    if (!isLogin) {
      (ctx as unknown as Record<string, unknown>).__loginChecked = true;
      const bodyText = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '') as string;
      if (bodyText.includes('登录') && !bodyText.includes('元宝')) {
        const cdp = ctx.cdpEndpoint;
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

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'yuanbao',
    url: SITE_URL,
    description: '腾讯元宝 (Yuanbao) — 会话管理、消息发送、附件上传',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = ctx.page;
        // No page or blank page — assume logged in, handler will navigate
        if (!page) return true;
        const url = page.url();
        if (!url || url === 'about:blank' || url === '') return true;
        if (url.includes('/login') || url.includes('/auth') || url.includes('/passport')) return false;
        const hasInput = await page.evaluate(() => {
          const editor = document.querySelector('.ql-editor, #searchbar-editor, [contenteditable="true"]');
          return !!editor;
        });
        if (hasInput) return true;
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
    description: '检查腾讯元宝登录状态',
    parameters: z.object({}),
    requiresLogin: false,
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail({ message: '需要浏览器页面' });
      const result = await checkLoginStatus(page, SITE_URL, {
        loginUrlPatterns: ['/login', '/auth', '/passport'],
        loggedInSelectors: ['.ql-editor', '#searchbar-editor'],
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
    scope: 'page',
    parameters: z.object({}),
    result: z.array(z.object({ index: z.number(), title: z.string(), url: z.string() }).passthrough()),
    examples: [
      { cmd: 'xbrowser yuanbao list', description: '列出所有会话' },
      { cmd: 'xbrowser yuanbao list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
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
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ created: z.boolean() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao new', description: '新建对话' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
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
      } catch {
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
    result: z.object({ opened: z.string() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao open "工作计划"', description: '打开指定会话' },
      { cmd: 'xbrowser yuanbao open "代码"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
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
        }, params.title) as { found: boolean; title: string };

        if (!clicked.found) throw new Error(`未找到包含"${params.title}"的会话`);

        await page.waitForTimeout(2000);
        return ok({ opened: clicked.title }, buildTips(ctx));
      } catch {
        return fail('未知错误', ['打开会话失败']);
      }
    },
  });

  site.command('chat', {
    description: '发送消息并等待 AI 回复，支持文件上传',
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      path: z.string().optional().describe('单附件路径（图片或文件）'),
      paths: z.string().optional().describe('多附件路径（CSV）'),
      think: z.boolean().optional().describe('开启深度思考模式'),
      search: z.boolean().optional().describe('开启联网搜索'),
      showSources: z.boolean().optional().describe('显示联网搜索引用的来源 URL 和域名'),
    }),
    result: z.object({ response: z.string(), duration: z.string().optional() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser yuanbao chat "分析这张图" --path /path/to/img.jpg', description: '发送消息+单张图片' },
      { cmd: 'xbrowser yuanbao chat "对比这3张" --paths "/a.jpg,/b.png,/c.jpg"', description: '发送消息+多张图片' },
      { cmd: 'xbrowser yuanbao chat "深度分析" --think', description: '开启深度思考' },
      { cmd: 'xbrowser yuanbao chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
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
            }) as { found: boolean; text?: string; count: number };

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
            }) as { found: boolean; text?: string; count: number };

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

        if (params.path || params.paths) {
          const r = await handleChatAttachments(page, params.path, params.paths, 'image', tips);
          if (!r.ok) return fail(`附件上传未通过校验 (${r.uploaded}/${r.total})`, tips);
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
      } catch {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  site.command('attach', {
    description: '上传附件到当前对话',
    scope: 'browser',
    parameters: z.object({
      path: z.string().optional().describe('单文件路径'),
      paths: z.string().optional().describe('多文件路径（CSV，如 a.jpg,b.pdf）'),
    }).refine((d) => Boolean(d.path) || Boolean(d.paths), {
      message: '必须提供 --path 或 --paths 至少一个',
    }),
    result: z.object({ files: z.array(z.string()), uploaded: z.number() }).passthrough(),
    examples: [
      { cmd: 'xbrowser yuanbao attach --path /path/to/file.pdf', description: '上传单个文件' },
      { cmd: 'xbrowser yuanbao attach --path /path/to/image.png', description: '上传单张图片' },
      { cmd: 'xbrowser yuanbao attach --paths "/a.pdf,/b.png"', description: '批量上传' },
    ],
    handler: async (params, ctx) => {
      const list = [
        ...(params.path ? [params.path] : []),
        ...(params.paths ? params.paths.split(',').map((s) => s.trim()).filter(Boolean) : []),
      ];
      if (list.length === 0) return fail('参数错误', ['--path 或 --paths 至少二选一']);

      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      await ensurePage(page, ctx);
      const tips = buildTips(ctx);

      const r = await batchUploadFiles(page, list);
      if (r.errors.length > 0) tips.push(...r.errors.map((e) => `⚠ ${e}`));
      if (r.uploaded === 0) {
        return fail('上传失败', ['找不到 file input 或上传入口']);
      }
      await page.waitForTimeout(1000);
      tips.push(`✓ 已上传 ${r.uploaded}/${list.length} 个文件`);
      return ok({ files: r.files, uploaded: r.uploaded }, tips);
    },
  });
}
