/**
 * AI 聊天站点通用 Engine（Phase 2）。
 *
 * 一份 AIChatSiteConfig → 自动注册 list/new/open/chat/attach/check-login 命令。
 * 新增站点只需写 config，不需要手写任何命令逻辑。
 *
 * 详见 docs/ai-chat-plugin-spec.md
 *
 * 用法：
 *   export default function(xcli: XCLIAPI) {
 *     registerAIChatSite(xcli, deepseekConfig);
 *   }
 */
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import type { Page } from '../types.js';
import {
  AIChatSiteConfig,
  listConversations,
  openByTitle,
  sendChatMessage,
  extractReply,
  ensureChatPage,
  uploadAttachment,
} from './ai-chat-commands.js';

type XCLIPage = Page;

/**
 * 根据 config 注册一个 AI 聊天站点的所有标准命令。
 */
export function registerAIChatSite(xcli: XCLIAPI, config: AIChatSiteConfig): void {
  const site = xcli.createSite({
    name: config.name,
    url: config.url,
    description: config.description || `${config.name} AI 聊天`,
    requiresLogin: true,
    isLogin: async (ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return false;
      try {
        const result = await page.evaluate(({ loggedInSels, loggedOutPatterns, loggedInPatterns }) => {
          const bodyText = (document.body?.textContent || '').trim().slice(0, 500);
          if (loggedInSels?.length) {
            for (const sel of loggedInSels) { if (document.querySelector(sel)) return true; }
          }
          if (loggedOutPatterns?.length) {
            if (loggedOutPatterns.every((w: string) => bodyText.includes(w))) return false;
          }
          if (loggedInPatterns?.length) {
            return loggedInPatterns.some((w: string) => bodyText.includes(w));
          }
          return true;
        }, {
          loggedInSels: config.loggedInSelectors,
          loggedOutPatterns: config.loggedOutTextPatterns,
          loggedInPatterns: config.loggedInTextPatterns,
        });
        return !!result;
      } catch { return false; }
    },
  });

  // ── check-login ──
  site.command('check-login', {
    description: `检查${config.name}登录状态`,
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ loggedIn: z.boolean(), url: z.string().optional() }).passthrough(),
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail({ message: '需要浏览器页面' });
      const loggedIn = await site.isLoggedIn();
      return ok({ data: { loggedIn, url: page.url() } }, [`登录状态: ${loggedIn ? '✅ 已登录' : '❌ 未登录'}`]);
    },
  });

  // ── list ──
  site.command('list', {
    description: '列出所有历史会话',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({}),
    result: z.array(z.object({ index: z.number(), title: z.string(), url: z.string() }).passthrough()),
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as XCLIPage;
      if (!page) return fail('需要浏览器页面', []);
      await ensureChatPage(page, ctx, config);
      await page.waitForTimeout(1500);
      const conversations = await listConversations(page, config.historySelector);
      return ok(conversations, [`共 ${conversations.length} 个会话`]);
    },
  });

  // ── new ──
  site.command('new', {
    description: '创建新的空白对话',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({}),
    result: z.object({ created: z.boolean() }).passthrough(),
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as XCLIPage;
      if (!page) return fail('需要浏览器页面', []);
      await ensureChatPage(page, ctx, config);
      // 点"新对话"按钮或直接 goto 首页
      await page.evaluate(() => {
        const btn = document.querySelector('[class*="new-conversation"], [class*="new-chat"], [data-testid*="new"], a[href*="/chat"], [class*="create"]');
        (btn as HTMLElement | null)?.click();
      }).catch(() => {});
      await page.waitForTimeout(1500);
      return ok({ created: true }, ['已创建新对话']);
    },
  });

  // ── open ──
  site.command('open', {
    description: '通过标题打开指定会话（模糊匹配）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      title: z.string().describe('会话标题（支持模糊匹配）'),
    }),
    result: z.object({ opened: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as XCLIPage;
      if (!page) return fail('需要浏览器页面', []);
      await ensureChatPage(page, ctx, config);
      await page.waitForTimeout(1000);
      const result = await openByTitle(page, params.title, config.historySelector);
      if (!result.found) return fail(`未找到包含"${params.title}"的会话`, []);
      return ok({ opened: result.title }, [`已打开会话：${result.title}`]);
    },
  });

  // ── chat ──
  const chatParams: Record<string, z.ZodTypeAny> = {
    message: z.string().describe('消息内容'),
    path: z.string().optional().describe('单附件路径'),
    paths: z.string().optional().describe('多附件路径（CSV）'),
    think: z.boolean().optional().describe('开启深度思考'),
    search: z.boolean().optional().describe('开启联网搜索'),
    showSources: z.boolean().optional().describe('显示搜索来源'),
  };

  site.command('chat', {
    description: '发送消息并等待 AI 回复',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object(chatParams),
    result: z.object({ response: z.string(), duration: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as XCLIPage;
      if (!page) return fail('需要浏览器页面', []);
      const cdp = (ctx as unknown as Record<string, unknown>).cdpEndpoint as string | undefined;
      try {
        await ensureChatPage(page, ctx, config);
        await page.waitForTimeout(2000);

        // 上传附件
        if (params.path || params.paths) {
          const list = [
            ...(params.path ? [params.path] : []),
            ...(params.paths ? params.paths.split(',').map(s => s.trim()).filter(Boolean) : []),
          ];
          const r = await uploadAttachment(page, list, config);
          if (r.uploaded === 0) return fail('附件上传失败', r.errors);
        }

        // 输入 + 发送
        await sendChatMessage(page, params.message, config);

        // 等页面稳定 + 提取回复
        await page.waitForTimeout(2000);
        const replyConfig = {
          ...config,
          cdpEndpoint: cdp,
        };
        const responseText = await extractReply(page, params.message, replyConfig);
        if (responseText) {
          return ok({ response: responseText }, ['消息已发送，等待 AI 回复...', 'AI 回复已收到']);
        }
        return ok({ response: '' }, ['消息已发送', 'AI 回复超时或未检测到']);
      } catch {
        return fail('未知错误', ['发送消息失败']);
      }
    },
  });

  // ── attach ──
  site.command('attach', {
    description: '上传附件（图片/文件）',
    requiresLogin: true,
    scope: 'browser',
    parameters: z.object({
      path: z.string().optional().describe('单文件路径'),
      paths: z.string().optional().describe('多文件路径（CSV）'),
    }).refine(d => d.path || d.paths, { message: '--path 或 --paths 至少二选一' }),
    result: z.object({ uploaded: z.boolean(), files: z.array(z.string()) }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as XCLIPage;
      if (!page) return fail('需要浏览器页面', []);
      await ensureChatPage(page, ctx, config);
      const list = [
        ...(params.path ? [params.path] : []),
        ...(params.paths ? params.paths.split(',').map(s => s.trim()).filter(Boolean) : []),
      ];
      const r = await uploadAttachment(page, list, config);
      if (r.uploaded === 0) return fail('上传失败', r.errors);
      return ok({ uploaded: true, files: list }, [`✓ 已上传 ${r.uploaded}/${list.length} 个文件`]);
    },
  });
}
