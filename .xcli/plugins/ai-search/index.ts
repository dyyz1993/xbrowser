import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import { z } from 'zod';

interface AISearchResultItem {
  title: string;
  url: string;
  snippet: string;
  position: number;
  aiSummary?: string;
}

interface DomainExtraction {
  domain: string;
  count: number;
  urls: string[];
  platform?: string;
  engines?: string[];
}

interface AISearchResult {
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

interface AggregatedResult {
  query: string;
  totalEngines: number;
  successEngines: number;
  failedEngines: number;
  totalUrls: number;
  uniqueDomains: number;
  domainRanking: Array<{
    domain: string;
    platform?: string;
    totalCount: number;
    engineCount: number;
    engines: Array<{ engine: string; count: number }>;
    urls: string[];
  }>;
  platformRanking: Array<{
    platform: string;
    totalCount: number;
    engines: string[];
  }>;
  engineDetails: Array<{
    engine: string;
    name: string;
    success: boolean;
    urlCount: number;
    domainCount: number;
    duration?: string;
    error?: string;
  }>;
  perEngineResults: Map<string, AISearchResult>;
}

const PLATFORM_SUFFIX_MAP: Array<{ suffix: string; name: string }> = [
  { suffix: 'zhihu.com', name: '知乎' },
  { suffix: 'juejin.cn', name: '掘金' },
  { suffix: 'juejin.im', name: '掘金' },
  { suffix: 'csdn.net', name: 'CSDN' },
  { suffix: 'mp.weixin.qq.com', name: '微信公众号' },
  { suffix: 'weixin.qq.com', name: '微信' },
  { suffix: 'toutiao.com', name: '今日头条' },
  { suffix: 'douyin.com', name: '抖音' },
  { suffix: 'xiaohongshu.com', name: '小红书' },
  { suffix: 'bilibili.com', name: 'B站' },
  { suffix: 'weibo.com', name: '微博' },
  { suffix: 'weibo.cn', name: '微博' },
  { suffix: '36kr.com', name: '36氪' },
  { suffix: 'ithome.com', name: 'IT之家' },
  { suffix: 'sspai.com', name: '少数派' },
  { suffix: 'baijiahao.baidu.com', name: '百家号' },
  { suffix: 'sohu.com', name: '搜狐号' },
  { suffix: '163.com', name: '网易号' },
  { suffix: 'segmentfault.com', name: '思否' },
  { suffix: 'cnblogs.com', name: '博客园' },
  { suffix: 'jianshu.com', name: '简书' },
  { suffix: '51cto.com', name: '51CTO' },
  { suffix: 'oschina.net', name: '开源中国' },
  { suffix: 'infoq.cn', name: 'InfoQ 中文' },
  { suffix: 'infoq.com', name: 'InfoQ' },
  { suffix: 'mp.toutiao.com', name: '今日头条号' },
  { suffix: 'cloud.tencent.com', name: '腾讯云社区' },
  { suffix: 'tencent.com', name: '腾讯' },
  { suffix: 'developer.aliyun.com', name: '阿里云开发者社区' },
  { suffix: 'aliyun.com', name: '阿里云' },
  { suffix: 'huaweicloud.com', name: '华为云社区' },
  { suffix: 'qianfan.cloud.baidu.com', name: '百度千帆社区' },
  { suffix: 'aistudio.baidu.com', name: '百度 AI Studio' },
  { suffix: 'baidu.com', name: '百度' },
  { suffix: 'thepaper.cn', name: '澎湃新闻' },
  { suffix: 'guancha.cn', name: '观察者网' },
  { suffix: 'ifeng.com', name: '凤凰网' },
  { suffix: 'qq.com', name: '腾讯网' },
  { suffix: 'sina.com.cn', name: '新浪' },
  { suffix: 'chinaz.com', name: '站长之家' },
  { suffix: 'iteye.com', name: 'ITEye' },
  { suffix: 'cnbeta.com', name: 'cnBeta' },
  { suffix: 'freebuf.com', name: 'FreeBuf' },
  { suffix: 'ruanyifeng.com', name: '阮一峰博客' },
  { suffix: 'phodal.com', name: 'Phodal 博客' },
  { suffix: 'aibook.ren', name: 'AI Book' },
  { suffix: 'manus.im', name: 'Manus' },
  { suffix: 'aider.chat', name: 'Aider' },
  { suffix: 'medium.com', name: 'Medium' },
  { suffix: 'dev.to', name: 'DEV' },
  { suffix: 'reddit.com', name: 'Reddit' },
  { suffix: 'youtube.com', name: 'YouTube' },
  { suffix: 'tiktok.com', name: 'TikTok' },
  { suffix: 'twitter.com', name: 'Twitter/X' },
  { suffix: 'x.com', name: 'X' },
  { suffix: 'linkedin.com', name: 'LinkedIn' },
  { suffix: 'facebook.com', name: 'Facebook' },
  { suffix: 'instagram.com', name: 'Instagram' },
  { suffix: 'quora.com', name: 'Quora' },
  { suffix: 'producthunt.com', name: 'Product Hunt' },
  { suffix: 'hackernews.com', name: 'Hacker News' },
  { suffix: 'news.ycombinator.com', name: 'Hacker News' },
  { suffix: 'stackshare.io', name: 'StackShare' },
  { suffix: 'substack.com', name: 'Substack' },
  { suffix: 'hashnode.dev', name: 'Hashnode' },
  { suffix: 'dzone.com', name: 'DZone' },
  { suffix: 'techcrunch.com', name: 'TechCrunch' },
  { suffix: 'theverge.com', name: 'The Verge' },
  { suffix: 'wired.com', name: 'Wired' },
  { suffix: 'arstechnica.com', name: 'Ars Technica' },
  { suffix: 'venturebeat.com', name: 'VentureBeat' },
  { suffix: 'github.com', name: 'GitHub' },
  { suffix: 'stackoverflow.com', name: 'Stack Overflow' },
  { suffix: 'stackexchange.com', name: 'Stack Exchange' },
  { suffix: 'developer.mozilla.org', name: 'MDN' },
  { suffix: 'npmjs.com', name: 'npm' },
  { suffix: 'pypi.org', name: 'PyPI' },
  { suffix: 'crates.io', name: 'crates.io' },
  { suffix: 'docs.python.org', name: 'Python Docs' },
  { suffix: 'docs.rs', name: 'Rust Docs' },
  { suffix: 'kubernetes.io', name: 'Kubernetes' },
  { suffix: 'docker.com', name: 'Docker Hub' },
  { suffix: 'huggingface.co', name: 'Hugging Face' },
  { suffix: 'arxiv.org', name: 'arXiv' },
  { suffix: 'paperswithcode.com', name: 'Papers With Code' },
  { suffix: 'openai.com', name: 'OpenAI' },
  { suffix: 'anthropic.com', name: 'Anthropic' },
  { suffix: 'deepseek.com', name: 'DeepSeek' },
];

function matchPlatform(domain: string): string | undefined {
  for (const { suffix, name } of PLATFORM_SUFFIX_MAP) {
    if (domain === suffix || domain.endsWith('.' + suffix)) {
      return name;
    }
  }
  return undefined;
}

const EXCLUDE_DOMAINS = new Set([
  'deepseek.com', 'chat.deepseek.com',
  'doubao.com', 'www.doubao.com',
  'openai.com', 'chat.openai.com',
  'claude.ai', 'www.claude.ai', 'anthropic.com',
  'kimi.com', 'www.kimi.com', 'moonshot.cn',
  'qianwen.com', 'www.qianwen.com',
  'yuanbao.tencent.com',
  'chatglm.cn', 'www.chatglm.cn',
  'yiyan.baidu.com',
  'metaso.cn', 'www.metaso.cn',
  'tiangong.cn', 'www.tiangong.cn',
  'xinghuo.xfyun.cn',
  'hailuoai.com', 'www.hailuoai.com',
  'n.cn', 'www.n.cn',
  'google.com', 'www.google.com', 'bing.com', 'www.bing.com',
  'baidu.com', 'www.baidu.com',
]);

type Page = import('playwright-core').Page;

interface EngineConfig {
  key: string;
  name: string;
  url: string;
  input: { selectors: string[]; type: string };
  sendMethod: string;
  sendButtonSelector?: string;
  apiPattern?: string;
  sourceButtonSelector?: string;
  extraWait?: number;
  needsChatNav?: boolean;
  isSearchFirst?: boolean;
  navigateOnSend?: boolean;
  skipResponseWait?: boolean;
  upload: { image: boolean; file: boolean };
}

const ENGINE_CONFIGS: Record<string, EngineConfig> = {
  deepseek: { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', input: { selectors: ['textarea._27c9245', 'textarea', '#chat-input'], type: 'textarea' }, sendMethod: 'enter', apiPattern: '/chat/completion', upload: { image: true, file: true } },
  doubao: { key: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/', input: { selectors: ['textarea.semi-input-textarea', 'textarea'], type: 'textarea' }, sendMethod: 'metaEnter', extraWait: 8000, upload: { image: false, file: false } },
  chatgpt: { key: 'chatgpt', name: 'ChatGPT', url: 'https://chat.openai.com', input: { selectors: ['#prompt-textarea', 'textarea', '[contenteditable="true"]'], type: 'textarea' }, sendMethod: 'enter', upload: { image: true, file: true } },
  claude: { key: 'claude', name: 'Claude', url: 'https://claude.ai', input: { selectors: ['[contenteditable="true"]', 'div[contenteditable]', 'textarea'], type: 'contenteditable' }, sendMethod: 'enter', upload: { image: true, file: true } },
  kimi: { key: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn', input: { selectors: ['.chat-input-editor', '[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', needsChatNav: true, upload: { image: false, file: false } },
  qianwen: { key: 'qianwen', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', extraWait: 8000, upload: { image: true, file: true } },
  yuanbao: { key: 'yuanbao', name: '腾讯元宝', url: 'https://yuanbao.tencent.com/chat/', input: { selectors: ['[contenteditable="true"]'], type: 'contenteditable' }, sendMethod: 'enter', upload: { image: false, file: false } },
  chatglm: { key: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn', input: { selectors: ['textarea.scroll-display-none', 'textarea'], type: 'textarea' }, sendMethod: 'enter', apiPattern: '/chat/completion', sourceButtonSelector: '[class*="sources-tab"]', upload: { image: false, file: true } },
  yiyan: { key: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', extraWait: 10000, upload: { image: false, file: false } },
  metaso: { key: 'metaso', name: '秘塔AI搜索', url: 'https://metaso.cn', input: { selectors: ['textarea.search-consult-textarea', 'textarea'], type: 'textarea' }, sendMethod: 'enter', isSearchFirst: true, navigateOnSend: true, upload: { image: true, file: true } },
  tiangong: { key: 'tiangong', name: '天工AI', url: 'https://www.tiangong.cn', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', skipResponseWait: true, extraWait: 8000, needsChatNav: true, upload: { image: true, file: false } },
  xinghuo: { key: 'xinghuo', name: '讯飞星火', url: 'https://xinghuo.xfyun.cn', input: { selectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', extraWait: 8000, needsChatNav: true, upload: { image: false, file: false } },
  hailuo: { key: 'hailuo', name: '海螺AI', url: 'https://hailuoai.com', input: { selectors: ['[contenteditable]#video-create-textarea', '[contenteditable="true"]'], type: 'contenteditable' }, sendMethod: 'enter', upload: { image: true, file: true } },
  '360ai': { key: '360ai', name: '纳米AI', url: 'https://www.n.cn', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'button', sendButtonSelector: 'button.send-btn', isSearchFirst: true, upload: { image: false, file: true } },
};

const ALL_ENGINE_KEYS = Object.keys(ENGINE_CONFIGS);

function getEngineConfig(key: string): EngineConfig | undefined {
  return ENGINE_CONFIGS[key];
}

function buildSearchPrompt(query: string, isSearchFirst?: boolean): string {
  if (isSearchFirst) return query;
  return `请联网搜索2025年最新的${query}，要求是今年的最新数据，给出详细排名和分析`;
}

async function fillContentEditable(page: Page, selector: string, text: string): Promise<boolean> {
  const el = page.locator(selector).first();
  const count = await el.count();
  if (count === 0) return false;
  await el.waitFor({ state: 'visible', timeout: 5000 });
  await el.click();
  await page.waitForTimeout(300);
  try {
    await page.keyboard.type(text, { delay: 10 });
    const currentText = await el.evaluate((node: HTMLElement) => node.textContent || '');
    if (currentText.trim().length > 0) return true;
  } catch { /* fallback */ }
  await el.evaluate((node: HTMLElement, t: string) => {
    node.textContent = t;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
  return true;
}

async function findAndFillInput(page: Page, config: EngineConfig, text: string): Promise<boolean> {
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
    } catch { continue; }
  }
  for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]']) {
    try {
      const count = await page.locator(sel).count();
      if (count === 0) continue;
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 3000 });
      const tag = await el.evaluate((n) => n.tagName.toLowerCase());
      if (tag === 'textarea' || tag === 'input') {
        await el.click();
        await page.waitForTimeout(300);
        await el.fill(text);
      } else {
        await fillContentEditable(page, sel, text);
      }
      return true;
    } catch { continue; }
  }
  return false;
}

async function navigateToChat(page: Page, config: EngineConfig): Promise<void> {
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
    const chatLinks = await page.evaluate(() => {
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

async function detectLoginStatus(page: Page, config: EngineConfig): Promise<'logged_in' | 'logged_out' | 'unknown'> {
  const url = page.url();
  if (url.includes('/sign_in') || url.includes('/auth/login') || url.includes('/login')) return 'logged_out';
  const bodyText = await page.evaluate(() => document.body?.textContent || '');
  if (bodyText.includes('登录') && !bodyText.includes('已登录')) return 'logged_out';
  return 'unknown';
}

async function detectInternetSearch(_page: Page, config: EngineConfig): Promise<{ supported: boolean; enabled: boolean; details: string }> {
  if (config.isSearchFirst) return { supported: true, enabled: true, details: '搜索优先型' };
  return { supported: true, enabled: true, details: '内置联网能力' };
}

async function waitForAIResponse(page: Page, timeoutMs: number): Promise<string> {
  const startTime = Date.now();
  while (Date.now() - startTime < Math.min(timeoutMs, 15000)) {
    await page.waitForTimeout(1000);
    try {
      const state = await page.evaluate(() => {
        const body = document.body?.textContent || '';
        const hasLoading = !!document.querySelector('[class*="loading"], [class*="typing"], [class*="spinner"], [class*="skeleton"], [class*="thinking"], [class*="generating"], [class*="stop-button"], [aria-label*="Stop"], [class*="wait"], [class*="streaming"]');
        const isThinking = body.includes('正在搜索') || body.includes('Searching') || body.includes('Generating') || body.includes('停止生成') || body.includes('思考已完成');
        return { hasLoading, isThinking };
      });
      if (state.hasLoading || state.isThinking) break;
      if (Date.now() - startTime > 5000) break;
    } catch { /* ignore */ }
  }

  const baselineKeys = await page.evaluate(() => {
    const containers = document.querySelectorAll('[class*="markdown"], [class*="message-content"], [class*="message-list"], [class*="response"], [class*="answer"], .prose, article, [class*="segment-assistant"], [class*="chat-content-item-assi"], [class*="assistant-msg"], [class*="bot-message"], [class*="ai-message"]');
    const keys = new Set<string>();
    containers.forEach((el) => { const txt = el.textContent?.trim() || ''; if (txt.length > 20) keys.add(txt.slice(0, 100)); });
    return Array.from(keys);
  });

  let stableCount = 0;
  let lastResponse = '';
  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(2000);
    try {
      const result = await page.evaluate((baseline: string[]) => {
        const baseSet = new Set(baseline);
        const loadingEl = document.querySelector('[class*="loading"], [class*="typing"], [class*="spinner"], [class*="skeleton"], [class*="thinking"], [class*="wait"], [class*="streaming"]');
        if (loadingEl) {
          const body = document.body?.textContent || '';
          if (body.includes('正在搜索') || body.includes('Searching') || body.includes('Generating') || body.includes('思考中')) return { status: 'processing' };
        }
        const candidates = ['[data-message-author-role="assistant"]', '[class*="response-message"]', '[class*="assistant-message"]', '[class*="segment-assistant"]', '[class*="chat-content-item-assi"]', '[class*="assistant-msg"]', '[class*="bot-message"]', '[class*="ai-message"]', '[class*="answer-text"]', '[class*="message-list"]'];
        for (const sel of candidates) {
          const els = document.querySelectorAll(sel);
          let bestText = '';
          for (let i = 0; i < els.length; i++) { const txt = els[i].textContent?.trim() || ''; if (txt.length > 50 && !baseSet.has(txt.slice(0, 100)) && txt.length > bestText.length) bestText = txt; }
          if (bestText) return { status: 'ready', text: bestText.slice(0, 5000), isNew: true };
        }
        const allContainers = document.querySelectorAll('[class*="markdown"], [class*="message-content"], [class*="message-list"], [class*="answer"], .prose');
        let bestFallbackText = '';
        for (let i = 0; i < allContainers.length; i++) { const txt = allContainers[i].textContent?.trim() || ''; if (txt.length > 50 && !baseSet.has(txt.slice(0, 100)) && txt.length > bestFallbackText.length) bestFallbackText = txt; }
        if (bestFallbackText) return { status: 'ready', text: bestFallbackText.slice(0, 5000), isNew: true };
        return { status: 'waiting' };
      }, baselineKeys);
      if (result.status === 'processing') { stableCount = 0; lastResponse = ''; continue; }
      if (result.status === 'ready' && result.text) {
        if (result.text === lastResponse) { stableCount++; if (stableCount >= 3) return result.text; } else { lastResponse = result.text; stableCount = 1; }
        if (Date.now() - startTime > 20000 && stableCount >= 2) return result.text;
      }
    } catch { stableCount = 0; }
  }
  return lastResponse;
}

function parseMarkdownResults(rawText: string): AISearchResultItem[] {
  const results: AISearchResultItem[] = [];
  const jsonMatch = rawText.match(/(?:```json\s*)?(\[[\s\S]*?\])(?:\s*```)?/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].replace(/,\s*]/g, ']'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) { if (item.title && item.url && item.snippet) { results.push({ title: String(item.title).trim(), url: String(item.url).trim(), snippet: String(item.snippet).trim().replace(/\n/g, ' ').slice(0, 300), position: results.length + 1 }); } }
        if (results.length > 0) return results;
      }
    } catch { /* not valid JSON */ }
  }
  const patterns = [/(?:^|\n)\s*##\s*\d+[\.\s]+\[([^\]]+)\]\(([^)]+)\)\s*\n\s*>\s*([\s\S]+?)(?=\n\s*(?:##\d|$))/g, /(?:^|\n)\s*###?\s*\d+[\.\s]+\[([^\]]+)\]\(([^)]+)\)\s*\n\s*>\s*([\s\S]+?)(?=\n\s*(?:###?\d|$))/g, /(?:^|\n)\s*[\-\*]\s*\[([^\]]+)\]\(([^)]+)\)[\:\：]\s*([\s\S]+?)(?=(?:\n\s*[\-\*]|\n\n|\n$|$))/g];
  for (const pattern of patterns) { let match: RegExpExecArray | null; pattern.lastIndex = 0; while ((match = pattern.exec(rawText)) !== null) { const title = match[1].trim(); const url = match[2].trim(); const snippet = match[3].trim().replace(/\n/g, ' ').slice(0, 300); if (title && url && snippet) results.push({ title, url, snippet, position: results.length + 1 }); } if (results.length > 0) return results; }
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = linkPattern.exec(rawText)) !== null) { const title = match[1].trim(); const url = match[2].trim(); if (!seen.has(url) && title && url.startsWith('http')) { seen.add(url); const before = rawText.slice(Math.max(0, match.index - 150), match.index); const after = rawText.slice(match.index + match[0].length, match.index + match[0].length + 200); const snippet = (before.split('\n').pop()?.replace(/^>\s*/, '').trim() || '') + ' ' + (after.split('\n')[0]?.replace(/^>|\*\s*/, '').trim() || ''); results.push({ title, url, snippet: snippet.replace(/\n/g, ' ').slice(0, 300), position: results.length + 1 }); } }
  if (results.length === 0) { const lines = rawText.split('\n').filter(l => l.trim()); for (const line of lines) { const urlMatch = line.match(/https?:\/\/[^\s\)\]\"']+/); if (urlMatch) { const url = urlMatch[0]; const rest = line.replace(url, '').replace(/[#\-\*>`\[\]]/g, '').trim(); results.push({ title: rest.slice(0, 100) || 'Untitled', url, snippet: rest.slice(0, 200), position: results.length + 1 }); } } }
  return results;
}

function parseSearchFirstResults(rawText: string): AISearchResultItem[] {
  const results = parseMarkdownResults(rawText);
  if (results.length > 0) return results;
  const items: AISearchResultItem[] = [];
  const lines = rawText.split('\n').filter(l => l.trim());
  let pos = 0;
  for (const line of lines) { const urlMatch = line.match(/https?:\/\/[^\s\)\]\"'>]+/); if (urlMatch) { const url = urlMatch[0].replace(/[.,;:!?]+$/, ''); const title = line.replace(url, '').replace(/[#\-\*>`\[\]]/g, '').trim().slice(0, 150) || 'Result'; pos++; items.push({ title, url, snippet: title, position: pos }); } if (items.length >= 20) break; }
  if (items.length === 0) { pos++; items.push({ title: rawText.slice(0, 150), url: '', snippet: rawText.slice(0, 300), position: pos }); }
  return items;
}

async function extractSourcesFromDOM(page: Page, config: EngineConfig): Promise<string[]> {
  if (config.sourceButtonSelector) {
    try { const btns = await page.$$(config.sourceButtonSelector); for (const btn of btns) { const text = await btn.textContent(); if (text && /来源|source|reference/i.test(text)) { await btn.click().catch(() => {}); await page.waitForTimeout(1000); } } } catch { /* ignore */ }
  }
  try { const sourceButtons = await page.$$('[class*="source"]'); for (const btn of sourceButtons) { const text = await btn.textContent(); if (text && /来源|source|reference/i.test(text)) { await btn.click().catch(() => {}); await page.waitForTimeout(1000); } } } catch { /* ignore */ }
  const engineHost = new URL(config.url).hostname;
  const links = await page.evaluate((host: string) => { return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map(a => a.href).filter(href => { if (!href.startsWith('http')) return false; try { const u = new URL(href); return u.hostname !== host && !u.hostname.endsWith('.' + host); } catch { return false; } }); }, engineHost);
  return [...new Set(links)];
}

async function createBrowserContext(cdpEndpoint?: string): Promise<{ browser: import('playwright').Browser; context: import('playwright').BrowserContext }> {
  const { chromium } = await import('playwright');
  let browser: import('playwright').Browser;
  let context: import('playwright').BrowserContext;
  if (cdpEndpoint) {
    browser = await chromium.connectOverCDP(cdpEndpoint);
    context = browser.contexts()[0] || await browser.newContext();
  } else {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', viewport: { width: 1920, height: 1080 } });
  }
  return { browser, context };
}

type SingleEngineParams = {
  query: string;
  engine?: string;
  limit?: number;
  full?: boolean;
  showSources?: boolean;
  extractUrls?: boolean;
  format?: string;
  timeout?: number;
};

async function executeSingleEngineOnPage(page: Page, config: EngineConfig, params: SingleEngineParams): Promise<ReturnType<typeof ok>> {
  await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(config.extraWait || 3000);
  await navigateToChat(page, config);
  const loginStatus = await detectLoginStatus(page, config);
  if (loginStatus === 'logged_out') throw new Error(`[${config.name}] 未登录。请先用 xbrowser open ${config.url} 并手动登录，然后再使用 ai-search。`);
  const internetSearchInfo = await detectInternetSearch(page, config);
  const interceptedUrls: string[] = [];
  const responseListener = async (response: import('playwright').Response) => {
    const respUrl = response.url();
    const contentType = response.headers()['content-type'] || '';
    const isJsonOrStream = contentType.includes('text/event-stream') || contentType.includes('application/json');
    if (!isJsonOrStream && !params.extractUrls) return;
    if (!params.extractUrls) { const shouldIntercept = config.apiPattern ? respUrl.includes(config.apiPattern) : respUrl.includes('/chat/completion') || respUrl.includes('/completion') || respUrl.includes('/conversation'); if (!shouldIntercept) return; }
    try { const body = await response.text(); const matches = body.match(/https?:\/\/[^\s"'`>\}\]\)]+/g); if (matches) interceptedUrls.push(...matches); } catch { /* ignore */ }
  };
  page.on('response', responseListener);
  const inputText = buildSearchPrompt(params.query, config.isSearchFirst);
  const inputFilled = await findAndFillInput(page, config, inputText);
  if (!inputFilled) throw new Error(`无法在 ${config.url} 找到输入框。请确认已登录且页面正常加载。`);
  await page.waitForTimeout(500);
  if (config.sendMethod === 'button' && config.sendButtonSelector) { const btn = page.locator(config.sendButtonSelector).first(); if ((await btn.count()) > 0) { await btn.click(); } else { await page.keyboard.press('Enter'); } } else if (config.sendMethod === 'metaEnter') { await page.keyboard.press('Meta+Enter'); } else if (config.navigateOnSend) { await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}), page.keyboard.press('Enter')]); await page.waitForTimeout(3000); } else { await page.keyboard.press('Enter'); }
  const startTime = Date.now();
  let rawResponse = '';
  const timeoutMs = params.timeout ?? 60000;
  if (config.skipResponseWait) { await page.waitForTimeout(Math.min(timeoutMs, 60000)); rawResponse = await page.evaluate(() => document.body?.textContent?.slice(0, 5000) || ''); } else { rawResponse = await waitForAIResponse(page, timeoutMs); }
  const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  if (!params.extractUrls) page.off('response', responseListener);
  if (!rawResponse || rawResponse.length < 10) throw new Error(`AI 引擎 "${config.key}" 未返回有效回复（超时 ${timeoutMs}ms）。请检查浏览器登录状态。`);
  const parsedResults = config.isSearchFirst ? parseSearchFirstResults(rawResponse) : parseMarkdownResults(rawResponse);
  const limitedResults = parsedResults.slice(0, params.limit ?? 10);
  const aiSearchResult: AISearchResult = { query: params.query, engine: config.key, results: limitedResults, total: limitedResults.length, timestamp: Date.now(), duration, engineInfo: { name: config.name, loginStatus, internetSearch: internetSearchInfo, uploadCapabilities: config.upload } };
  if (params.full) aiSearchResult.aiResponse = rawResponse;
  if (params.showSources) { const sourceUrls = await extractSourcesFromDOM(page, config); const sourceData = sourceUrls.map(url => { try { return { url, domain: new URL(url).hostname.replace(/^www\./, '') }; } catch { return null; } }).filter((d): d is { url: string; domain: string } => d !== null); const sourceDomains = [...new Set(sourceData.map(d => d.domain))]; aiSearchResult.sources = { total: sourceData.length, domains: sourceDomains, urls: sourceData }; }
  if (params.extractUrls) { page.off('response', responseListener); const domUrls = await extractSourcesFromDOM(page, config); const allUrls = new Map<string, string[]>(); const allRawUrls = [...new Set([...interceptedUrls, ...domUrls])]; for (const rawUrl of allRawUrls) { const cleaned = rawUrl.replace(/[.,;:!?\)\]}>]+$/, ''); try { const u = new URL(cleaned); const domain = u.hostname.replace(/^www\./, ''); if (!allUrls.has(domain)) allUrls.set(domain, []); const list = allUrls.get(domain)!; if (!list.includes(cleaned)) list.push(cleaned); } catch { /* skip */ } } const domainEntries = Array.from(allUrls.entries()).filter(([domain]) => !EXCLUDE_DOMAINS.has(domain)).map(([domain, urls]) => ({ domain, count: urls.length, urls, platform: matchPlatform(domain) })).sort((a, b) => b.count - a.count); const totalUrls = domainEntries.reduce((sum, d) => sum + d.urls.length, 0); aiSearchResult.domainExtraction = { query: params.query, totalUrls, totalDomains: domainEntries.length, domains: domainEntries }; }
  const fmt = params.format || 'markdown';
  if (fmt === 'markdown') { const lines = [`## AI Search: ${aiSearchResult.query}`, `_Engine: ${aiSearchResult.engine} (${config.name}) | Total: ${aiSearchResult.total} | Duration: ${duration}_`, '']; if (aiSearchResult.engineInfo) { const ei = aiSearchResult.engineInfo; lines.push(`| Login | Internet Search | Image Upload | File Upload |`); lines.push(`|-------|----------------|-------------|-------------|`); lines.push(`| ${ei.loginStatus} | ${ei.internetSearch.enabled ? '✅' : '❌'} ${ei.internetSearch.details} | ${ei.uploadCapabilities.image ? '✅' : '❌'} | ${ei.uploadCapabilities.file ? '✅' : '❌'} |`); lines.push(''); } if (aiSearchResult.domainExtraction) { const ext = aiSearchResult.domainExtraction; lines.push(`### URL/域名提取结果`); lines.push(`_共提取 ${ext.totalUrls} 个 URL，来自 ${ext.totalDomains} 个域名_`); lines.push(''); lines.push('| # | 域名 | 平台 | URL数 | 链接 |'); lines.push('|---|------|------|-------|------|'); for (let i = 0; i < ext.domains.length; i++) { const d = ext.domains[i]; lines.push(`| ${i + 1} | ${d.platform ? `**${d.platform}** (${d.domain})` : d.domain} | ${d.platform || '-'} | ${d.count} | [打开](${d.urls[0]}) |`); } lines.push(''); lines.push(`---`); lines.push(`_提示：以上平台是 AI 搜索"${params.query}"的数据来源，在这些平台发帖可被 AI 引擎引用_`); lines.push(''); } for (const r of aiSearchResult.results) { lines.push(`### ${r.position}. [${r.title}](${r.url})`); lines.push(`> ${r.snippet}`); lines.push(''); } if (aiSearchResult.sources) { lines.push(`---`); lines.push(`_Sources: ${aiSearchResult.sources.total} URLs from ${aiSearchResult.sources.domains.length} domains_`); } return ok({ ...aiSearchResult, content: lines.join('\n') }); }
  if (fmt === 'text') { const lines = [`AI Search: ${aiSearchResult.query} (Engine: ${aiSearchResult.engine}/${config.name}, Total: ${aiSearchResult.total}, Duration: ${duration})`, '']; if (aiSearchResult.domainExtraction) { const ext = aiSearchResult.domainExtraction; lines.push(`=== URL/域名提取结果 ===`); lines.push(`共提取 ${ext.totalUrls} 个 URL，来自 ${ext.totalDomains} 个域名`); lines.push(''); for (let i = 0; i < ext.domains.length; i++) { const d = ext.domains[i]; lines.push(`${i + 1}. ${d.domain}${d.platform ? ` [${d.platform}]` : ''} (${d.count} URLs)`); for (const url of d.urls.slice(0, 3)) lines.push(`   -> ${url}`); if (d.urls.length > 3) lines.push(`   ... +${d.urls.length - 3} more`); } lines.push(''); } for (const r of aiSearchResult.results) { lines.push(`${r.position}. ${r.title}`); lines.push(`   ${r.url}`); lines.push(`   ${r.snippet}`); lines.push(''); } return ok({ ...aiSearchResult, content: lines.join('\n') }); }
  return ok(aiSearchResult);
}

async function handleSingleEngine(params: SingleEngineParams, cdpEndpoint?: string): Promise<ReturnType<typeof ok>> {
  const { browser, context } = await createBrowserContext(cdpEndpoint);
  const page = await context.newPage();
  const engineKey = params.engine || 'deepseek';
  const config = getEngineConfig(engineKey);
  if (!config) { await browser.close(); throw new Error(`Unknown AI engine: ${params.engine}. Available: ${ALL_ENGINE_KEYS.join(', ')}`); }
  try { return await executeSingleEngineOnPage(page, config, params); } finally { await browser.close(); }
}

async function handleAllEngines(params: SingleEngineParams & { all: boolean }, cdpEndpoint?: string): Promise<ReturnType<typeof ok>> {
  const perEngineResults = new Map<string, { success: boolean; result?: AISearchResult; error?: string; duration?: string }>();
  for (const engineKey of ALL_ENGINE_KEYS) {
    const config = getEngineConfig(engineKey);
    if (!config) continue;
    console.log(`[ai-search --all] 正在搜索 ${config.name} (${engineKey})...`);
    const { browser, context } = await createBrowserContext(cdpEndpoint);
    const page = await context.newPage();
    try { const result = await executeSingleEngineOnPage(page, config, params); const data = result.data as AISearchResult; perEngineResults.set(engineKey, { success: true, result: data, duration: data.duration }); console.log(`[ai-search --all] ✅ ${config.name}: ${data.total} results`); } catch (e) { const msg = e instanceof Error ? e.message : String(e); perEngineResults.set(engineKey, { success: false, error: msg }); console.log(`[ai-search --all] ❌ ${config.name}: ${msg.slice(0, 100)}`); } finally { await browser.close(); }
    if (engineKey !== ALL_ENGINE_KEYS[ALL_ENGINE_KEYS.length - 1]) { console.log('[ai-search --all] 等待 3 秒后继续下一个引擎...'); await new Promise(resolve => setTimeout(resolve, 3000)); }
  }
  const aggregated = aggregateAllResults(perEngineResults, params.query);
  return formatAggregatedResult(aggregated, params.format || 'markdown');
}

function aggregateAllResults(perEngine: Map<string, { success: boolean; result?: AISearchResult; error?: string; duration?: string }>, query: string): AggregatedResult {
  let successCount = 0; let failCount = 0;
  const engineDetails: AggregatedResult['engineDetails'] = [];
  const perEngineResults = new Map<string, AISearchResult>();
  const domainUrlMap = new Map<string, Map<string, { engines: Set<string>; count: number }>>();
  for (const [engineKey, entry] of perEngine) { const config = getEngineConfig(engineKey); const name = config?.name || engineKey; if (!entry.success || !entry.result) { failCount++; engineDetails.push({ engine: engineKey, name, success: false, urlCount: 0, domainCount: 0, duration: entry.duration, error: entry.error }); continue; } successCount++; perEngineResults.set(engineKey, entry.result); const urlCount = entry.result.domainExtraction?.totalUrls ?? entry.result.total; const domainCount = entry.result.domainExtraction?.totalDomains ?? 0; engineDetails.push({ engine: engineKey, name, success: true, urlCount, domainCount, duration: entry.duration }); if (entry.result.domainExtraction) { for (const domainEntry of entry.result.domainExtraction.domains) { if (!domainUrlMap.has(domainEntry.domain)) domainUrlMap.set(domainEntry.domain, new Map()); const urlMap = domainUrlMap.get(domainEntry.domain)!; for (const url of domainEntry.urls) { if (!urlMap.has(url)) urlMap.set(url, { engines: new Set(), count: 0 }); const info = urlMap.get(url)!; info.count++; info.engines.add(engineKey); } } } }
  const domainRanking: AggregatedResult['domainRanking'] = [];
  for (const [domain, urlMap] of domainUrlMap) { let totalCount = 0; const allEngines = new Set<string>(); const allUrls: string[] = []; for (const [url, info] of urlMap) { totalCount += info.count; for (const e of info.engines) allEngines.add(e); if (!allUrls.includes(url)) allUrls.push(url); } const engineBreakdown = Array.from(allEngines).map(e => { let count = 0; for (const [, info] of urlMap) { if (info.engines.has(e)) count += info.count; } return { engine: e, count }; }).sort((a, b) => b.count - a.count); domainRanking.push({ domain, platform: matchPlatform(domain), totalCount, engineCount: allEngines.size, engines: engineBreakdown, urls: allUrls }); }
  domainRanking.sort((a, b) => { if (b.engineCount !== a.engineCount) return b.engineCount - a.engineCount; return b.totalCount - a.totalCount; });
  const platformMap = new Map<string, { count: number; engines: Set<string> }>();
  for (const entry of domainRanking) { if (entry.platform) { if (!platformMap.has(entry.platform)) platformMap.set(entry.platform, { count: 0, engines: new Set() }); const p = platformMap.get(entry.platform)!; p.count += entry.totalCount; for (const e of entry.engines) p.engines.add(e.engine); } }
  const platformRanking = Array.from(platformMap.entries()).map(([platform, data]) => ({ platform, totalCount: data.count, engines: Array.from(data.engines) })).sort((a, b) => b.totalCount - a.totalCount);
  const totalUrls = domainRanking.reduce((sum, d) => sum + d.urls.length, 0);
  return { query, totalEngines: perEngine.size, successEngines: successCount, failedEngines: failCount, totalUrls, uniqueDomains: domainRanking.length, domainRanking, platformRanking, engineDetails, perEngineResults };
}

function formatAggregatedResult(agg: AggregatedResult, format: string): ReturnType<typeof ok> {
  if (format === 'json') return ok({ ...agg, perEngineResults: Object.fromEntries(agg.perEngineResults) });
  if (format === 'text') { const lines: string[] = []; lines.push(`=== AI 搜索引擎聚合结果 ===`); lines.push(`查询：${agg.query}`); lines.push(`引擎数：${agg.totalEngines}（成功 ${agg.successEngines}，失败 ${agg.failedEngines}）`); lines.push(`总 URL 数：${agg.totalUrls}，去重域名数：${agg.uniqueDomains}`); lines.push(''); if (agg.domainRanking.length > 0) { const topN = agg.domainRanking.slice(0, 20); lines.push(`--- 域名排名 Top ${topN.length} ---`); for (let i = 0; i < topN.length; i++) { const d = topN[i]; lines.push(`${i + 1}. ${d.domain}${d.platform ? ` (${d.platform})` : ''} — 被 ${d.engineCount} 个引擎引用，总频次 ${d.totalCount}`); } lines.push(''); } lines.push(`--- 各引擎结果 ---`); for (const d of agg.engineDetails) { const status = d.success ? '✅' : '❌'; lines.push(`${status} ${d.name}: ${d.success ? `${d.urlCount} URLs, ${d.domainCount} 域名${d.duration ? `, ${d.duration}` : ''}` : d.error?.slice(0, 80) || 'unknown error'}`); } return ok({ ...agg, perEngineResults: Object.fromEntries(agg.perEngineResults), content: lines.join('\n') }); }
  const lines: string[] = []; lines.push(`## AI 搜索引擎聚合结果`); lines.push(`**查询**：${agg.query}`); lines.push(`**引擎数**：${agg.totalEngines}（成功 ${agg.successEngines}，失败 ${agg.failedEngines}）`); lines.push(`**总 URL**：${agg.totalUrls} | **去重域名**：${agg.uniqueDomains}`); lines.push(''); if (agg.domainRanking.length > 0) { const topN = agg.domainRanking.slice(0, 20); lines.push(`### 域名排名 Top ${topN.length}`); lines.push(''); lines.push('| # | 域名 | 平台 | 引擎数 | 频次 | 来源引擎 |'); lines.push('|---|------|------|--------|------|----------|'); for (let i = 0; i < topN.length; i++) { const d = topN[i]; lines.push(`| ${i + 1} | ${d.domain} | ${d.platform || '-'} | ${d.engineCount} | ${d.totalCount} | ${d.engines.map(e => `${getEngineConfig(e.engine)?.name || e.engine}(${e.count})`).join(', ')} |`); } lines.push(''); } if (agg.platformRanking.length > 0) { lines.push(`### 平台排名（可发帖平台）`); lines.push(''); lines.push('| # | 平台 | 引用频次 | 涉及引擎 |'); lines.push('|---|------|---------|----------|'); for (let i = 0; i < agg.platformRanking.length; i++) { const p = agg.platformRanking[i]; lines.push(`| ${i + 1} | ${p.platform} | ${p.totalCount} | ${p.engines.map(e => getEngineConfig(e)?.name || e).join(', ')} |`); } lines.push(''); } lines.push(`### 各引擎结果`); lines.push(''); lines.push('| 状态 | 引擎 | URLs | 域名 | 耗时 | 错误 |'); lines.push('|------|------|------|------|------|------|'); for (const d of agg.engineDetails) { lines.push(`| ${d.success ? '✅' : '❌'} | ${d.name} | ${d.urlCount} | ${d.domainCount} | ${d.duration || '-'} | ${d.error ? d.error.slice(0, 50) : '-'} |`); } lines.push('');
  return ok({ ...agg, perEngineResults: Object.fromEntries(agg.perEngineResults), content: lines.join('\n') });
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'ai-search',
    url: 'https://xbrowser.dev',
    description: 'AI search across 14 AI engines with structured results',
  });

  site.command('ai-search', {
    description: 'Search via AI engines (14 engines: DeepSeek/Doubao/ChatGPT/Claude/Kimi/通义千问/元宝/智谱/文心/秘塔/天工/星火/海螺/纳米AI) with structured results',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      engine: z.string().optional().describe('AI 引擎（默认 deepseek）'),
      all: z.boolean().default(false).describe('搜索所有引擎并聚合结果'),
      prompt: z.string().optional().describe('搜索关键词（query 的别名）'),
      limit: z.number().default(10).describe('最大结果数'),
      full: z.boolean().default(false).describe('是否包含完整 AI 回复'),
      showSources: z.boolean().default(false).describe('显示引用来源'),
      extractUrls: z.boolean().default(false).describe('提取所有 URL 并按域名聚合'),
      format: z.enum(['markdown', 'json', 'text']).default('markdown'),
      timeout: z.number().default(60000).describe('AI 回复超时（毫秒）'),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const query = params.prompt || params.query;
      if (!query) throw new Error('请提供搜索关键词（--query 或 --prompt）');
      if (params.all && params.engine) throw new Error('--all 与 --engine 互斥，不能同时指定');
      const cdpEndpoint = (ctx as Record<string, unknown>).cdpEndpoint as string | undefined;
      if (params.all) return await handleAllEngines({ ...params, query, all: true }, cdpEndpoint);
      return await handleSingleEngine({ ...params, query }, cdpEndpoint);
    },
  });
}
