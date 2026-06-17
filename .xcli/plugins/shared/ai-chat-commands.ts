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
import type { CommandContext } from '@dyyz1993/xcli-core';
import * as path from 'path';
import * as fs from 'fs';
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

  // ── 登录检测 ──
  /** 已登录标志：body 含这些词的任一个 = 已登录（如 ['深度思考', '豆包']） */
  loggedInTextPatterns?: string[];
  /** 未登录标志：body 同时含这些词 = 未登录（如 ['登录', '注册']） */
  loggedOutTextPatterns?: string[];
  /** 已登录 selector（存在即已登录，如 ['#prompt-textarea']） */
  loggedInSelectors?: string[];

  // ── 附件上传 ──
  /** 附件上传方式 */
  attachMethod?: 'setInputFiles' | 'pasteFiles' | 'triggerButton';
  /** file input selector（attachMethod='setInputFiles'/'triggerButton' 时） */
  fileInputSelector?: string;
  /** editor selector（attachMethod='pasteFiles' 时） */
  editorSelector?: string;
  /** 上传后等此元素消失（如 '.ds-loading'） */
  waitLoadingSelector?: string;
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

// ─── 5. ensureChatPage ─────────────────────────────────────

/**
 * 确保在正确的页面 + 检查登录态（统一 ensurePage）。
 *
 * 登录检测逻辑：
 * 1. 如果 loggedInSelectors 存在 → 检查 DOM 是否有这些元素
 * 2. 如果 loggedOutTextPatterns 存在 → body 同时含这些词 = 未登录
 * 3. 如果 loggedInTextPatterns 存在 → body 含任一词 = 已登录
 */
export async function ensureChatPage(
  page: Page,
  ctx: CommandContext | undefined,
  config: Pick<AIChatSiteConfig, 'url' | 'name' | 'loggedInSelectors' | 'loggedOutTextPatterns' | 'loggedInTextPatterns'>,
): Promise<void> {
  if (!page.url().startsWith(config.url)) {
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // 登录检测（仅首次，缓存到 ctx）
  if (ctx) {
    const ctxObj = ctx as unknown as Record<string, unknown>;
    if (!ctxObj.__loginChecked) {
      ctxObj.__loginChecked = true;
      const result = await page.evaluate(({ loggedInSels, loggedOutPatterns, loggedInPatterns }) => {
        const bodyText = (document.body?.textContent || '').trim().slice(0, 500);
        // 优先用 selector
        if (loggedInSels?.length) {
          for (const sel of loggedInSels) {
            if (document.querySelector(sel)) return { loggedIn: true };
          }
        }
        // 未登录词组（全部匹配才算未登录）
        if (loggedOutPatterns?.length) {
          const allMatch = loggedOutPatterns.every(w => bodyText.includes(w));
          if (allMatch) return { loggedIn: false };
        }
        // 已登录词（任一匹配）
        if (loggedInPatterns?.length) {
          const anyMatch = loggedInPatterns.some(w => bodyText.includes(w));
          return { loggedIn: anyMatch };
        }
        return { loggedIn: true }; // 无配置默认已登录
      }, {
        loggedInSels: config.loggedInSelectors,
        loggedOutPatterns: config.loggedOutTextPatterns,
        loggedInPatterns: config.loggedInTextPatterns,
      }).catch(() => ({ loggedIn: true })) as { loggedIn: boolean };

      if (!result.loggedIn) {
        throw new Error(`${config.name} 未登录！请先在浏览器中登录，或运行: xbrowser ${config.name} login`);
      }
    }
  }
}

// ─── 6. uploadAttachment ───────────────────────────────────

/**
 * 统一附件上传（三种方式）：
 * - setInputFiles：直接注入到 input[type=file]（deepseek/doubao）
 * - pasteFiles：粘贴到 contenteditable editor（yuanbao）
 * - triggerButton：先点触发按钮挂载 file input，再 setInputFiles（doubao）
 */
export async function uploadAttachment(
  page: Page,
  filePaths: string[],
  config: Pick<AIChatSiteConfig, 'attachMethod' | 'fileInputSelector' | 'editorSelector' | 'waitLoadingSelector'>,
): Promise<{ uploaded: number; errors: string[] }> {
  const errors: string[] = [];
  const absPaths = filePaths.map(fp => path.resolve(fp));
  const valid = absPaths.filter(fp => {
    if (!fs.existsSync(fp)) { errors.push(`文件不存在: ${fp}`); return false; }
    return true;
  });
  if (valid.length === 0) return { uploaded: 0, errors };

  const method = config.attachMethod || 'setInputFiles';

  // 构造文件 payload
  const payloads = valid.map(fp => {
    const buf = fs.readFileSync(fp);
    const ext = path.extname(fp).toLowerCase();
    const mime: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    };
    return { name: path.basename(fp), mimeType: mime[ext] || 'application/octet-stream', buffer: buf };
  });

  try {
    if (method === 'pasteFiles' && config.editorSelector) {
      // 粘贴方式：构造 ClipboardEvent + DataTransfer
      const base64Files = payloads.map(p => ({
        name: p.name, mime: p.mimeType, base64: p.buffer.toString('base64'),
      }));
      await page.evaluate(({ sel, files }) => {
        const editor = document.querySelector(sel) as HTMLElement | null;
        if (!editor) return;
        editor.focus();
        for (const f of files) {
          const binary = atob(f.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: f.mime });
          const fileObj = new File([blob], f.name, { type: f.mime });
          const dt = new DataTransfer();
          dt.items.add(fileObj);
          editor.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true, cancelable: true, clipboardData: dt,
          }));
        }
      }, { sel: config.editorSelector, files: base64Files }).catch(() => {});

    } else {
      // setInputFiles / triggerButton 方式
      if (method === 'triggerButton') {
        // 先点输入框左侧触发按钮，挂载 file input
        const coord = await page.evaluate(() => {
          const ed = document.querySelector('[contenteditable="true"],[role="textbox"],textarea');
          if (!ed) return null;
          const er = ed.getBoundingClientRect();
          const btns: HTMLElement[] = [];
          document.querySelectorAll('button').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0) return;
            if (r.x < er.x && Math.abs(r.y - er.y) < 100) btns.push(el as HTMLElement);
          });
          if (btns.length === 0) return null;
          const r = btns[0].getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (coord) {
          await page.mouse.click(coord.x, coord.y).catch(() => {});
          await page.waitForTimeout(500);
        }
      }
      // 等 file input 挂载
      await page.waitForSelector(config.fileInputSelector || 'input[type="file"]', { timeout: 5000 }).catch(() => {});
      // 注入文件
      const p = page as unknown as { setInputFiles?: (s: string, f: unknown[]) => Promise<void> };
      if (p.setInputFiles) {
        await p.setInputFiles(config.fileInputSelector || 'input[type="file"]', payloads);
      } else {
        errors.push('page.setInputFiles 不可用');
        return { uploaded: 0, errors };
      }
    }

    // 等待 loading 消失
    if (config.waitLoadingSelector) {
      for (let i = 0; i < 30; i++) {
        const loading = await page.evaluate((sel: string) => !!document.querySelector(sel), config.waitLoadingSelector).catch(() => false);
        if (!loading) break;
        await page.waitForTimeout(500).catch(() => {});
      }
    } else {
      await page.waitForTimeout(2000).catch(() => {});
    }

    return { uploaded: valid.length, errors };
  } catch (e) {
    errors.push(`上传失败: ${(e as Error).message}`);
    return { uploaded: 0, errors };
  }
}
