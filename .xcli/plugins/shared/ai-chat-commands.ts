/**
 * AI 聊天插件通用命令实现（Phase 1 共享函数）。
 *
 * 目标：把 5 个 AI 聊天插件（chatgpt/deepseek/doubao/qianwen/yuanbao）里
 * 重复的 list/open/new/ensurePage/send/extractReply/uploadAttachment 逻辑抽出来，
 * 通过 config 参数化 selector 差异。
 *
 * 详见 docs/ai-chat-plugin-spec.md
 */
import type { Page } from '../types.js';
import { smartExtractReply } from './smart-extract.js';

// ─── 类型定义 ───────────────────────────────────────────────

/** 站点级配置（最小版，Phase 1 只含 list/open/send/reply 需要的字段） */
export interface AIChatSiteConfig {
  name: string;
  url: string;
  /** 历史对话链接 selector（如 'a[href*="/a/chat/s/"]'） */
  historySelector: string;
  /** 输入框 selector */
  inputSelector: string;
  /** 发送方式 */
  sendMethod: 'enter' | 'click';
  /** 发送按钮 selector（sendMethod='click' 时必填） */
  sendButtonSelector?: string;
  /** keyboard.type delay（ms） */
  typeDelay?: number;
  /** 回复提取 selector（按优先级） */
  replySelectors: string[];
  /** 生成中判断词（body 含这些词 = 还在生成，跳过本轮提取） */
  generatingIndicators?: string[];
  /** 轮询间隔 ms */
  pollInterval?: number;
  /** 轮询超时 ms */
  pollTimeout?: number;
  /** 超时后是否用 smartExtractReply 兜底 */
  smartFallback?: boolean;
  /** CDP endpoint（smartFallback 用） */
  cdpEndpoint?: string;
}

// ─── 1. listConversations ──────────────────────────────────

/**
 * 列出历史对话（5 个插件逻辑完全一致，只差 historySelector）。
 */
export async function listConversations(
  page: Page,
  historySelector: string,
): Promise<{ index: number; title: string; url: string }[]> {
  return await page.evaluate((sel: string) => {
    const links = document.querySelectorAll(sel);
    return Array.from(links).map((a, i) => ({
      index: i,
      title: (a.textContent || '').trim(),
      url: (a as HTMLAnchorElement).href,
    })).filter(c => c.title.length > 0);
  }, historySelector).catch(() => []) as Promise<{ index: number; title: string; url: string }[]>;
}

// ─── 2. openByTitle ────────────────────────────────────────

/**
 * 按标题模糊匹配打开历史对话（点链接让 SPA 路由跳转）。
 */
export async function openByTitle(
  page: Page,
  title: string,
  historySelector: string,
): Promise<{ found: boolean; title: string }> {
  const result = await page.evaluate(({ sel, searchTitle }) => {
    const links = document.querySelectorAll(sel);
    for (const link of links) {
      const text = (link.textContent || '').trim();
      if (text.toLowerCase().includes(searchTitle.toLowerCase())) {
        (link as HTMLAnchorElement).click();
        return { found: true, title: text };
      }
    }
    return { found: false, title: '' };
  }, { sel: historySelector, searchTitle: title }).catch(() => ({ found: false, title: '' })) as { found: boolean; title: string };

  if (result.found) {
    await page.waitForTimeout(2000).catch(() => {});
  }
  return result;
}

// ─── 3. sendChatMessage ────────────────────────────────────

/**
 * 输入消息 + 发送（统一 keyboard.type + Enter/click）。
 * cdp-tunnel Input 转发 bug 已修复，keyboard.type + Enter 正常工作。
 */
export async function sendChatMessage(
  page: Page,
  message: string,
  config: Pick<AIChatSiteConfig, 'inputSelector' | 'sendMethod' | 'sendButtonSelector' | 'typeDelay'>,
): Promise<void> {
  // 聚焦 + 逐字输入
  await page.locator(config.inputSelector).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.type(message, { delay: config.typeDelay ?? 10 });
  await page.waitForTimeout(400);

  // 发送
  if (config.sendMethod === 'click' && config.sendButtonSelector) {
    await page.click(config.sendButtonSelector, { timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press('Enter');
  }
}

// ─── 4. extractReply ───────────────────────────────────────

/**
 * 轮询提取 AI 回复（统一逻辑 + smart 兜底）。
 *
 * 策略：每轮先检查 generatingIndicators（还在生成就跳过），
 * 再按 replySelectors 优先级取最后一个非空文本。
 * 超时后若 smartFallback=true，用 deepseek 分析 snapshot 兜底。
 */
export async function extractReply(
  page: Page,
  userMessage: string,
  config: Pick<AIChatSiteConfig, 'replySelectors' | 'generatingIndicators' | 'pollInterval' | 'pollTimeout' | 'smartFallback' | 'cdpEndpoint' | 'name'>,
): Promise<string> {
  const interval = config.pollInterval ?? 1500;
  const timeout = config.pollTimeout ?? 60000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    await page.waitForTimeout(interval);
    try {
      const text = await page.evaluate(({ selectors, indicators, userMsg }) => {
        const pageTxt = document.body.textContent || '';
        // 还在生成 → 跳过本轮
        if (indicators?.some(w => pageTxt.includes(w))) return '';
        // 按优先级取最后一个非空
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          for (let i = els.length - 1; i >= 0; i--) {
            const txt = (els[i].textContent || '').trim();
            if (txt.length > 0 && !txt.includes(userMsg)) return txt.slice(0, 8000);
          }
        }
        return '';
      }, { selectors: config.replySelectors, indicators: config.generatingIndicators, userMsg: userMessage }).catch(() => '');

      if (text) return text;
    } catch {
      // continue polling
    }
  }

  // 超时兜底
  if (config.smartFallback) {
    const smart = await smartExtractReply(
      page,
      userMessage,
      `${config.name} 聊天页，用户发了消息等待 AI 回复`,
      config.cdpEndpoint,
    ).catch(() => null);
    if (smart) return smart;
  }

  return '';
}

