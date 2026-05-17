import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createEphemeralContext, closeEphemeralContext, resolveLaunchOpts } from '../browser.js';
import type { Page } from 'playwright';

type AIEngineKey = 'deepseek' | 'doubao' | 'chatgpt' | 'claude';

export interface AISearchResultItem {
  title: string;
  url: string;
  snippet: string;
  position: number;
  aiSummary?: string;
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
  duration?: string;
}

const AI_SEARCH_ENGINES: Record<AIEngineKey, { plugin: string; url: string }> = {
  deepseek: { plugin: 'deepseek', url: 'https://chat.deepseek.com' },
  doubao: { plugin: 'doubao', url: 'https://www.doubao.com' },
  chatgpt: { plugin: 'chatgpt', url: 'https://chat.openai.com' },
  claude: { plugin: 'claude', url: 'https://claude.ai' },
};

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

const INPUT_SELECTORS = [
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
  'textarea[name="search"]',
  '[data-testid="prompt-textarea"]',
  '#prompt-textarea',
];

async function findAndFillInput(page: Page, text: string): Promise<boolean> {
  for (const sel of INPUT_SELECTORS) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: 'visible', timeout: 5000 });
        await el.click();
        await page.waitForTimeout(300);
        await el.fill(text);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function waitForAIResponse(page: Page, timeoutMs: number): Promise<string> {
  const startTime = Date.now();

  // Phase 1: Wait for AI to start processing (loading/thinking indicators appear)
  while (Date.now() - startTime < Math.min(timeoutMs, 15000)) {
    await page.waitForTimeout(1000);
    try {
      const state = await page.evaluate(() => {
        const body = document.body?.textContent || '';
        const hasLoading = !!document.querySelector(
          '[class*="loading"], [class*="typing"], [class*="spinner"], ' +
          '[class*="skeleton"], [class*="thinking"], [class*="generating"], ' +
          '[class*="stop-button"], [aria-label*="Stop"]',
        );
        const isThinking = (
          (body.includes('深度思考') && body.includes('...')) ||
          (body.includes('思考') && body.includes('...')) ||
          (body.includes('正在搜索')) ||
          (body.includes('Searching')) ||
          (body.includes('Generating')) ||
          (body.includes('停止生成'))
        );
        return { hasLoading, isThinking };
      });
      
      if (state.hasLoading || state.isThinking) break;
      if (Date.now() - startTime > 5000) break;
    } catch {
      // ignore
    }
  }

  // Phase 2: Capture current state as baseline, then wait for NEW content
  // This avoids picking up the user's own message (which many AI sites render in markdown containers)
  const baselineKeys = await page.evaluate(() => {
    const containers = document.querySelectorAll('[class*="markdown"], [class*="message-content"], [class*="response"], [class*="answer"], .prose, article');
    const keys = new Set<string>();
    containers.forEach((el) => {
      const txt = el.textContent?.trim() || '';
      if (txt.length > 20) keys.add(txt.slice(0, 100)); // Use first 100 chars as fingerprint
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

        // Still processing?
        const loadingEl = document.querySelector(
          '[class*="loading"], [class*="typing"], [class*="spinner"], ' +
          '[class*="skeleton"], [class*="thinking"]',
        );
        if (loadingEl) {
          const body = document.body?.textContent || '';
          const isThinking = (
            (body.includes('深度思考') && body.includes('...')) ||
            (body.includes('思考') && body.includes('...')) ||
            (body.includes('正在搜索')) ||
            (body.includes('Generating'))
          );
          if (isThinking) return { status: 'processing' };
        }

        // Find containers that are NOT in the baseline (i.e., newly appeared = AI response)
        const candidates = [
          '[data-message-author-role="assistant"]',   // ChatGPT: explicit role attribute
          '[class*="response-message"]',               // Generic response container
          '[class*="assistant-message"]',              // Assistant message
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

        // Broader search: check all markdown-like containers for new ones
        const allContainers = document.querySelectorAll(
          '[class*="markdown"], [class*="message-content"], [class*="answer"], .prose',
        );
        
        for (let i = allContainers.length - 1; i >= 0; i--) {
          const txt = allContainers[i].textContent?.trim() || '';
          if (txt.length > 50 && !baseSet.has(txt.slice(0, 100))) {
            return { status: 'ready', text: txt.slice(0, 5000), isNew: true };
          }
        }

        // No new content yet
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
        
        // Accept earlier if stable enough and sufficient time passed
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

  // Strategy 1: Try to extract JSON array from the response
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
    } catch { /* not valid JSON, continue */ }
  }

  // Strategy 2: Markdown list format ## N. [title](url)
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

  // Strategy 3: Extract any [title](url) links with surrounding context as snippet
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

  // Strategy 4: Standalone URLs in text (last resort)
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
        } catch { /* skip invalid URLs */ }
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
  description: 'Search via AI engines (DeepSeek/Doubao/ChatGPT/Claude) with structured results aligned to search command output',
  scope: 'project' as const,
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
    engine: z.enum(['deepseek', 'doubao', 'chatgpt', 'claude']).optional().describe('AI 引擎（默认 deepseek）'),
    limit: z.number().default(10).describe('最大结果数'),
    full: z.boolean().default(false).describe('是否包含完整 AI 回复'),
    showSources: z.boolean().default(false).describe('显示引用来源'),
    format: z.enum(['markdown', 'json', 'text']).default('markdown'),
    timeout: z.number().default(60000).describe('AI 回复超时（毫秒）'),
  }),
  handler: async (params, ctx: BrowserCommandContext): Promise<ReturnType<typeof ok>> => {
    const { context, page } = await createEphemeralContext(resolveLaunchOpts(ctx));

    const engineKey: AIEngineKey = (params.engine || 'deepseek') as AIEngineKey;
    const engineConfig = AI_SEARCH_ENGINES[engineKey];
    if (!engineConfig) {
      throw new Error(`Unknown AI engine: ${params.engine}. Available: ${Object.keys(AI_SEARCH_ENGINES).join(', ')}`);
    }

    try {
      await page.goto(engineConfig.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      const searchPrompt = buildSearchPrompt(params.query);
      const inputFilled = await findAndFillInput(page, searchPrompt);
      if (!inputFilled) {
        throw new Error(`无法在 ${engineConfig.url} 找到输入框。请确认已登录且页面正常加载。`);
      }

      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');

      const startTime = Date.now();
      const rawResponse = await waitForAIResponse(page, params.timeout ?? 60000);
      const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      if (!rawResponse || rawResponse.length < 10) {
        throw new Error(`AI 引擎 "${engineKey}" 未返回有效回复（超时 ${params.timeout ?? 60000}ms）。请检查浏览器登录状态。`);
      }

      const parsedResults = parseMarkdownResults(rawResponse);
      const limitedResults = parsedResults.slice(0, params.limit ?? 10);

      const aiSearchResult: AISearchResult = {
        query: params.query,
        engine: engineKey,
        results: limitedResults,
        total: limitedResults.length,
        timestamp: Date.now(),
        duration,
      };

      if (params.full) {
        aiSearchResult.aiResponse = rawResponse;
      }

      if (params.showSources) {
        aiSearchResult.sources = await extractSourcesFromPage(page);
      }

      if (params.format === 'markdown') {
        const lines = [
          `## AI Search: ${aiSearchResult.query}`,
          `_Engine: ${aiSearchResult.engine} | Total: ${aiSearchResult.total} | Duration: ${duration}_`,
          '',
        ];
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
          `AI Search: ${aiSearchResult.query} (Engine: ${aiSearchResult.engine}, Total: ${aiSearchResult.total}, Duration: ${duration})`,
          '',
        ];
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

export { AI_SEARCH_ENGINES, buildSearchPrompt, parseMarkdownResults, findAndFillInput, waitForAIResponse };
