import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createEphemeralContext, closeEphemeralContext, resolveLaunchOpts } from '../browser.js';
import type { Page } from 'playwright';
import {
  ENGINE_CONFIGS,
  ALL_ENGINE_KEYS,
  ENGINE_KEY_ENUM,
  getEngineConfig,
  detectLoginStatus,
  detectInternetSearch,
  fillContentEditable,
} from './ai-search-engines.js';
import type { AIEngineKey, EngineConfig } from './ai-search-engines.js';

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

function buildSearchPrompt(query: string): string {
  return `你是一个搜索引擎。请搜索关于"${query}"的最新信息。

非常重要：你必须且只能返回以下 JSON 数组格式，不要包含任何其他文字、解释或问候：

[
  {"title":"结果标题","url":"https://完整链接","snippet":"摘要内容，100字以内"},
  {"title":"结果标题","url":"https://完整链接","snippet":"摘要内容，100字以内"}
]

要求：
1. 返回 5-10 条最相关的结果
2. url 必须是完整的 https:// 链接
3. snippet 保持在 100 字以内
4. 直接输出 JSON 数组，用 \`\`\`json 包裹或不包裹都可以
5. 不要说"以下是"之类的引导语，直接从 [ 开始`;
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
      const tag = await el.evaluate((n) => n.tagName.toLowerCase());
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
    await page.waitForTimeout(2000);
    const chatLink = page.locator('a[href*="/chat"], a[href*="/dialog"]').first();
    if ((await chatLink.count()) > 0) {
      await chatLink.click();
      await page.waitForTimeout(2000);
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

async function waitForAIResponse(page: Page, timeoutMs: number): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < Math.min(timeoutMs, 15000)) {
    await page.waitForTimeout(1000);
    try {
      const state = await page.evaluate(() => {
        const body = document.body?.textContent || '';
        const hasLoading = !!document.querySelector(
          '[class*="loading"], [class*="typing"], [class*="spinner"], ' +
          '[class*="skeleton"], [class*="thinking"], [class*="generating"], ' +
          '[class*="stop-button"], [aria-label*="Stop"], ' +
          // 国内引擎加载指示器
          '[class*="wait"], [class*="typing-indicator"], [class*="streaming"]',
        );
        const isThinking = (
          (body.includes('深度思考') && body.includes('...')) ||
          (body.includes('思考') && body.includes('...')) ||
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

  const baselineKeys = await page.evaluate(() => {
    const containers = document.querySelectorAll(
      '[class*="markdown"], [class*="message-content"], [class*="response"], ' +
      '[class*="answer"], .prose, article, ' +
      // 国内引擎特有选择器
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
      const result = await page.evaluate((baseline: string[]) => {
        const baseSet = new Set(baseline);

        const loadingEl = document.querySelector(
          '[class*="loading"], [class*="typing"], [class*="spinner"], ' +
          '[class*="skeleton"], [class*="thinking"], ' +
          '[class*="wait"], [class*="streaming"]',
        );
        if (loadingEl) {
          const body = document.body?.textContent || '';
          const isThinking = (
            (body.includes('深度思考') && body.includes('...')) ||
            (body.includes('思考') && body.includes('...')) ||
            (body.includes('正在搜索')) ||
            (body.includes('Generating')) ||
            (body.includes('思考中'))
          );
          if (isThinking) return { status: 'processing' };
        }

        const candidates = [
          '[data-message-author-role="assistant"]',
          '[class*="response-message"]',
          '[class*="assistant-message"]',
          // 国内引擎回复容器
          '[class*="segment-assistant"]',
          '[class*="chat-content-item-assi"]',
          '[class*="assistant-msg"]',
          '[class*="bot-message"]',
          '[class*="ai-message"]',
          '[class*="answer-text"]',
        ];

        for (const sel of candidates) {
          const els = document.querySelectorAll(sel);
          for (let i = els.length - 1; i >= 0; i--) {
            const txt = els[i].textContent?.trim() || '';
            if (txt.length > 50 && !baseSet.has(txt.slice(0, 100))) {
              return { status: 'ready', text: txt.slice(0, 5000), isNew: true };
            }
          }
        }

        const allContainers = document.querySelectorAll(
          '[class*="markdown"], [class*="message-content"], [class*="answer"], .prose',
        );

        for (let i = allContainers.length - 1; i >= 0; i--) {
          const txt = allContainers[i].textContent?.trim() || '';
          if (txt.length > 50 && !baseSet.has(txt.slice(0, 100))) {
            return { status: 'ready', text: txt.slice(0, 5000), isNew: true };
          }
        }

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

function parseMarkdownResults(rawText: string): AISearchResultItem[] {
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

async function extractSourcesFromPage(page: Page): Promise<{ total: number; domains: string[]; urls: Array<{ url: string; domain: string }> } | undefined> {
  try {
    const data = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="http"]');
      const seen = new Set<string>();
      const result: Array<{ url: string; domain: string }> = [];
      const linkArray = Array.from(links);
      for (let i = 0; i < linkArray.length; i++) {
        const a = linkArray[i];
        const href = a.getAttribute('href');
        if (!href || seen.has(href)) continue;
        if (!href.match(/^https?:\/\//)) continue;
        seen.add(href);
        try {
          result.push({ url: href, domain: new URL(href).hostname.replace(/^www\./, '') });
        } catch { /* skip */ }
      }
      return result;
    });

    if (data.length === 0) return undefined;

    const domainSet = new Set<string>();
    data.forEach(d => domainSet.add(d.domain));
    const domains = Array.from(domainSet);
    return { total: data.length, domains, urls: data };
  } catch {
    return undefined;
  }
}

export const aiSearchCommand = registerCommand({
  name: 'ai-search',
  description: 'Search via AI engines (16 engines: DeepSeek/Doubao/ChatGPT/Claude/Kimi/通义千问/元宝/智谱/文心/秘塔/天工/星火/海螺/纳米AI) with structured results',
  scope: 'project' as const,
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
    engine: ENGINE_KEY_ENUM.optional().describe('AI 引擎（默认 deepseek）'),
    limit: z.number().default(10).describe('最大结果数'),
    full: z.boolean().default(false).describe('是否包含完整 AI 回复'),
    showSources: z.boolean().default(false).describe('显示引用来源'),
    extractUrls: z.boolean().default(false).describe('提取所有 URL 并按域名聚合，输出可发帖平台清单'),
    format: z.enum(['markdown', 'json', 'text']).default('markdown'),
    timeout: z.number().default(60000).describe('AI 回复超时（毫秒）'),
  }),
  handler: async (params, ctx: BrowserCommandContext): Promise<ReturnType<typeof ok>> => {
    // Explicitly consume format parameter to satisfy linter
    void params.format;
    const { context, page } = await createEphemeralContext(resolveLaunchOpts(ctx));

    const engineKey: AIEngineKey = (params.engine || 'deepseek') as AIEngineKey;
    const config = getEngineConfig(engineKey);
    if (!config) {
      throw new Error(`Unknown AI engine: ${params.engine}. Available: ${ALL_ENGINE_KEYS.join(', ')}`);
    }

    try {
      await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const waitTime = (config.extraWait || 3000);
      await page.waitForTimeout(waitTime);

      await navigateToChat(page, config);

      const loginStatus = await detectLoginStatus(page, config);
      if (loginStatus === 'logged_out') {
        throw new Error(`[${config.name}] 未登录。请先用 xbrowser open ${config.url} 并手动登录，然后再使用 ai-search。`);
      }

      const internetSearchInfo = await detectInternetSearch(page, config);

      const inputText = config.isSearchFirst ? params.query : buildSearchPrompt(params.query);
      const inputFilled = await findAndFillInput(page, config, inputText);
      if (!inputFilled) {
        throw new Error(`无法在 ${config.url} 找到输入框。请确认已登录且页面正常加载。`);
      }

      await page.waitForTimeout(500);

      if (config.sendMethod === 'button' && config.sendButtonSelector) {
        const btn = page.locator(config.sendButtonSelector).first();
        if ((await btn.count()) > 0) {
          await btn.click();
        } else {
          await page.keyboard.press('Enter');
        }
      } else {
        await page.keyboard.press('Enter');
      }

      const startTime = Date.now();
      const rawResponse = await waitForAIResponse(page, params.timeout ?? 60000);
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      if (!rawResponse || rawResponse.length < 10) {
        throw new Error(`AI 引擎 "${engineKey}" 未返回有效回复（超时 ${params.timeout ?? 60000}ms）。请检查浏览器登录状态。`);
      }

      const parsedResults = config.isSearchFirst
        ? parseSearchFirstResults(rawResponse)
        : parseMarkdownResults(rawResponse);
      const limitedResults = parsedResults.slice(0, params.limit ?? 10);

      const aiSearchResult: AISearchResult = {
        query: params.query,
        engine: engineKey,
        results: limitedResults,
        total: limitedResults.length,
        timestamp: Date.now(),
        duration,
        engineInfo: {
          name: config.name,
          loginStatus,
          internetSearch: internetSearchInfo,
          uploadCapabilities: config.upload,
        },
      };

      if (params.full) {
        aiSearchResult.aiResponse = rawResponse;
      }

      if (params.showSources) {
        aiSearchResult.sources = await extractSourcesFromPage(page);
      }

      if (params.extractUrls) {
        const allUrls = new Map<string, string[]>();

        const urlRegex = /https?:\/\/[^\s\)\]"'`>\}]+/g;
        let urlMatch: RegExpExecArray | null;
        const rawText = rawResponse || '';
        while ((urlMatch = urlRegex.exec(rawText)) !== null) {
          const rawUrl = urlMatch[0].replace(/[.,;:!?\)\]}>]+$/, '');
          try {
            const u = new URL(rawUrl);
            const domain = u.hostname.replace(/^www\./, '');
            if (!allUrls.has(domain)) allUrls.set(domain, []);
            const list = allUrls.get(domain)!;
            if (!list.includes(rawUrl)) list.push(rawUrl);
          } catch { /* skip */ }
        }

        const pageSources = await extractSourcesFromPage(page);
        if (pageSources) {
          for (const item of pageSources.urls) {
            if (!allUrls.has(item.domain)) allUrls.set(item.domain, []);
            const list = allUrls.get(item.domain)!;
            if (!list.includes(item.url)) list.push(item.url);
          }
        }

        const excludeDomains = new Set([
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

        const domainEntries = Array.from(allUrls.entries())
          .filter(([domain]) => !excludeDomains.has(domain))
          .map(([domain, urls]) => ({
            domain,
            count: urls.length,
            urls,
            platform: matchPlatform(domain),
          }))
          .sort((a, b) => b.count - a.count);

        const totalUrls = domainEntries.reduce((sum, d) => sum + d.urls.length, 0);

        aiSearchResult.domainExtraction = {
          query: params.query,
          totalUrls,
          totalDomains: domainEntries.length,
          domains: domainEntries,
        };
      }

      if (params.format === 'markdown') {
        const lines = [
          `## AI Search: ${aiSearchResult.query}`,
          `_Engine: ${aiSearchResult.engine} (${config.name}) | Total: ${aiSearchResult.total} | Duration: ${duration}_`,
          '',
        ];

        if (aiSearchResult.engineInfo) {
          const ei = aiSearchResult.engineInfo;
          lines.push(`| Login | Internet Search | Image Upload | File Upload |`);
          lines.push(`|-------|----------------|-------------|-------------|`);
          lines.push(`| ${ei.loginStatus} | ${ei.internetSearch.enabled ? '✅' : '❌'} ${ei.internetSearch.details} | ${ei.uploadCapabilities.image ? '✅' : '❌'} | ${ei.uploadCapabilities.file ? '✅' : '❌'} |`);
          lines.push('');
        }

        if (aiSearchResult.domainExtraction) {
          const ext = aiSearchResult.domainExtraction;
          lines.push(`### URL/域名提取结果`);
          lines.push(`_共提取 ${ext.totalUrls} 个 URL，来自 ${ext.totalDomains} 个域名_`);
          lines.push('');
          lines.push('| # | 域名 | 平台 | URL数 | 链接 |');
          lines.push('|---|------|------|-------|------|');
          for (let i = 0; i < ext.domains.length; i++) {
            const d = ext.domains[i];
            const firstUrl = d.urls[0];
            lines.push(`| ${i + 1} | ${d.platform ? `**${d.platform}** (${d.domain})` : d.domain} | ${d.platform || '-'} | ${d.count} | [打开](${firstUrl}) |`);
          }
          lines.push('');
          lines.push(`---`);
          lines.push(`_提示：以上平台是 AI 搜索"${params.query}"的数据来源，在这些平台发帖可被 AI 引擎引用_`);
          lines.push('');
        }

        for (const r of aiSearchResult.results) {
          lines.push(`### ${r.position}. [${r.title}](${r.url})`);
          lines.push(`> ${r.snippet}`);
          lines.push('');
        }
        if (aiSearchResult.sources) {
          lines.push(`---`);
          lines.push(`_Sources: ${aiSearchResult.sources.total} URLs from ${aiSearchResult.sources.domains.length} domains_`);
        }
        return ok({ ...aiSearchResult, content: lines.join('\n') });
      }

      if (params.format === 'text') {
        const lines = [
          `AI Search: ${aiSearchResult.query} (Engine: ${aiSearchResult.engine}/${config.name}, Total: ${aiSearchResult.total}, Duration: ${duration})`,
          '',
        ];

        if (aiSearchResult.domainExtraction) {
          const ext = aiSearchResult.domainExtraction;
          lines.push(`=== URL/域名提取结果 ===`);
          lines.push(`共提取 ${ext.totalUrls} 个 URL，来自 ${ext.totalDomains} 个域名`);
          lines.push('');
          for (let i = 0; i < ext.domains.length; i++) {
            const d = ext.domains[i];
            const platformLabel = d.platform ? ` [${d.platform}]` : '';
            lines.push(`${i + 1}. ${d.domain}${platformLabel} (${d.count} URLs)`);
            for (const url of d.urls.slice(0, 3)) {
              lines.push(`   -> ${url}`);
            }
            if (d.urls.length > 3) {
              lines.push(`   ... +${d.urls.length - 3} more`);
            }
          }
          lines.push('');
        }

        for (const r of aiSearchResult.results) {
          lines.push(`${r.position}. ${r.title}`);
          lines.push(`   ${r.url}`);
          lines.push(`   ${r.snippet}`);
          lines.push('');
        }
        return ok({ ...aiSearchResult, content: lines.join('\n') });
      }

      return ok(aiSearchResult);
    } finally {
      await closeEphemeralContext(context);
    }
  },
});

function parseSearchFirstResults(rawText: string): AISearchResultItem[] {
  const results = parseMarkdownResults(rawText);
  if (results.length > 0) return results;

  const items: AISearchResultItem[] = [];
  const lines = rawText.split('\n').filter(l => l.trim());
  let pos = 0;

  for (const line of lines) {
    const urlMatch = line.match(/https?:\/\/[^\s\)\]\"'>]+/);
    if (urlMatch) {
      const url = urlMatch[0].replace(/[.,;:!?]+$/, '');
      const title = line.replace(url, '').replace(/[#\-\*>`\[\]]/g, '').trim().slice(0, 150) || 'Result';
      pos++;
      items.push({ title, url, snippet: title, position: pos });
    }
    if (items.length >= 20) break;
  }

  if (items.length === 0) {
    pos++;
    items.push({
      title: rawText.slice(0, 150),
      url: '',
      snippet: rawText.slice(0, 300),
      position: pos,
    });
  }

  return items;
}

export { ENGINE_CONFIGS, buildSearchPrompt, parseMarkdownResults, findAndFillInput, waitForAIResponse };
