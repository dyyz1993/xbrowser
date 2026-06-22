import {
  buildSearchPrompt,
  findAndFillInput,
  waitForAIResponse,
  parseMarkdownResults,
} from '../commands/ai-search-engines.js';
import type { AISearchResultItem } from '../commands/ai-search-engines.js';
import {
  getEngineConfig,
  detectLoginStatus,
  detectInternetSearch,
} from '../commands/ai-search-engines.js';
import type { AIEngineKey, EngineConfig } from '../commands/ai-search-engines.js';
import type { Page, BrowserContext } from '../browser-shim.js';
import type { SearchResult, CollectResult, BatchCollectResult, CollectorConfig } from './types.js';
import { DataStorage } from './storage.js';
import { DEFAULT_COLLECTOR_CONFIG, getPlatformName } from './config.js';

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

async function extractSourcesFromPage(page: Page): Promise<{ total: number; domains: string[]; urls: Array<{ url: string; domain: string }> } | undefined> {
  try {
    const data = await page.evaluate<Array<{ url: string; domain: string }>>(() => {
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
        } catch {
          // Ignore invalid URLs
        }
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

export class DataCollector {
  private config: CollectorConfig;
  private storage: DataStorage;

  constructor(config: Partial<CollectorConfig> = {}) {
    this.config = { ...DEFAULT_COLLECTOR_CONFIG, ...config };
    this.storage = new DataStorage({
      basePath: this.config.outputDir,
      format: this.config.format,
      autoBackup: true,
      maxHistoryDays: 90,
    });
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  async collectSingle(
    engine: string,
    query: string,
    options: {
      timeout?: number;
      full?: boolean;
      extractUrls?: boolean;
    } = {}
  ): Promise<CollectResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    
    try {
      const engineKey: AIEngineKey = engine as AIEngineKey;
      const config = getEngineConfig(engineKey);
      
      if (!config) {
        throw new Error(`Unknown AI engine: ${engine}`);
      }

      const context = await this.createBrowserContext();
      const page = await context.newPage();

      try {
        await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const waitTime = (config.extraWait || 3000);
        await page.waitForTimeout(waitTime);

        await navigateToChat(page, config);

        const loginStatus = await detectLoginStatus(page, config);
        if (loginStatus === 'logged_out') {
          throw new Error(`[${config.name}] 未登录。请先用 xbrowser open ${config.url} 并手动登录，然后再使用数据采集。`);
        }

        const internetSearchInfo = await detectInternetSearch(page, config);

        const inputText = buildSearchPrompt(query);
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

        const rawResponse = await waitForAIResponse(
          page, 
          options.timeout ?? this.config.timeout
        );
        const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

        if (!rawResponse || rawResponse.length < 10) {
          throw new Error(`AI 引擎 "${engine}" 未返回有效回复（超时 ${options.timeout ?? this.config.timeout}ms）。请检查浏览器登录状态。`);
        }

        const parsedResults = config.isSearchFirst
          ? parseSearchFirstResults(rawResponse)
          : parseMarkdownResults(rawResponse);
        const limitedResults = parsedResults.slice(0, 10);

        const searchResult: SearchResult = {
          id: this.generateId(query, engine),
          query,
          engine,
          results: limitedResults,
          total: limitedResults.length,
          timestamp: Date.now(),
          duration,
          collectedAt: Date.now(),
          engineInfo: {
            name: config.name,
            loginStatus,
            internetSearch: internetSearchInfo,
            uploadCapabilities: config.upload,
          },
        };

        if (options.full ?? this.config.saveFullResponse) {
          searchResult.aiResponse = rawResponse;
        }

        if (options.extractUrls ?? this.config.extractUrls) {
          const sources = await extractSourcesFromPage(page);
          if (sources) {
            searchResult.sources = sources;
          }
          
          const allUrls = new Map<string, string[]>();
          const urlRegex = /https?:\/\/[^\s\)\]"'`>\}]+/g;
          let urlMatch: RegExpExecArray | null;
          
          while ((urlMatch = urlRegex.exec(rawResponse)) !== null) {
            const rawUrl = urlMatch[0].replace(/[.,;:!?\)\]}>]+$/, '');
            try {
              const u = new URL(rawUrl);
              const domain = u.hostname.replace(/^www\./, '');
              if (!allUrls.has(domain)) allUrls.set(domain, []);
              const list = allUrls.get(domain)!;
              if (!list.includes(rawUrl)) list.push(rawUrl);
            } catch {
              // Ignore invalid URLs
            }
          }

          if (sources) {
            for (const item of sources.urls) {
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

          const domainEntries = Array.from(allUrls.entries())
            .filter(([domain]) => !excludeDomains.has(domain))
            .map(([domain, urls]) => ({
              domain,
              count: urls.length,
              urls,
              platform: getPlatformName(domain),
            }))
            .sort((a, b) => b.count - a.count);

          const totalUrls = domainEntries.reduce((sum, d) => sum + d.urls.length, 0);

          searchResult.domainExtraction = {
            query,
            totalUrls,
            totalDomains: domainEntries.length,
            domains: domainEntries,
          };
        }

        const collectResult: CollectResult = {
          success: true,
          engine,
          query,
          data: searchResult,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
        };

        await this.storage.saveCollectResult(collectResult);
        
        return collectResult;
      } finally {
        await page.close();
        await context.close();
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);
      
      return {
        success: false,
        engine,
        query,
        data: null,
        errors,
        timestamp: Date.now(),
        duration,
      };
    }
  }

  private generateId(query: string, engine: string): string {
    const hash = require('crypto').createHash('sha256')
      .update(`${engine}:${query}:${Date.now()}`)
      .digest('hex');
    return hash.slice(0, 16);
  }

  async collectAll(
    query: string,
    engines?: string[],
    options: {
      timeout?: number;
      full?: boolean;
      extractUrls?: boolean;
      delay?: number;
    } = {}
  ): Promise<BatchCollectResult> {
    const startTime = Date.now();
    const targetEngines = engines || this.config.engines;
    const results: CollectResult[] = [];
    
    await this.initialize();

    for (let i = 0; i < targetEngines.length; i++) {
      const engine = targetEngines[i];
      
      console.log(`[${i + 1}/${targetEngines.length}] Collecting from ${engine}...`);
      
      const result = await this.collectSingle(engine, query, options);
      results.push(result);
      
      if (result.success) {
        console.log(`✅ ${engine}: ${result.data?.total || 0} results (${result.duration}ms)`);
      } else {
        console.log(`❌ ${engine}: ${result.errors?.join(', ') || 'Unknown error'}`);
      }
      
      if (i < targetEngines.length - 1) {
        const delay = options.delay ?? this.config.delayBetweenEngines;
        if (delay > 0) {
          await this.sleep(delay);
        }
      }
    }

    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const summary = this.generateBatchSummary(results);

    return {
      totalEngines: targetEngines.length,
      successfulEngines: successful.length,
      failedEngines: failed.length,
      results,
      summary,
      timestamp: Date.now(),
      duration,
    };
  }

  private generateBatchSummary(results: CollectResult[]): BatchCollectResult['summary'] {
    const successful = results.filter(r => r.success && r.data);
    
    const totalResults = successful.reduce((sum, r) => sum + (r.data?.total || 0), 0);
    
    const urlMap = new Map<string, number>();
    successful.forEach(r => {
      if (r.data?.domainExtraction) {
        r.data.domainExtraction.domains.forEach(domain => {
          const count = urlMap.get(domain.domain) || 0;
          urlMap.set(domain.domain, count + domain.count);
        });
      }
    });
    
    const totalUrls = Array.from(urlMap.values()).reduce((sum, count) => sum + count, 0);
    const uniqueDomains = urlMap.size;
    
    const engineCounts = new Map<string, number>();
    successful.forEach(r => {
      const count = engineCounts.get(r.engine) || 0;
      engineCounts.set(r.engine, count + 1);
    });
    
    const topEngines = Array.from(engineCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([engine, count]) => ({ engine, count }));

    return {
      totalResults,
      totalUrls,
      uniqueDomains,
      topEngines,
    };
  }

  async collectMultipleQueries(
    queries: string[],
    engines?: string[],
    options: {
      timeout?: number;
      full?: boolean;
      extractUrls?: boolean;
      delay?: number;
    } = {}
  ): Promise<Map<string, BatchCollectResult>> {
    const results = new Map<string, BatchCollectResult>();
    
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`\n[${i + 1}/${queries.length}] Query: "${query}"`);
      
      const batchResult = await this.collectAll(query, engines, options);
      results.set(query, batchResult);
      
      if (i < queries.length - 1) {
        const delay = options.delay ?? this.config.delayBetweenEngines * 2;
        if (delay > 0) {
          await this.sleep(delay);
        }
      }
    }
    
    return results;
  }

  private async createBrowserContext(): Promise<BrowserContext> {
    const { launch } = await import('../cdp-driver/index.js');
    const { browser } = await launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    Reflect.set(context, '_browser', browser);
    return context;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async exportResults(
    outputPath: string,
    format: 'json' | 'csv' | 'markdown' = 'json'
  ): Promise<void> {
    switch (format) {
      case 'json':
        await this.storage.exportToJSON(outputPath);
        break;
      case 'csv':
        await this.storage.exportToCSV(outputPath);
        break;
      case 'markdown':
        await this.storage.exportToMarkdown(outputPath);
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  getStorage(): DataStorage {
    return this.storage;
  }

  getConfig(): CollectorConfig {
    return { ...this.config };
  }
}