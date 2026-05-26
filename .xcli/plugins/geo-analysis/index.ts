import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';

type Page = import('playwright-core').Page;
type PlaywrightResponse = import('playwright').Response;

const DATA_BASE = './data/geo-analysis';
const DEFAULT_TIMEOUT = 60000;
const DELAY_BETWEEN_ENGINES = 3000;

const NOISE_EXTENSIONS = /\.(ico|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|css|js)(\?|$)/i;
const NOISE_DOMAIN_PATTERNS = [
  /cdn/i, /static/i, /analytics/i, /tracker/i, /pixel/i,
  /google-analytics/i, /googletagmanager/i, /facebook\.com\/tr/i,
  /doubleclick/i, /adservice/i, /adnxs/i, /amazonaws\.com\/sdk/i,
];

interface EngineConfig {
  key: string;
  name: string;
  url: string;
  input: { selectors: string[]; type: string };
  sendMethod: string;
  sendButtonSelector?: string;
  apiPattern?: string;
  sourceButtonSelector?: string;
  sourceListSelector?: string;
  navigateOnSend?: boolean;
  skipResponseWait?: boolean;
  extraWait?: number;
  needsChatNav?: boolean;
  isSearchFirst?: boolean;
}

const ENGINE_CONFIGS: Record<string, EngineConfig> = {
  deepseek: { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', input: { selectors: ['textarea._27c9245', 'textarea', '#chat-input'], type: 'textarea' }, sendMethod: 'enter', apiPattern: '/chat/completion' },
  doubao: { key: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/', input: { selectors: ['textarea.semi-input-textarea', 'textarea'], type: 'textarea' }, sendMethod: 'metaEnter', extraWait: 8000 },
  chatgpt: { key: 'chatgpt', name: 'ChatGPT', url: 'https://chat.openai.com', input: { selectors: ['#prompt-textarea', 'textarea', '[contenteditable="true"]'], type: 'textarea' }, sendMethod: 'enter' },
  claude: { key: 'claude', name: 'Claude', url: 'https://claude.ai', input: { selectors: ['[contenteditable="true"]', 'div[contenteditable]', 'textarea'], type: 'contenteditable' }, sendMethod: 'enter' },
  kimi: { key: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn', input: { selectors: ['.chat-input-editor', '[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', needsChatNav: true },
  qianwen: { key: 'qianwen', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', extraWait: 8000 },
  yuanbao: { key: 'yuanbao', name: '腾讯元宝', url: 'https://yuanbao.tencent.com/chat/', input: { selectors: ['[contenteditable="true"]'], type: 'contenteditable' }, sendMethod: 'enter' },
  chatglm: { key: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn', input: { selectors: ['textarea.scroll-display-none', 'textarea'], type: 'textarea' }, sendMethod: 'enter', apiPattern: '/chat/completion', sourceButtonSelector: '[class*="sources-tab"]' },
  yiyan: { key: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', extraWait: 10000 },
  metaso: { key: 'metaso', name: '秘塔AI搜索', url: 'https://metaso.cn', input: { selectors: ['textarea.search-consult-textarea', 'textarea'], type: 'textarea' }, sendMethod: 'enter', isSearchFirst: true, navigateOnSend: true },
  tiangong: { key: 'tiangong', name: '天工AI', url: 'https://www.tiangong.cn', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', skipResponseWait: true, extraWait: 8000, needsChatNav: true },
  xinghuo: { key: 'xinghuo', name: '讯飞星火', url: 'https://xinghuo.xfyun.cn', input: { selectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'enter', extraWait: 8000, needsChatNav: true },
  hailuo: { key: 'hailuo', name: '海螺AI', url: 'https://hailuoai.com', input: { selectors: ['[contenteditable]#video-create-textarea', '[contenteditable="true"]'], type: 'contenteditable' }, sendMethod: 'enter' },
  '360ai': { key: '360ai', name: '纳米AI', url: 'https://www.n.cn', input: { selectors: ['[contenteditable="true"]', '[role="textbox"]'], type: 'contenteditable' }, sendMethod: 'button', sendButtonSelector: 'button.send-btn', isSearchFirst: true },
};

const ALL_ENGINES = Object.keys(ENGINE_CONFIGS);

function getEngineConfig(key: string): EngineConfig | undefined {
  return ENGINE_CONFIGS[key];
}

function buildSearchPrompt(query: string, isSearchFirst?: boolean): string {
  if (isSearchFirst) return query;
  return `请联网搜索2025年最新的${query}，要求是今年的最新数据，给出详细排名和分析`;
}

async function detectLoginStatus(page: Page, config: EngineConfig): Promise<'logged_in' | 'logged_out' | 'unknown'> {
  try {
    const bodyText = await page.evaluate(() => document.body?.textContent || '');
    if (bodyText.includes('登录') && bodyText.includes('注册') && bodyText.length < 5000) return 'logged_out';
    for (const sel of config.input.selectors) {
      const count = await page.locator(sel).count();
      if (count > 0) return 'logged_in';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function fillContentEditable(page: Page, selector: string, text: string): Promise<boolean> {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return false;
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
  await page.waitForTimeout(2000);
  if (config.key === 'kimi') {
    const chatLink = page.locator('a[href*="/chat"], a[href*="/dialog"]').first();
    if ((await chatLink.count()) > 0) {
      await chatLink.click();
      await page.waitForTimeout(2000);
    }
  } else if (config.key === 'tiangong') {
    const chatLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
        .filter(a => a.href.includes('/chat') || a.href.includes('/project'))
        .map(a => ({ href: a.href }))
    );
    if (chatLinks.length > 0) {
      await page.goto(chatLinks[0].href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
    }
  } else if (config.key === 'xinghuo') {
    const startBtn = page.locator('text=开始对话').first();
    if ((await startBtn.count()) > 0) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }
  }
}

async function waitForAIResponse(page: Page, timeoutMs: number): Promise<string> {
  const startTime = Date.now();
  while (Date.now() - startTime < Math.min(timeoutMs, 15000)) {
    await page.waitForTimeout(1000);
    try {
      const state = await page.evaluate(() => {
        const hasLoading = !!document.querySelector(
          '[class*="loading"], [class*="typing"], [class*="spinner"], [class*="skeleton"], [class*="thinking"], [class*="generating"], [class*="stop-button"]'
        );
        const body = document.body?.textContent || '';
        const isThinking = body.includes('正在搜索') || body.includes('Searching') || body.includes('Generating') || body.includes('停止生成');
        return { hasLoading, isThinking };
      });
      if (state.hasLoading || state.isThinking) break;
      if (Date.now() - startTime > 5000) break;
    } catch { /* ignore */ }
  }
  const baselineKeys = await page.evaluate(() => {
    const containers = document.querySelectorAll(
      '[class*="markdown"], [class*="message-content"], [class*="message-list"], [class*="response"], [class*="answer"], .prose, article, [class*="segment-assistant"], [class*="chat-content-item-assi"], [class*="assistant-msg"], [class*="bot-message"], [class*="ai-message"]'
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
      const result = await page.evaluate((baseline: string[]) => {
        const baseSet = new Set(baseline);
        const loadingEl = document.querySelector('[class*="loading"], [class*="typing"], [class*="skeleton"], [class*="thinking"], [class*="streaming"]');
        if (loadingEl) {
          const body = document.body?.textContent || '';
          if (body.includes('正在搜索') || body.includes('Searching') || body.includes('Generating')) return { status: 'processing' };
        }
        const candidates = [
          '[data-message-author-role="assistant"]', '[class*="response-message"]', '[class*="assistant-message"]',
          '[class*="segment-assistant"]', '[class*="chat-content-item-assi"]', '[class*="assistant-msg"]',
          '[class*="bot-message"]', '[class*="ai-message"]', '[class*="answer-text"]', '[class*="message-list"]',
        ];
        for (const sel of candidates) {
          const els = document.querySelectorAll(sel);
          let bestText = '';
          for (let i = 0; i < els.length; i++) {
            const txt = els[i].textContent?.trim() || '';
            if (txt.length > 50 && !baseSet.has(txt.slice(0, 100)) && txt.length > bestText.length) bestText = txt;
          }
          if (bestText) return { status: 'ready', text: bestText.slice(0, 5000) };
        }
        const allContainers = document.querySelectorAll('[class*="markdown"], [class*="message-content"], [class*="message-list"], [class*="answer"], .prose');
        let bestFallbackText = '';
        for (let i = 0; i < allContainers.length; i++) {
          const txt = allContainers[i].textContent?.trim() || '';
          if (txt.length > 50 && !baseSet.has(txt.slice(0, 100)) && txt.length > bestFallbackText.length) bestFallbackText = txt;
        }
        if (bestFallbackText) return { status: 'ready', text: bestFallbackText.slice(0, 5000) };
        return { status: 'waiting' };
      }, baselineKeys);
      if (result.status === 'processing') { stableCount = 0; lastResponse = ''; continue; }
      if (result.status === 'ready' && result.text) {
        if (result.text === lastResponse) { stableCount++; if (stableCount >= 3) return result.text; }
        else { lastResponse = result.text; stableCount = 1; }
        if (Date.now() - startTime > 20000 && stableCount >= 2) return result.text;
      }
    } catch { stableCount = 0; }
  }
  return lastResponse;
}

async function extractSourcesFromDOM(page: Page, config: EngineConfig): Promise<string[]> {
  if (config.sourceButtonSelector) {
    try {
      const btns = await page.$$(config.sourceButtonSelector);
      for (const btn of btns) {
        const text = await btn.textContent();
        if (text && /来源|source|reference/i.test(text)) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
      }
    } catch { /* ignore */ }
  }
  const engineHost = new URL(config.url).hostname;
  const links = await page.evaluate((host: string) => {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map(a => a.href)
      .filter(href => {
        if (!href.startsWith('http')) return false;
        try { const u = new URL(href); return u.hostname !== host && !u.hostname.endsWith('.' + host); } catch { return false; }
      });
  }, engineHost);
  return [...new Set(links)];
}

const PLATFORM_SUFFIX_MAP: Array<{ suffix: string; name: string }> = [
  { suffix: 'zhihu.com', name: '知乎' },
  { suffix: 'juejin.cn', name: '掘金' },
  { suffix: 'csdn.net', name: 'CSDN' },
  { suffix: 'mp.weixin.qq.com', name: '微信公众号' },
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
  { suffix: 'cloud.tencent.com', name: '腾讯云社区' },
  { suffix: 'developer.aliyun.com', name: '阿里云开发者社区' },
  { suffix: 'huaweicloud.com', name: '华为云社区' },
  { suffix: 'thepaper.cn', name: '澎湃新闻' },
  { suffix: 'guancha.cn', name: '观察者网' },
  { suffix: 'ifeng.com', name: '凤凰网' },
  { suffix: 'qq.com', name: '腾讯网' },
  { suffix: 'sina.com.cn', name: '新浪' },
  { suffix: 'medium.com', name: 'Medium' },
  { suffix: 'dev.to', name: 'DEV' },
  { suffix: 'reddit.com', name: 'Reddit' },
  { suffix: 'youtube.com', name: 'YouTube' },
  { suffix: 'twitter.com', name: 'Twitter/X' },
  { suffix: 'x.com', name: 'X' },
  { suffix: 'linkedin.com', name: 'LinkedIn' },
  { suffix: 'github.com', name: 'GitHub' },
  { suffix: 'stackoverflow.com', name: 'Stack Overflow' },
  { suffix: 'huggingface.co', name: 'Hugging Face' },
  { suffix: 'arxiv.org', name: 'arXiv' },
  { suffix: 'producthunt.com', name: 'Product Hunt' },
  { suffix: 'news.ycombinator.com', name: 'Hacker News' },
  { suffix: 'techcrunch.com', name: 'TechCrunch' },
  { suffix: 'theverge.com', name: 'The Verge' },
  { suffix: 'openai.com', name: 'OpenAI' },
  { suffix: 'anthropic.com', name: 'Anthropic' },
  { suffix: 'deepseek.com', name: 'DeepSeek' },
];

const EXCLUDED_DOMAINS = new Set([
  'deepseek.com', 'chat.deepseek.com',
  'doubao.com', 'www.doubao.com',
  'openai.com', 'chat.openai.com',
  'claude.ai', 'www.claude.ai', 'anthropic.com',
  'kimi.com', 'www.kimi.com', 'moonshot.cn', 'kimi.moonshot.cn',
  'qianwen.com', 'www.qianwen.com', 'tongyi.aliyun.com',
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

interface DomainEntry {
  domain: string;
  count: number;
  urls: string[];
  platform?: string;
}

interface DomainExtraction {
  query: string;
  totalUrls: number;
  totalDomains: number;
  domains: DomainEntry[];
}

interface SearchResult {
  id: string;
  query: string;
  engine: string;
  results: Array<{ title: string; url: string; snippet: string; position: number }>;
  total: number;
  timestamp: number;
  duration: string;
  rawResponse?: string;
  domainExtraction?: DomainExtraction;
}

interface CollectResult {
  success: boolean;
  engine: string;
  query: string;
  data: SearchResult | null;
  errors?: string[];
  timestamp: number;
  duration: number;
}

interface BatchCollectResult {
  totalEngines: number;
  successfulEngines: number;
  failedEngines: number;
  results: CollectResult[];
  summary: {
    totalResults: number;
    totalUrls: number;
    uniqueDomains: number;
    topEngines: { engine: string; count: number }[];
  };
  timestamp: number;
  duration: number;
}

interface CompanyRank {
  name: string;
  domain: string;
  type: string;
  score: number;
  occurrences: number;
  engines: string[];
  firstSeen: string;
  lastSeen: string;
}

interface TrendData {
  domain: string;
  dates: string[];
  counts: number[];
  growthRate: number;
  trend: 'up' | 'down' | 'stable';
}

function getPage(ctx: CommandContext): Page {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面，请使用 --cdp 参数连接到已打开的浏览器');
  return page;
}

function matchPlatform(domain: string): string | undefined {
  for (const { suffix, name } of PLATFORM_SUFFIX_MAP) {
    if (domain === suffix || domain.endsWith('.' + suffix)) return name;
  }
  return undefined;
}

function getPlatformType(domain: string): string {
  const d = domain.toLowerCase();
  if (d.includes('.gov') || d.includes('.gov.cn')) return 'government';
  if (d.includes('zhipin') || d.includes('lagou') || d.includes('51job') || d.includes('zhaopin')) return 'job-platform';
  if (d.includes('weixin') || d.includes('toutiao') || d.includes('36kr') || d.includes('weibo')) return 'media';
  if (d.includes('openai') || d.includes('anthropic') || d.includes('deepseek') || d.includes('huggingface')) return 'ai-platform';
  return 'enterprise';
}

function isNoiseUrl(url: string): boolean {
  if (NOISE_EXTENSIONS.test(url)) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (NOISE_DOMAIN_PATTERNS.some(p => p.test(host) || p.test(path))) return true;
    if (path.includes('/favicon') || path.includes('/robots.txt') || path.includes('/sitemap')) return true;
  } catch { /* skip */ }
  return false;
}

function generateId(query: string, engine: string): string {
  return createHash('sha256')
    .update(`${engine}:${query}:${Date.now()}`)
    .digest('hex')
    .slice(0, 16);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function saveResult(result: SearchResult): Promise<string> {
  const engineDir = path.join(DATA_BASE, 'engines', result.engine);
  const dateDir = path.join(
    DATA_BASE,
    'by-date',
    new Date().getFullYear().toString(),
    (new Date().getMonth() + 1).toString().padStart(2, '0'),
    new Date().getDate().toString().padStart(2, '0'),
  );
  await ensureDir(engineDir);
  await ensureDir(dateDir);

  const filename = `${result.id}.json`;
  const data = JSON.stringify(result, null, 2);
  await Promise.all([
    fs.writeFile(path.join(engineDir, filename), data, 'utf-8'),
    fs.writeFile(path.join(dateDir, filename), data, 'utf-8'),
  ]);
  return filename;
}

async function loadAllHistory(limit: number = 1000): Promise<SearchResult[]> {
  const enginesDir = path.join(DATA_BASE, 'engines');
  const allResults: SearchResult[] = [];

  try {
    const engines = await fs.readdir(enginesDir);
    for (const engine of engines) {
      const enginePath = path.join(enginesDir, engine);
      const stat = await fs.stat(enginePath);
      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(enginePath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(enginePath, file), 'utf-8');
          allResults.push(JSON.parse(content) as SearchResult);
        } catch {
          continue;
        }
      }
    }
  } catch {
    return [];
  }

  return allResults.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

async function collectFromEngine(
  page: Page,
  engineKey: string,
  query: string,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CollectResult> {
  const startTime = Date.now();
  const config = getEngineConfig(engineKey);

  if (!config) {
    return ok(null, []);
  }

  try {
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(config.extraWait || 3000);

    await navigateToChat(page, config as EngineConfig & { key: string });

    const interceptedUrls: string[] = [];
    const responseListener = async (response: import('playwright').Response) => {
      const respUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      const isJsonOrStream = contentType.includes('text/event-stream') || contentType.includes('application/json');
      if (!isJsonOrStream) return;
      const shouldIntercept = config.apiPattern
        ? respUrl.includes(config.apiPattern)
        : respUrl.includes('/chat/completion') || respUrl.includes('/completion') || respUrl.includes('/conversation');
      if (!shouldIntercept) return;
      try {
        const body = await response.text();
        const matches = body.match(/https?:\/\/[^\s"'`>\}\]\)]+/g);
        if (matches) interceptedUrls.push(...matches);
      } catch { /* ignore */ }
    };
    page.on('response', responseListener);

    const loginStatus = await detectLoginStatus(page, config);
    if (loginStatus === 'logged_out') {
      page.off('response', responseListener);
    return ok(null, []);
    }

    const inputText = buildSearchPrompt(query, config.isSearchFirst);
    const inputFilled = await findAndFillInput(page, config as EngineConfig & { key: string }, inputText);
    if (!inputFilled) {
      page.off('response', responseListener);
    return ok(null, []);
    }

    await page.waitForTimeout(500);

    if (config.sendMethod === 'button' && (config as EngineConfig & { sendButtonSelector?: string }).sendButtonSelector) {
      const btn = page.locator((config as EngineConfig & { sendButtonSelector?: string }).sendButtonSelector!).first();
      if ((await btn.count()) > 0) {
        await btn.click();
      } else {
        await page.keyboard.press('Enter');
      }
    } else if (config.sendMethod === 'metaEnter') {
      await page.keyboard.press('Meta+Enter');
    } else if (config.navigateOnSend) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        page.keyboard.press('Enter'),
      ]);
      await page.waitForTimeout(3000);
    } else {
      await page.keyboard.press('Enter');
    }

    let rawResponse = '';
    if (config.skipResponseWait) {
      await page.waitForTimeout(Math.min(timeout, 60000));
      rawResponse = await page.evaluate(() => document.body?.textContent?.slice(0, 5000) || '');
    } else {
      rawResponse = await waitForAIResponse(page, timeout);
    }

    page.off('response', responseListener);

    if (!rawResponse || rawResponse.length < 10) {
    return ok(null, []);
    }

    const domUrls = await extractSourcesFromDOM(page, config as EngineConfig & { key: string });
    const allRawUrls = [...new Set([...interceptedUrls, ...domUrls])];

    const urlMap = new Map<string, string[]>();
    for (const rawUrl of allRawUrls) {
      if (isNoiseUrl(rawUrl)) continue;
      const cleaned = rawUrl.replace(/[.,;:!?\)\]}>]+$/, '');
      try {
        const u = new URL(cleaned);
        const domain = u.hostname.replace(/^www\./, '');
        if (!urlMap.has(domain)) urlMap.set(domain, []);
        const list = urlMap.get(domain)!;
        if (!list.includes(cleaned)) list.push(cleaned);
      } catch { /* skip */ }
    }

    const domainEntries = Array.from(urlMap.entries())
      .filter(([domain]) => !EXCLUDED_DOMAINS.has(domain))
      .map(([domain, urls]) => ({
        domain,
        count: urls.length,
        urls,
        platform: matchPlatform(domain),
      }))
      .sort((a, b) => b.count - a.count);

    const totalUrls = domainEntries.reduce((sum, d) => sum + d.urls.length, 0);

    const searchResult: SearchResult = {
      id: generateId(query, engineKey),
      query,
      engine: engineKey,
      results: [],
      total: domainEntries.length,
      timestamp: Date.now(),
      duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      rawResponse,
      domainExtraction: {
        query,
        totalUrls,
        totalDomains: domainEntries.length,
        domains: domainEntries,
      },
    };

    await saveResult(searchResult);

    return ok(searchResult, []);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return ok(null, []);
  }
}

function analyzeDomainRankings(results: SearchResult[]): Array<{
  domain: string;
  count: number;
  urls: string[];
  platform?: string;
  firstSeen: string;
  lastSeen: string;
}> {
  const domainMap = new Map<string, {
    domain: string;
    count: number;
    urls: string[];
    platform?: string;
    firstSeen: string;
    lastSeen: string;
  }>();

  results.forEach(result => {
    if (!result.domainExtraction) return;
    result.domainExtraction.domains.forEach(domainData => {
      const { domain } = domainData;
      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          domain,
          count: 0,
          urls: [],
          platform: matchPlatform(domain),
          firstSeen: new Date(result.timestamp).toISOString(),
          lastSeen: new Date(result.timestamp).toISOString(),
        });
      }
      const entry = domainMap.get(domain)!;
      entry.count += domainData.count;
      entry.urls.push(...domainData.urls);
      const ts = new Date(result.timestamp).toISOString();
      if (ts < entry.firstSeen) entry.firstSeen = ts;
      if (ts > entry.lastSeen) entry.lastSeen = ts;
    });
  });

  return Array.from(domainMap.values())
    .filter(d => !EXCLUDED_DOMAINS.has(d.domain))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
}

function calculateCompanyRankings(results: SearchResult[]): CompanyRank[] {
  const domainScores = new Map<string, CompanyRank>();

  results.forEach(result => {
    if (!result.domainExtraction) return;
    result.domainExtraction.domains.forEach(domain => {
      const domainLower = domain.domain.toLowerCase();
      const existing = domainScores.get(domainLower);

      if (!existing) {
        domainScores.set(domainLower, {
          name: domain.platform || domain.domain,
          domain: domain.domain,
          type: getPlatformType(domain.domain),
          score: domain.count,
          occurrences: domain.count,
          engines: [result.engine],
          firstSeen: new Date(result.timestamp).toISOString(),
          lastSeen: new Date(result.timestamp).toISOString(),
        });
      } else {
        existing.score += domain.count;
        existing.occurrences += domain.count;
        if (!existing.engines.includes(result.engine)) {
          existing.engines.push(result.engine);
        }
        const ts = new Date(result.timestamp).toISOString();
        if (ts < existing.firstSeen) existing.firstSeen = ts;
        if (ts > existing.lastSeen) existing.lastSeen = ts;
      }
    });
  });

  return Array.from(domainScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
}

function analyzeTrends(results: SearchResult[]): TrendData[] {
  const domainTrends = new Map<string, { dates: string[]; counts: number[] }>();

  results.forEach(result => {
    if (!result.domainExtraction) return;
    const dateKey = new Date(result.timestamp).toISOString().split('T')[0];
    result.domainExtraction.domains.forEach(domain => {
      if (!domainTrends.has(domain.domain)) {
        domainTrends.set(domain.domain, { dates: [], counts: [] });
      }
      const trend = domainTrends.get(domain.domain)!;
      trend.dates.push(dateKey);
      trend.counts.push(domain.count);
    });
  });

  const trends: TrendData[] = [];
  domainTrends.forEach((data, domain) => {
    if (data.dates.length < 2) return;
    const firstCount = data.counts[0];
    const lastCount = data.counts[data.counts.length - 1];
    const growthRate = firstCount > 0 ? ((lastCount - firstCount) / firstCount) * 100 : 0;

    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (growthRate > 10) trend = 'up';
    else if (growthRate < -10) trend = 'down';

    trends.push({ domain, dates: data.dates, counts: data.counts, growthRate, trend });
  });

  return trends.sort((a, b) => Math.abs(b.growthRate) - Math.abs(a.growthRate)).slice(0, 20);
}

function buildMarkdownReport(
  keyword: string,
  collection?: BatchCollectResult,
  domainRankings?: ReturnType<typeof analyzeDomainRankings>,
  companyRankings?: CompanyRank[],
  trends?: TrendData[],
): string {
  const lines: string[] = [
    '# GEO Analysis Report',
    '',
    `Generated: ${new Date().toLocaleString('zh-CN')}`,
    `Keyword: ${keyword}`,
    '',
  ];

  if (collection) {
    lines.push('## Collection Summary');
    lines.push('');
    lines.push(`- **Total Engines**: ${collection.totalEngines}`);
    lines.push(`- **Successful**: ${collection.successfulEngines}`);
    lines.push(`- **Failed**: ${collection.failedEngines}`);
    lines.push(`- **Duration**: ${(collection.duration / 1000).toFixed(2)}s`);
    lines.push(`- **Unique Domains**: ${collection.summary.uniqueDomains}`);
    lines.push(`- **Total URLs**: ${collection.summary.totalUrls}`);
    lines.push('');
  }

  if (domainRankings && domainRankings.length > 0) {
    lines.push('## Top 20 Domain Rankings');
    lines.push('');
    lines.push('| Rank | Domain | Platform | URLs | First Seen | Last Seen |');
    lines.push('|------|--------|----------|------|------------|-----------|');
    domainRankings.slice(0, 20).forEach((d, i) => {
      const platform = d.platform || '-';
      lines.push(`| ${i + 1} | ${d.domain} | ${platform} | ${d.count} | ${new Date(d.firstSeen).toLocaleDateString()} | ${new Date(d.lastSeen).toLocaleDateString()} |`);
    });
    lines.push('');
  }

  if (companyRankings && companyRankings.length > 0) {
    lines.push('## Top 20 Companies by Rank');
    lines.push('');
    lines.push('| Rank | Name | Domain | Type | Score | Engines |');
    lines.push('|------|------|--------|------|-------|---------|');
    companyRankings.slice(0, 20).forEach((rank, i) => {
      lines.push(`| ${i + 1} | ${rank.name} | ${rank.domain} | ${rank.type} | ${rank.score} | ${rank.engines.length} |`);
    });
    lines.push('');
  }

  if (trends && trends.length > 0) {
    lines.push('## Top 10 Trends');
    lines.push('');
    lines.push('| Domain | Growth Rate | Trend |');
    lines.push('|--------|-------------|-------|');
    trends.slice(0, 10).forEach(t => {
      const arrow = t.trend === 'up' ? 'UP' : t.trend === 'down' ? 'DOWN' : 'STABLE';
      lines.push(`| ${t.domain} | ${t.growthRate.toFixed(1)}% | ${arrow} |`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'geo-analysis',
    url: 'https://multi-engine',
    description: 'GEO 外链排名分析 - 多引擎数据采集、域名排名、企业排名、趋势分析 (v2.0 SSE+DOM)',
    requiresLogin: false,
    isLogin: async () => true,
  });

  site.command('collect', {
    description: '从单个 AI 搜索引擎采集数据（SSE 拦截 + DOM 提取），提取外链域名排名',
    scope: 'browser',
    parameters: z.object({
      keyword: z.string().describe('搜索关键词'),
      engine: z.string().default('deepseek').describe(`AI 搜索引擎名称: ${ALL_ENGINES.join(', ')}`),
      format: z.enum(['json', 'markdown', 'text']).default('json').describe('输出格式'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis collect --keyword "AI 编程工具"', description: '使用默认引擎(deepseek)采集' },
      { cmd: 'xbrowser geo-analysis collect --keyword "AI 编程工具" --engine doubao', description: '指定豆包引擎采集' },
      { cmd: 'xbrowser geo-analysis collect --keyword "Rust 语言" --engine metaso --format markdown', description: '秘塔引擎，Markdown 格式' },
    ],
    result: z.object({ id: z.string(), query: z.string(), engine: z.string(), results: z.array(z.any()), total: z.number(), timestamp: z.number(), duration: z.string(), rawResponse: z.string().optional(), domainExtraction: z.object({ query: z.string(), totalUrls: z.number(), totalDomains: z.number(), domains: z.array(z.any()) }).optional(), markdown: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensureDir(DATA_BASE);
        await ensureDir(path.join(DATA_BASE, 'engines'));

        console.log(`[GEO] 从 ${params.engine} 采集 "${params.keyword}"...`);

        const result = await collectFromEngine(page, params.engine, params.keyword);

        if (!result.success) {
          return fail(`采集失败: ${result.errors?.join(', ')}`, [
            `❌ ${params.engine} 采集失败`,
          ]);
        }

        const output = result.data;
        if (params.format === 'markdown' && output) {
          const md = buildMarkdownReport(params.keyword, undefined, output.domainExtraction ? [{
            domain: '',
            count: 0,
            urls: [],
            firstSeen: '',
            lastSeen: '',
            ...output.domainExtraction.domains.reduce((_, d) => d, {}),
          }] : undefined);
    return ok({ markdown: md }, [
      `引擎: ${params.engine}`, `域名数: ${output.domainExtraction?.totalDomains || 0}`, `URL数: ${output.domainExtraction?.totalUrls || 0}`,
    ]);
  }

    return ok(output, [
      `引擎: ${params.engine}`,
    ]);
  } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['采集失败']);
  }
    },
  });

  site.command('batch', {
    description: '批量从多个 AI 搜索引擎采集数据（SSE + DOM 提取），汇总域名排名',
    scope: 'browser',
    parameters: z.object({
      keyword: z.string().describe('搜索关键词'),
      engines: z.string().default('deepseek,kimi,doubao').describe('逗号分隔的引擎列表'),
      format: z.enum(['json', 'markdown', 'text']).default('json').describe('输出格式'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis batch --keyword "AI 编程工具"', description: '使用默认3引擎采集' },
      { cmd: 'xbrowser geo-analysis batch --keyword "Rust" --engines "deepseek,kimi,qianwen,chatglm"', description: '指定4引擎采集' },
      { cmd: 'xbrowser geo-analysis batch --keyword "Web3" --format markdown', description: 'Markdown 格式输出' },
    ],
    result: z.object({ totalEngines: z.number(), successfulEngines: z.number(), failedEngines: z.number(), results: z.array(z.any()), summary: z.object({ totalResults: z.number(), totalUrls: z.number(), uniqueDomains: z.number(), topEngines: z.array(z.object({ engine: z.string(), count: z.number() })) }), timestamp: z.number(), duration: z.number(), markdown: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensureDir(DATA_BASE);

        const engineList = params.engines.split(',').map(e => e.trim()).filter(Boolean);
        const startTime = Date.now();
        const results: CollectResult[] = [];

        for (let i = 0; i < engineList.length; i++) {
          const engine = engineList[i];
          console.log(`[${i + 1}/${engineList.length}] 采集 ${engine}...`);

          const result = await collectFromEngine(page, engine, params.keyword);
          results.push(result);

          if (result.success) {
            console.log(`  ✅ ${engine}: ${result.data?.domainExtraction?.totalDomains || 0} 域名`);
          } else {
            console.log(`  ❌ ${engine}: ${result.errors?.join(', ')}`);
          }

          if (i < engineList.length - 1) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ENGINES));
          }
        }

        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const allData = successful.map(r => r.data!).filter(Boolean);

        const urlMap = new Map<string, number>();
        successful.forEach(r => {
          r.data?.domainExtraction?.domains.forEach(d => {
            urlMap.set(d.domain, (urlMap.get(d.domain) || 0) + d.count);
          });
        });

        const batchResult: BatchCollectResult = {
          totalEngines: engineList.length,
          successfulEngines: successful.length,
          failedEngines: failed.length,
          results,
          summary: {
            totalResults: allData.reduce((s, d) => s + d.total, 0),
            totalUrls: Array.from(urlMap.values()).reduce((s, c) => s + c, 0),
            uniqueDomains: urlMap.size,
            topEngines: engineList.map(e => ({ engine: e, count: results.filter(r => r.engine === e && r.success).length })),
          },
          timestamp: Date.now(),
          duration: Date.now() - startTime,
        };

        if (params.format === 'markdown') {
          const allResults = allData as SearchResult[];
          const domainRankings = analyzeDomainRankings(allResults);
          const md = buildMarkdownReport(params.keyword, batchResult, domainRankings);
    return ok({ markdown: md }, [
      `引擎: ${engineList.length}`, `成功: ${successful.length}`, `失败: ${failed.length}`, `域名: ${urlMap.size}`,
    ]);
  }

    return ok(batchResult, [
      `引擎: ${engineList.length}`,
    ]);
  } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['批量采集失败']);
  }
    },
  });

  site.command('rank', {
    description: '基于历史采集数据生成域名排名和平台排名（去噪后统计）',
    scope: 'global',
    parameters: z.object({
      format: z.enum(['json', 'markdown', 'text']).default('json').describe('输出格式'),
      top: z.number().default(20).describe('显示前 N 名'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis rank', description: '生成域名排名（前20）' },
      { cmd: 'xbrowser geo-analysis rank --top 50 --format markdown', description: '前50名，Markdown 格式' },
    ],
    result: z.union([z.array(z.object({ domain: z.string(), count: z.number(), urls: z.array(z.string()), platform: z.string().optional(), firstSeen: z.string(), lastSeen: z.string() })), z.object({ markdown: z.string() })]).passthrough(),
    handler: async (params) => {
      try {
        const history = await loadAllHistory(500);
        if (history.length === 0) {
    return ok([], ['无历史数据，请先使用 collect 或 batch 采集数据']);
        }

        const rankings = analyzeDomainRankings(history).slice(0, params.top);

        if (params.format === 'markdown') {
          const lines = [
            '# Domain Rankings',
            '',
            `Generated: ${new Date().toLocaleString('zh-CN')}`,
            `Data Points: ${history.length}`,
            '',
            '| Rank | Domain | Platform | URLs | First Seen | Last Seen |',
            '|------|--------|----------|------|------------|-----------|',
          ];
          rankings.forEach((d, i) => {
            lines.push(`| ${i + 1} | ${d.domain} | ${d.platform || '-'} | ${d.count} | ${new Date(d.firstSeen).toLocaleDateString()} | ${new Date(d.lastSeen).toLocaleDateString()} |`);
          });
    return ok({ markdown: lines.join('\n') }, []);
        }

    return ok(rankings, [`数据点: ${history.length}`]);
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['排名生成失败']);
      }
    },
  });

  site.command('all', {
    description: '一键搜索所有 AI 引擎（SSE 拦截 + DOM 提取 + 去噪过滤），自动聚合排名',
    scope: 'browser',
    parameters: z.object({
      keyword: z.string().describe('搜索关键词'),
      format: z.enum(['json', 'markdown', 'text']).default('markdown').describe('输出格式'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis all --keyword "AI 编程工具"', description: '搜索所有引擎并聚合' },
      { cmd: 'xbrowser geo-analysis all --keyword "Rust" --format json', description: 'JSON 格式输出' },
    ],
    result: z.object({ query: z.string(), totalEngines: z.number(), successEngines: z.number(), failedEngines: z.number(), totalUrls: z.number(), uniqueDomains: z.number(), domainRanking: z.array(z.any()), platformRanking: z.array(z.any()), engineDetails: z.array(z.any()), markdown: z.string().optional() }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = getPage(ctx);
        await ensureDir(DATA_BASE);

        const startTime = Date.now();
        const results: CollectResult[] = [];

        for (let i = 0; i < ALL_ENGINES.length; i++) {
          const engineKey = ALL_ENGINES[i];
          const config = getEngineConfig(engineKey);
          console.log(`[${i + 1}/${ALL_ENGINES.length}] 搜索 ${config?.name || engineKey}...`);

          const result = await collectFromEngine(page, engineKey, params.keyword);
          results.push(result);

          if (result.success) {
            console.log(`  ✅ ${config?.name}: ${result.data?.domainExtraction?.totalDomains || 0} 域名`);
          } else {
            console.log(`  ❌ ${config?.name}: ${result.errors?.join(', ')}`);
          }

          if (i < ALL_ENGINES.length - 1) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ENGINES));
          }
        }

        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const allData = successful.map(r => r.data!).filter(Boolean);

        const domainRanking = new Map<string, { count: number; urls: string[]; engines: Set<string> }>();
        successful.forEach(r => {
          r.data?.domainExtraction?.domains.forEach(d => {
            if (!domainRanking.has(d.domain)) {
              domainRanking.set(d.domain, { count: 0, urls: [], engines: new Set() });
            }
            const entry = domainRanking.get(d.domain)!;
            entry.count += d.count;
            d.urls.forEach(u => { if (!entry.urls.includes(u)) entry.urls.push(u); });
            entry.engines.add(r.engine);
          });
        });

        const rankedDomains = Array.from(domainRanking.entries())
          .map(([domain, data]) => ({
            domain,
            platform: matchPlatform(domain),
            totalCount: data.count,
            engineCount: data.engines.size,
            engines: Array.from(data.engines),
            urls: data.urls,
          }))
          .sort((a, b) => {
            if (b.engineCount !== a.engineCount) return b.engineCount - a.engineCount;
            return b.totalCount - a.totalCount;
          });

        const platformMap = new Map<string, { count: number; engines: Set<string> }>();
        rankedDomains.forEach(d => {
          if (d.platform) {
            if (!platformMap.has(d.platform)) platformMap.set(d.platform, { count: 0, engines: new Set() });
            const p = platformMap.get(d.platform)!;
            p.count += d.totalCount;
            d.engines.forEach(e => p.engines.add(e));
          }
        });

        const platformRanking = Array.from(platformMap.entries())
          .map(([platform, data]) => ({ platform, totalCount: data.count, engines: Array.from(data.engines) }))
          .sort((a, b) => b.totalCount - a.totalCount);

        const aggResult = {
          query: params.keyword,
          totalEngines: ALL_ENGINES.length,
          successEngines: successful.length,
          failedEngines: failed.length,
          totalUrls: rankedDomains.reduce((s, d) => s + d.urls.length, 0),
          uniqueDomains: domainRanking.size,
          domainRanking: rankedDomains,
          platformRanking,
          engineDetails: results.map(r => {
            const config = getEngineConfig(r.engine);
            return {
              engine: r.engine,
              name: config?.name || r.engine,
              success: r.success,
              urlCount: r.data?.domainExtraction?.totalUrls || 0,
              domainCount: r.data?.domainExtraction?.totalDomains || 0,
              duration: r.data?.duration,
              error: r.errors?.join(', '),
            };
          }),
        };

        await saveResult({
          id: generateId(params.keyword, 'all'),
          query: params.keyword,
          engine: 'all',
          results: [],
          total: rankedDomains.length,
          timestamp: Date.now(),
          duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
          domainExtraction: {
            query: params.keyword,
            totalUrls: aggResult.totalUrls,
            totalDomains: rankedDomains.length,
            domains: rankedDomains.map(d => ({ domain: d.domain, count: d.totalCount, urls: d.urls, platform: d.platform })),
          },
        });

        if (params.format === 'markdown') {
          const lines = [
            `## GEO 聚合搜索结果`,
            `**查询**：${params.keyword}`,
            `**引擎数**：${aggResult.totalEngines}（成功 ${aggResult.successEngines}，失败 ${aggResult.failedEngines}）`,
            `**总 URL**：${aggResult.totalUrls} | **去重域名**：${aggResult.uniqueDomains}`,
            '',
          ];

          if (rankedDomains.length > 0) {
            const topN = rankedDomains.slice(0, 20);
            lines.push(`### 域名排名 Top ${topN.length}`);
            lines.push('');
            lines.push('| # | 域名 | 平台 | 引擎数 | 频次 | 来源引擎 |');
            lines.push('|---|------|------|--------|------|----------|');
            for (let i = 0; i < topN.length; i++) {
              const d = topN[i];
              lines.push(`| ${i + 1} | ${d.domain} | ${d.platform || '-'} | ${d.engineCount} | ${d.totalCount} | ${d.engines.join(', ')} |`);
            }
            lines.push('');
          }

          if (platformRanking.length > 0) {
            lines.push(`### 平台排名（可发帖平台）`);
            lines.push('');
            lines.push('| # | 平台 | 引用频次 | 涉及引擎 |');
            lines.push('|---|------|---------|----------|');
            for (let i = 0; i < platformRanking.length; i++) {
              const p = platformRanking[i];
              lines.push(`| ${i + 1} | ${p.platform} | ${p.totalCount} | ${p.engines.join(', ')} |`);
            }
            lines.push('');
          }

          lines.push(`### 各引擎结果`);
          lines.push('');
          lines.push('| 状态 | 引擎 | URLs | 域名 | 耗时 | 错误 |');
          lines.push('|------|------|------|------|------|------|');
          for (const d of aggResult.engineDetails) {
            const status = d.success ? '✅' : '❌';
            lines.push(`| ${status} | ${d.name} | ${d.urlCount} | ${d.domainCount} | ${d.duration || '-'} | ${d.error ? d.error.slice(0, 50) : '-'} |`);
          }

    return ok({ markdown: lines.join('\n') }, []);
        }

    return ok(aggResult, [`引擎: ${aggResult.totalEngines}`]);
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['聚合搜索失败']);
      }
    },
  });

  site.command('company', {
    description: '基于历史采集数据生成企业排名，按跨引擎出现频次评分',
    scope: 'global',
    parameters: z.object({
      format: z.enum(['json', 'markdown', 'text']).default('json').describe('输出格式'),
      top: z.number().default(20).describe('显示前 N 名企业'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis company', description: '生成企业排名' },
      { cmd: 'xbrowser geo-analysis company --top 30 --format markdown', description: '前30名，Markdown 格式' },
    ],
    result: z.union([z.array(z.object({ name: z.string(), domain: z.string(), type: z.string(), score: z.number(), occurrences: z.number(), engines: z.array(z.string()), firstSeen: z.string(), lastSeen: z.string() })), z.object({ markdown: z.string() })]).passthrough(),
    handler: async (params) => {
      try {
        const history = await loadAllHistory(500);
        if (history.length === 0) {
    return ok([], ['无历史数据，请先使用 collect 或 batch 采集数据']);
        }

        const rankings = calculateCompanyRankings(history).slice(0, params.top);

        if (params.format === 'markdown') {
          const lines = [
            '# Company Rankings',
            '',
            `Generated: ${new Date().toLocaleString('zh-CN')}`,
            `Data Points: ${history.length}`,
            '',
            '| Rank | Name | Domain | Type | Score | Engines |',
            '|------|------|--------|------|-------|---------|',
          ];
          rankings.forEach((r, i) => {
            lines.push(`| ${i + 1} | ${r.name} | ${r.domain} | ${r.type} | ${r.score} | ${r.engines.join(',')} |`);
          });
    return ok({ markdown: lines.join('\n') }, []);
        }

    return ok(rankings, [`数据点: ${history.length}`]);
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['企业排名生成失败']);
      }
    },
  });

  site.command('trend', {
    description: '基于历史采集数据分析域名出现趋势，识别上升/下降/稳定域名',
    scope: 'global',
    parameters: z.object({
      format: z.enum(['json', 'markdown', 'text']).default('json').describe('输出格式'),
      top: z.number().default(20).describe('显示前 N 个趋势'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis trend', description: '分析趋势' },
      { cmd: 'xbrowser geo-analysis trend --top 10 --format markdown', description: '前10个趋势，Markdown 格式' },
    ],
    result: z.union([z.array(z.object({ domain: z.string(), dates: z.array(z.string()), counts: z.array(z.number()), growthRate: z.number(), trend: z.enum(['up', 'down', 'stable']) })), z.object({ markdown: z.string() })]).passthrough(),
    handler: async (params) => {
      try {
        const history = await loadAllHistory(500);
        if (history.length === 0) {
    return ok([], ['无历史数据，请先使用 collect 或 batch 采集数据']);
        }

        const trends = analyzeTrends(history).slice(0, params.top);

        if (params.format === 'markdown') {
          const lines = [
            '# Domain Trend Analysis',
            '',
            `Generated: ${new Date().toLocaleString('zh-CN')}`,
            `Data Points: ${history.length}`,
            '',
            '| Domain | Growth Rate | Trend |',
            '|--------|-------------|-------|',
          ];
          trends.forEach(t => {
            const arrow = t.trend === 'up' ? 'UP' : t.trend === 'down' ? 'DOWN' : 'STABLE';
            lines.push(`| ${t.domain} | ${t.growthRate.toFixed(1)}% | ${arrow} |`);
          });
    return ok({ markdown: lines.join('\n') }, []);
        }

    return ok(trends, [`数据点: ${history.length}`]);
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['趋势分析失败']);
      }
    },
  });

  site.command('report', {
    description: '基于历史数据生成完整的 GEO 分析报告，包含域名排名、企业排名和趋势分析',
    scope: 'global',
    parameters: z.object({
      keyword: z.string().default('').describe('报告关联的关键词（留空则包含所有数据）'),
      format: z.enum(['json', 'markdown']).default('markdown').describe('输出格式（默认 markdown）'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis report', description: '生成 Markdown 格式报告' },
      { cmd: 'xbrowser geo-analysis report --keyword "AI" --format json', description: '指定关键词，JSON 格式' },
    ],
    result: z.object({ path: z.string(), keyword: z.string().optional(), generatedAt: z.number().optional(), domainRankings: z.array(z.any()).optional(), companyRankings: z.array(z.any()).optional(), trends: z.array(z.any()).optional(), stats: z.object({ dataPoints: z.number(), uniqueDomains: z.number(), companies: z.number() }).optional() }).passthrough(),
    handler: async (params) => {
      try {
        const history = await loadAllHistory(1000);
        if (history.length === 0) {
    return fail('⚠ 无历史数据', ['无历史数据，请先使用 collect 或 batch 采集数据']);
        }

        const domainRankings = analyzeDomainRankings(history);
        const companyRankings = calculateCompanyRankings(history);
        const trends = analyzeTrends(history);

        const reportsDir = path.join(DATA_BASE, 'reports');
        await ensureDir(reportsDir);

        if (params.format === 'markdown') {
          const md = buildMarkdownReport(params.keyword || 'All', undefined, domainRankings, companyRankings, trends);
          const filename = `geo-report-${Date.now()}.md`;
          const filepath = path.join(reportsDir, filename);
          await fs.writeFile(filepath, md, 'utf-8');

    return ok({ path: filepath }, []);
        }

        const reportData = {
          keyword: params.keyword,
          generatedAt: Date.now(),
          domainRankings,
          companyRankings,
          trends,
          stats: {
            dataPoints: history.length,
            uniqueDomains: domainRankings.length,
            companies: companyRankings.length,
          },
        };

        const filename = `geo-report-${Date.now()}.json`;
        const filepath = path.join(reportsDir, filename);
        await fs.writeFile(filepath, JSON.stringify(reportData, null, 2), 'utf-8');

    return ok({ path: filepath }, []);
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['报告生成失败']);
      }
    },
  });

  site.command('history', {
    description: '查看历史采集记录，按时间倒序排列',
    scope: 'global',
    parameters: z.object({
      limit: z.number().default(20).describe('显示条数'),
      engine: z.string().optional().describe('按引擎过滤'),
    }),
    examples: [
      { cmd: 'xbrowser geo-analysis history', description: '查看最近20条' },
      { cmd: 'xbrowser geo-analysis history --limit 50 --engine deepseek', description: '查看 deepseek 的50条' },
    ],
    result: z.array(z.object({ id: z.string(), query: z.string(), engine: z.string(), total: z.number(), domains: z.number(), urls: z.number(), timestamp: z.string() })),
    handler: async (params) => {
      try {
        let history = await loadAllHistory(1000);

        if (params.engine) {
          history = history.filter(r => r.engine === params.engine);
        }

        const limited = history.slice(0, params.limit);

        const items = limited.map(r => ({
          id: r.id,
          query: r.query,
          engine: r.engine,
          total: r.total,
          domains: r.domainExtraction?.totalDomains || 0,
          urls: r.domainExtraction?.totalUrls || 0,
          timestamp: new Date(r.timestamp).toLocaleString('zh-CN'),
        }));

    return ok(items, [`总数: ${history.length}`]);
      } catch (error) {
    return ok([], ['获取历史失败']);
      }
    },
  });

  site.command('status', {
    description: '查看 GEO 分析系统状态，包括数据量、引擎分布、存储占用',
    scope: 'global',
    parameters: z.object({}),
    examples: [
      { cmd: 'xbrowser geo-analysis status', description: '查看系统状态' },
    ],
    result: z.object({ version: z.string(), totalRecords: z.number(), totalEngines: z.number(), availableEngines: z.array(z.string()), totalQueries: z.number(), storageSizeBytes: z.number(), storageSizeMB: z.string(), engineDistribution: z.record(z.number()), top10Domains: z.array(z.object({ domain: z.string(), platform: z.string().nullable().optional(), count: z.number() })), oldestRecord: z.string().nullable(), newestRecord: z.string().nullable() }).passthrough(),
    handler: async () => {
      try {
        const history = await loadAllHistory(10000);

        const engines = new Set<string>();
        const queries = new Set<string>();
        let storageSize = 0;

        history.forEach(r => {
          engines.add(r.engine);
          queries.add(r.query);
        });

        try {
          const enginesDir = path.join(DATA_BASE, 'engines');
          const engineDirs = await fs.readdir(enginesDir);
          for (const engine of engineDirs) {
            const enginePath = path.join(enginesDir, engine);
            const stat = await fs.stat(enginePath);
            if (stat.isDirectory()) {
              const files = await fs.readdir(enginePath);
              for (const file of files) {
                const fileStat = await fs.stat(path.join(enginePath, file));
                storageSize += fileStat.size;
              }
            }
          }
        } catch {
          // no data yet for this engine, skip
        }

        const engineDistribution = new Map<string, number>();
        history.forEach(r => {
          engineDistribution.set(r.engine, (engineDistribution.get(r.engine) || 0) + 1);
        });

        const topDomains = new Map<string, number>();
        history.forEach(r => {
          r.domainExtraction?.domains.forEach(d => {
            topDomains.set(d.domain, (topDomains.get(d.domain) || 0) + d.count);
          });
        });

        const status = {
          version: '2.0.0',
          totalRecords: history.length,
          totalEngines: engines.size,
          availableEngines: ALL_ENGINES,
          totalQueries: queries.size,
          storageSizeBytes: storageSize,
          storageSizeMB: (storageSize / 1024 / 1024).toFixed(2),
          engineDistribution: Object.fromEntries(engineDistribution),
          top10Domains: Array.from(topDomains.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([domain, count]) => ({ domain, platform: matchPlatform(domain), count })),
          oldestRecord: history.length > 0 ? new Date(history[history.length - 1].timestamp).toLocaleString('zh-CN') : null,
          newestRecord: history.length > 0 ? new Date(history[0].timestamp).toLocaleString('zh-CN') : null,
        };

    return ok(status, [`版本: v2.0.0`]);
      } catch (error) {
    return fail(error instanceof Error ? error.message : '未知错误', ['获取状态失败']);
      }
    },
  });
}
