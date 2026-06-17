import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import { buildTips, batchUploadFiles, handleChatAttachments, checkLoginStatus } from '../shared/ai-chat-base.js';
import { smartExtractReply } from '../shared/smart-extract.js';

type Page = import('../types').Page;

const SITE_URL = 'https://www.qianwen.com';

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
      }) as boolean;
      if (!hasInput) {
        const bodyText = (await page.evaluate(() => document.body?.textContent?.trim().slice(0, 300) || '')) as string;
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

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'qianwen',
    url: SITE_URL,
    description: '通义千问 (Qianwen) — 会话管理、消息发送、附件上传',
    requiresLogin: true,
    isLogin: async (ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
        // No page or blank page — assume logged in, handler will navigate
        if (!page) return true;
        const url = page.url();
        if (!url || url === 'about:blank' || url === '') return true;
        if (url.includes('/login') || url.includes('/auth') || url.includes('/passport')) return false;
        const input = await page.evaluate(() => {
          return !!document.querySelector('div[role="textbox"][contenteditable="true"]');
        }) as boolean;
        return input;
      } catch {
        return true;
      }
    },
  });

  // ═══════════════════════════════════════════════════
  //  0. check-login — 检查是否已登录
  // ═══════════════════════════════════════════════════
  site.command('check-login', {
    description: '检查通义千问登录状态',
    parameters: z.object({}),
    requiresLogin: false,
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail({ message: '需要浏览器页面' });
      const result = await checkLoginStatus(page, SITE_URL, {
        loginUrlPatterns: ['/login', '/auth', '/passport'],
        loggedInSelectors: ['div[role="textbox"][contenteditable="true"]'],
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
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({}),
    result: z.array(z.object({ index: z.number(), title: z.string(), url: z.string() }).passthrough()),
    examples: [
      { cmd: 'xbrowser qianwen list', description: '列出所有会话' },
      { cmd: 'xbrowser qianwen list --json', description: 'JSON 格式输出' },
    ],
    handler: async (_params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);
        await page.waitForTimeout(1500);

        const conversations = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/chat/"], [class*="conversation"] a, [class*="session"] a');
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
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ created: z.boolean() }).passthrough(),
    examples: [
      { cmd: 'xbrowser qianwen new', description: '新建对话' },
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
        return ok({ created: true }, buildTips(ctx));
      } catch {
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
      { cmd: 'xbrowser qianwen open "工作计划"', description: '打开指定会话' },
      { cmd: 'xbrowser qianwen open "代码"', description: '模糊匹配打开' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
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
    description: '发送消息并等待 AI 回复',
    loginRequired: 'required',
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
      { cmd: 'xbrowser qianwen chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser qianwen chat "分析这张图" --path /path/to/img.jpg', description: '发送消息+单张图片' },
      { cmd: 'xbrowser qianwen chat "对比这3张" --paths "/a.jpg,/b.png,/c.jpg"', description: '发送消息+多张图片' },
      { cmd: 'xbrowser qianwen chat "深度分析" --think', description: '开启深度思考' },
      { cmd: 'xbrowser qianwen chat "最新新闻" --search --showSources', description: '联网搜索+来源' },
    ],
    handler: async (params, ctx) => {
      try {
        const page = ctx.page;
        if (!page) throw new Error('需要浏览器页面');
        await ensurePage(page, ctx);
        await page.waitForTimeout(3000);
        const tips = buildTips(ctx);

        if (params.think) {
          const thinkToggled = await page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              const text = el.textContent?.trim() || '';
              if ((text === '深度思考' || text === '思考' || text.includes('Think'))
                  && el.children.length <= 3 && (el as HTMLElement).offsetParent !== null) {
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
                  && el.children.length <= 3 && (el as HTMLElement).offsetParent !== null) {
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

        if (params.path || params.paths) {
          const r = await handleChatAttachments(page, params.path, params.paths, 'image', tips);
          if (!r.ok) return fail(`附件上传未通过校验 (${r.uploaded}/${r.total})`, tips);
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
          // selector 提取失败，用大模型分析 snapshot 兜底
          tips.push('⚠ 回复提取失败，尝试用 AI 分析页面快照...');
          const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint as string | undefined;
          const smartReply = await smartExtractReply(page, params.message, 'qianwen 聊天页，用户发了消息等待 AI 回复', cdp).catch(() => null);
          if (smartReply) {
            tips.push('✓ AI 快照分析成功');
            return ok({ response: smartReply }, tips);
          }
          tips.push('AI 回复超时或未检测到');
          return ok({ response: '' }, tips);
        }
      } catch {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  site.command('attach', {
    description: '上传附件（图片或文件）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      path: z.string().optional().describe('单文件路径'),
      paths: z.string().optional().describe('多文件路径（CSV，如 a.jpg,b.pdf）'),
    }).refine((d) => Boolean(d.path) || Boolean(d.paths), {
      message: '必须提供 --path 或 --paths 至少一个',
    }),
    result: z.object({ files: z.array(z.string()), uploaded: z.number() }).passthrough(),
    examples: [
      { cmd: 'xbrowser qianwen attach --path /path/to/img.jpg', description: '上传单张图片' },
      { cmd: 'xbrowser qianwen attach --path /path/to/doc.pdf', description: '上传单个文件' },
      { cmd: 'xbrowser qianwen attach --paths "/a.jpg,/b.pdf,/c.png"', description: '批量上传多个附件' },
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
      await page.waitForTimeout(500);
      const tips = buildTips(ctx);

      const r = await batchUploadFiles(page, list);
      if (r.errors.length > 0) tips.push(...r.errors.map((e) => `⚠ ${e}`));
      if (r.uploaded === 0) {
        return fail('上传失败', ['找不到 file input']);
      }
      await page.waitForTimeout(1000);
      tips.push(`✓ 已上传 ${r.uploaded}/${list.length} 个文件`);
      return ok({ files: r.files, uploaded: r.uploaded }, tips);
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint;
    const sessionId = (ctx as unknown as Record<string, unknown>).sessionId as string | undefined;

    if (cdp && page) {
      await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const loggedIn = await site.isLoggedIn().catch(() => false);
      if (loggedIn) {
        console.log('✅ CDP 浏览器已登录通义千问');
        return;
      }
    }

    if (sessionId || cdp) {
      console.log('');
      console.log('🔑 请使用 Viewer 在浏览器中登录通义千问:');
      console.log('   1. 打开 Viewer（实时查看浏览器画面）:');
      console.log(`      xbrowser viewer --session ${sessionId || 'default'}`);
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
      console.log('      xbrowser viewer --session qw-login');
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
