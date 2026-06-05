import { z } from 'zod';
import type { Page } from '../browser-shim.js';

export type AIEngineKey =
  | 'deepseek' | 'doubao' | 'chatgpt' | 'claude'
  | 'kimi' | 'qianwen' | 'yuanbao' | 'chatglm'
  | 'yiyan' | 'metaso' | 'tiangong' | 'xinghuo'
  | 'hailuo' | '360ai';

export interface EngineConfig {
  key: AIEngineKey;
  name: string;
  url: string;
  login: {
    loggedInSelectors: string[];
    loggedOutSelectors: string[];
    urlIndicators?: string[];
  };
  input: {
    selectors: string[];
    type: 'textarea' | 'contenteditable' | 'search';
  };
  internetSearch: {
    type: 'always' | 'toggle' | 'builtin' | 'unknown';
    toggleSelectors?: string[];
    toggleTexts?: string[];
  };
  upload: {
    image: boolean;
    file: boolean;
  };
  isSearchFirst?: boolean;
  extraWait?: number;
  needsChatNav?: boolean;
  sendMethod: 'enter' | 'button' | 'metaEnter';
  sendButtonSelector?: string;
  apiPattern?: string;
  sourceButtonSelector?: string;
  sourceListSelector?: string;
  navigateOnSend?: boolean;
  skipResponseWait?: boolean;
}

export const ENGINE_CONFIGS: Record<AIEngineKey, EngineConfig> = {
  deepseek: {
    key: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    login: {
      loggedInSelectors: ['nav', '.chat-history', '[class*="history"]'],
      loggedOutSelectors: [],
      urlIndicators: ['/sign_in'],
    },
    input: {
      selectors: ['textarea._27c9245', 'textarea', '#chat-input'],
      type: 'textarea',
    },
    internetSearch: { type: 'toggle', toggleSelectors: ['[class*="search"]'], toggleTexts: ['搜索'] },
    upload: { image: true, file: true },
    sendMethod: 'enter',
    apiPattern: '/chat/completion',
  },
  doubao: {
    key: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat/',
    login: {
      loggedInSelectors: ['[class*="history"]', '[class*="conversation-list"]', 'textarea.semi-input-textarea'],
      loggedOutSelectors: ['[class*="login-dialog"]'],
    },
    input: {
      selectors: ['textarea.semi-input-textarea', 'textarea'],
      type: 'textarea',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: false, file: false },
    extraWait: 8000,
    sendMethod: 'metaEnter',
  },
  chatgpt: {
    key: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chat.openai.com',
    login: {
      loggedInSelectors: ['[data-testid="profile-button"]'],
      loggedOutSelectors: ['button[data-testid="login-button"]'],
      urlIndicators: ['/auth/login'],
    },
    input: {
      selectors: ['#prompt-textarea', '[data-testid="prompt-textarea"]', 'textarea', '[contenteditable="true"]'],
      type: 'textarea',
    },
    internetSearch: { type: 'toggle', toggleTexts: ['Search'] },
    upload: { image: true, file: true },
    sendMethod: 'enter',
  },
  claude: {
    key: 'claude',
    name: 'Claude',
    url: 'https://claude.ai',
    login: {
      loggedInSelectors: ['[data-testid="user-menu"]'],
      loggedOutSelectors: [],
      urlIndicators: ['/login'],
    },
    input: {
      selectors: ['[contenteditable="true"]', 'div[contenteditable]', 'textarea'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'toggle', toggleTexts: ['Search'] },
    upload: { image: true, file: true },
    sendMethod: 'enter',
  },
  kimi: {
    key: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn',
    login: {
      loggedInSelectors: ['.user-avatar', 'img[src*="avatar.moonshot"]'],
      loggedOutSelectors: ['.not-login-container'],
    },
    input: {
      selectors: ['.chat-input-editor', '[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: false, file: false },
    sendMethod: 'enter',
  },
  qianwen: {
    key: 'qianwen',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen',
    login: {
      loggedInSelectors: ['[class*="history"]', '[class*="conversation"]', '[contenteditable="true"]'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: true, file: true },
    extraWait: 8000,
    sendMethod: 'enter',
  },
  yuanbao: {
    key: 'yuanbao',
    name: '腾讯元宝',
    url: 'https://yuanbao.tencent.com/chat/',
    login: {
      loggedInSelectors: ['.yb-common-nav__ft__avatar', '.nick-info-name'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable="true"]'],
      type: 'contenteditable',
    },
    internetSearch: {
      type: 'toggle',
      toggleSelectors: ['.yb-common-nav__tool'],
      toggleTexts: ['搜索'],
    },
    upload: { image: false, file: false },
    sendMethod: 'enter',
  },
  chatglm: {
    key: 'chatglm',
    name: '智谱清言',
    url: 'https://chatglm.cn',
    login: {
      loggedInSelectors: ['.userInfoBar'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['textarea.scroll-display-none', 'textarea'],
      type: 'textarea',
    },
    internetSearch: {
      type: 'toggle',
      toggleSelectors: ['.mode-button'],
      toggleTexts: ['联网'],
    },
    upload: { image: false, file: true },
    sendMethod: 'enter',
    apiPattern: '/chat/completion',
    sourceButtonSelector: '[class*="sources-tab"]',
  },
  yiyan: {
    key: 'yiyan',
    name: '文心一言',
    url: 'https://yiyan.baidu.com',
    login: {
      loggedInSelectors: ['.avatar__jsWTuLHM', '[contenteditable="true"]'],
      loggedOutSelectors: ['.ebButton__Td1lJFbI'],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: false, file: false },
    extraWait: 10000,
    sendMethod: 'enter',
  },
  metaso: {
    key: 'metaso',
    name: '秘塔AI搜索',
    url: 'https://metaso.cn',
    login: {
      loggedInSelectors: ['.MuiAvatar-img', 'img[src*="uranus"]', 'textarea.search-consult-textarea'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['textarea.search-consult-textarea', 'textarea'],
      type: 'textarea',
    },
    internetSearch: { type: 'always' },
    upload: { image: true, file: true },
    isSearchFirst: true,
    sendMethod: 'enter',
    navigateOnSend: true,
  },
  tiangong: {
    key: 'tiangong',
    name: '天工AI',
    url: 'https://www.tiangong.cn',
    login: {
      loggedInSelectors: ['.general-hero__avatar', 'img[src*="skyworkcdn"]', '[contenteditable="true"]'],
      loggedOutSelectors: ['.login-btn'],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: true, file: false },
    needsChatNav: true,
    extraWait: 8000,
    sendMethod: 'enter',
    skipResponseWait: true,
  },
  xinghuo: {
    key: 'xinghuo',
    name: '讯飞星火',
    url: 'https://xinghuo.xfyun.cn',
    login: {
      loggedInSelectors: ['.ant-dropdown-trigger'],
      loggedOutSelectors: ['.header_login_btn__JSZrf'],
    },
    input: {
      selectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'toggle', toggleSelectors: [], toggleTexts: ['搜索'] },
    upload: { image: false, file: false },
    extraWait: 8000,
    needsChatNav: true,
    sendMethod: 'enter',
  },
  hailuo: {
    key: 'hailuo',
    name: '海螺AI',
    url: 'https://hailuoai.com',
    login: {
      loggedInSelectors: [],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable]#video-create-textarea', '[contenteditable="true"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'unknown' },
    upload: { image: true, file: true },
    sendMethod: 'enter',
  },
  '360ai': {
    key: '360ai',
    name: '纳米AI',
    url: 'https://www.n.cn',
    login: {
      loggedInSelectors: ['.avatar-title-icon', 'img[src*="qcdn"]'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'always' },
    upload: { image: false, file: true },
    isSearchFirst: true,
    sendMethod: 'enter',
    sendButtonSelector: 'button.send-btn',
  },
};

export const ALL_ENGINE_KEYS = Object.keys(ENGINE_CONFIGS) as [string, ...string[]];
export const ENGINE_KEY_ENUM = z.enum(ALL_ENGINE_KEYS);

export function getEngineConfig(key: string): EngineConfig | undefined {
  return ENGINE_CONFIGS[key as AIEngineKey];
}

export async function detectLoginStatus(
  page: Page,
  config: EngineConfig,
): Promise<'logged_in' | 'logged_out' | 'unknown'> {
  const url = page.url();

  if (config.login.urlIndicators?.some((u) => url.includes(u))) return 'logged_out';

  for (const sel of config.login.loggedInSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) return 'logged_in';
  }

  for (const sel of config.login.loggedOutSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) return 'logged_out';
  }

  return 'unknown';
}

export async function detectInternetSearch(
  page: Page,
  config: EngineConfig,
): Promise<{ supported: boolean; enabled: boolean; details: string }> {
  if (config.internetSearch.type === 'always') {
    return { supported: true, enabled: true, details: '默认联网（搜索优先型）' };
  }
  if (config.internetSearch.type === 'builtin') {
    return { supported: true, enabled: true, details: '内置联网能力' };
  }
  if (config.internetSearch.type === 'toggle') {
    for (const sel of config.internetSearch.toggleSelectors || []) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const text = await page.locator(sel).first().textContent();
        return { supported: true, enabled: true, details: `有开关: "${text?.trim()}"` };
      }
    }
    if (config.internetSearch.toggleTexts?.length) {
      const bodyText = await page.evaluate<string>(() => document.body?.textContent || '');
      for (const t of config.internetSearch.toggleTexts) {
        if (bodyText.includes(t)) {
          return { supported: true, enabled: false, details: `检测到"${t}"文本但未找到开关元素` };
        }
      }
    }
    return { supported: true, enabled: false, details: '有开关但当前未找到' };
  }
  return { supported: false, enabled: false, details: '未知' };
}

export async function fillContentEditable(page: Page, selector: string, text: string): Promise<boolean> {
  const el = page.locator(selector).first();
  const count = await el.count();
  if (count === 0) return false;

  await el.waitFor({ state: 'visible', timeout: 5000 });
  await el.click();
  await page.waitForTimeout(300);

  // 优先用 keyboard.type（兼容 ProseMirror/TipTap 等富文本框架）
  try {
    await page.keyboard.type(text, { delay: 10 });
    // 验证输入是否生效
    const currentText = await el.evaluate<string>((node: HTMLElement) => node.textContent || '');
    if (currentText.trim().length > 0) return true;
  } catch { /* fallback */ }

  // 兜底：直接设置 textContent（某些简单 contenteditable 可以）
  await el.evaluate((node: HTMLElement, t: string) => {
    node.textContent = t;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
  return true;
}

export interface AISearchResultItem {
  title: string;
  url: string;
  snippet: string;
  position: number;
  aiSummary?: string;
}

export interface DomainExtraction {
  domain: string;
  count: number;
  urls: string[];
  platform?: string;
  engines?: string[];
}

export interface AISearchResult {
  query: string;
  engine: string;
  results: AISearchResultItem[];
  total: number;
  timestamp: number;
  aiResponse?: string;
  sources?: {
    total: number;
    domains: string[];
    urls: Array<{ url: string; domain: string }>;
  };
  domainExtraction?: {
    query: string;
    totalUrls: number;
    totalDomains: number;
    domains: DomainExtraction[];
  };
  engineInfo?: {
    name: string;
    loginStatus: string;
    internetSearch: { supported: boolean; enabled: boolean; details: string };
    uploadCapabilities: { image: boolean; file: boolean };
  };
  duration?: string;
}

export function buildSearchPrompt(query: string, isSearchFirst?: boolean): string {
  if (isSearchFirst) return query;
  return `请联网搜索2025年最新的${query}，要求是今年的最新数据，给出详细排名和分析`;
}

export async function findAndFillInput(page: Page, config: EngineConfig, text: string): Promise<boolean> {
  for (const sel of config.input.selectors) {
    const count = await page.locator(sel).count();
    if (count === 0) continue;
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 5000 });

      if (config.input.type === 'contenteditable') {
        return await fillContentEditable(page, sel, text);
      }

      await el.click();
      await page.waitForTimeout(300);
      await el.fill(text);
      return true;
    } catch {
      continue;
    }
  }

  for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]']) {
    try {
      const count = await page.locator(sel).count();
      if (count === 0) continue;
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 3000 });
      const tag = await el.evaluate<string>((n: Element) => n.tagName.toLowerCase());
      if (tag === 'textarea' || tag === 'input') {
        await el.click();
        await page.waitForTimeout(300);
        await el.fill(text);
      } else {
        await fillContentEditable(page, sel, text);
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function navigateToChat(page: Page, config: EngineConfig): Promise<void> {
  if (!config.needsChatNav) return;

  if (config.key === 'kimi') {
    await page.waitForTimeout(2000);
    const chatLink = page.locator('a[href*="/chat"], a[href*="/dialog"]').first();
    if ((await chatLink.count()) > 0) {
      await chatLink.click();
      await page.waitForTimeout(2000);
    }
  } else if (config.key === 'tiangong') {
    await page.waitForTimeout(3000);
    const chatLinks = await page.evaluate<Array<{ href: string; text: string }>>(() => {
      return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
        .filter(a => a.href.includes('/chat') || a.href.includes('/project'))
        .map(a => ({ href: a.href, text: a.textContent?.trim()?.slice(0, 30) || '' }));
    });
    if (chatLinks.length > 0) {
      await page.goto(chatLinks[0].href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
    } else {
      const newProjectBtn = page.locator('text=新建项目').first();
      if ((await newProjectBtn.count()) > 0) {
        await newProjectBtn.click();
        await page.waitForTimeout(3000);
      }
    }
  } else if (config.key === 'xinghuo') {
    await page.waitForTimeout(3000);
    const startBtn = page.locator('text=开始对话').first();
    if ((await startBtn.count()) > 0) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }
  }
}

export async function waitForAIResponse(page: Page, timeoutMs: number): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < Math.min(timeoutMs, 15000)) {
    await page.waitForTimeout(1000);
    try {
      const state = await page.evaluate<{ hasLoading: boolean; isThinking: boolean }>(() => {
        const body = document.body?.textContent || '';
        const hasLoading = !!document.querySelector(
          '[class*="loading"], [class*="typing"], [class*="spinner"], ' +
          '[class*="skeleton"], [class*="thinking"], [class*="generating"], ' +
          '[class*="stop-button"], [aria-label*="Stop"], ' +
          '[class*="wait"], [class*="typing-indicator"], [class*="streaming"]',
        );
        const isThinking = (
          (body.includes('正在搜索')) ||
          (body.includes('Searching')) ||
          (body.includes('Generating')) ||
          (body.includes('停止生成')) ||
          (body.includes('思考已完成'))
        );
        return { hasLoading, isThinking };
      });

      if (state.hasLoading || state.isThinking) break;
      if (Date.now() - startTime > 5000) break;
    } catch {
      // ignore
    }
  }

  const baselineKeys = await page.evaluate<string[]>(() => {
    const containers = document.querySelectorAll(
      '[class*="markdown"], [class*="message-content"], [class*="message-list"], [class*="response"], ' +
      '[class*="answer"], .prose, article, ' +
      '[class*="segment-assistant"], [class*="chat-content-item-assi"], ' +
      '[class*="assistant-msg"], [class*="bot-message"], [class*="ai-message"]',
    );
    const keys = new Set<string>();
    containers.forEach((el) => {
      const txt = el.textContent?.trim() || '';
      if (txt.length > 20) keys.add(txt.slice(0, 100));
    });
    return Array.from(keys);
  });

  let stableCount = 0;
  let lastResponse = '';

  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(2000);
    try {
      const result = await page.evaluate<{ status: string; text?: string; isNew?: boolean }>((baseline: string[]) => {
        const baseSet = new Set(baseline);

        const loadingEl = document.querySelector(
          '[class*="loading"], [class*="typing"], [class*="spinner"], ' +
          '[class*="skeleton"], [class*="thinking"], ' +
          '[class*="wait"], [class*="streaming"]',
        );
        if (loadingEl) {
          const body = document.body?.textContent || '';
          const isThinking = (
            (body.includes('正在搜索')) ||
            (body.includes('Searching')) ||
            (body.includes('Generating')) ||
            (body.includes('思考中'))
          );
          if (isThinking) return { status: 'processing' };
        }

        const candidates = [
          '[data-message-author-role="assistant"]',
          '[class*="response-message"]',
          '[class*="assistant-message"]',
          '[class*="segment-assistant"]',
          '[class*="chat-content-item-assi"]',
          '[class*="assistant-msg"]',
          '[class*="bot-message"]',
          '[class*="ai-message"]',
          '[class*="answer-text"]',
          '[class*="message-list"]',
        ];

        for (const sel of candidates) {
          const els = document.querySelectorAll(sel);
          let bestText = '';
          for (let i = 0; i < els.length; i++) {
            const txt = els[i].textContent?.trim() || '';
            if (txt.length > 50 && !baseSet.has(txt.slice(0, 100)) && txt.length > bestText.length) {
              bestText = txt;
            }
          }
          if (bestText) return { status: 'ready', text: bestText.slice(0, 5000), isNew: true };
        }

        const allContainers = document.querySelectorAll(
          '[class*="markdown"], [class*="message-content"], [class*="message-list"], [class*="answer"], .prose',
        );

        let bestFallbackText = '';
        for (let i = 0; i < allContainers.length; i++) {
          const txt = allContainers[i].textContent?.trim() || '';
          if (txt.length > 50 && !baseSet.has(txt.slice(0, 100)) && txt.length > bestFallbackText.length) {
            bestFallbackText = txt;
          }
        }
        if (bestFallbackText) return { status: 'ready', text: bestFallbackText.slice(0, 5000), isNew: true };

        return { status: 'waiting' };
      }, baselineKeys);

      if (result.status === 'processing') {
        stableCount = 0;
        lastResponse = '';
        continue;
      }

      if (result.status === 'ready' && result.text) {
        if (result.text === lastResponse) {
          stableCount++;
          if (stableCount >= 3) return result.text;
        } else {
          lastResponse = result.text;
          stableCount = 1;
        }

        if (Date.now() - startTime > 20000 && stableCount >= 2) {
          return result.text;
        }
      }
    } catch {
      stableCount = 0;
    }
  }

  return lastResponse;
}

export function parseMarkdownResults(rawText: string): AISearchResultItem[] {
  const results: AISearchResultItem[] = [];

  const jsonMatch = rawText.match(/(?:```json\s*)?(\[[\s\S]*?\])(?:\s*```)?/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].replace(/,\s*]/g, ']'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.title && item.url && item.snippet) {
            results.push({
              title: String(item.title).trim(),
              url: String(item.url).trim(),
              snippet: String(item.snippet).trim().replace(/\n/g, ' ').slice(0, 300),
              position: results.length + 1,
            });
          }
        }
        if (results.length > 0) return results;
      }
    } catch { /* not valid JSON */ }
  }

  const patterns = [
    /(?:^|\n)\s*##\s*\d+[\.\s]+\[([^\]]+)\]\(([^)]+)\)\s*\n\s*>\s*([\s\S]+?)(?=\n\s*(?:##\d|$))/g,
    /(?:^|\n)\s*###?\s*\d+[\.\s]+\[([^\]]+)\]\(([^)]+)\)\s*\n\s*>\s*([\s\S]+?)(?=\n\s*(?:###?\d|$))/g,
    /(?:^|\n)\s*[\-\*]\s*\[([^\]]+)\]\(([^)]+)\)[\:\：]\s*([\s\S]+?)(?=(?:\n\s*[\-\*]|\n\n|\n$|$))/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(rawText)) !== null) {
      const title = match[1].trim();
      const url = match[2].trim();
      const snippet = match[3].trim().replace(/\n/g, ' ').slice(0, 300);
      if (title && url && snippet) {
        results.push({ title, url, snippet, position: results.length + 1 });
      }
    }
    if (results.length > 0) return results;
  }

  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = linkPattern.exec(rawText)) !== null) {
    const title = match[1].trim();
    const url = match[2].trim();
    if (!seen.has(url) && title && url.startsWith('http')) {
      seen.add(url);
      const before = rawText.slice(Math.max(0, match.index - 150), match.index);
      const after = rawText.slice(match.index + match[0].length, match.index + match[0].length + 200);
      const snippet = (before.split('\n').pop()?.replace(/^>\s*/, '').trim() || '')
        + ' ' + (after.split('\n')[0]?.replace(/^>|\*\s*/, '').trim() || '');
      results.push({ title, url, snippet: snippet.replace(/\n/g, ' ').slice(0, 300), position: results.length + 1 });
    }
  }

  if (results.length === 0) {
    const lines = rawText.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const urlMatch = line.match(/https?:\/\/[^\s\)\]\"']+/);
      if (urlMatch) {
        const url = urlMatch[0];
        const rest = line.replace(url, '').replace(/[#\-\*>`\[\]]/g, '').trim();
        const title = rest.slice(0, 100) || 'Untitled';
        results.push({ title, url, snippet: rest.slice(0, 200), position: results.length + 1 });
      }
    }
  }

  return results;
}
