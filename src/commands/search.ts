import { z } from 'zod';
import * as cheerio from 'cheerio';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';
import { createEphemeralContext, closeEphemeralContext, getBrowser, destroyBrowser } from '../browser.js';
import { shouldSkipUrl } from '../utils/url.js';
import type { Page } from 'playwright';

type SearchEngineKey = 'bing' | 'google' | 'baidu' | 'duckduckgo';

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  position: number;
  markdown?: string;
}

interface SearchOptions {
  query: string;
  engine?: string;
  limit?: number;
  full?: boolean;
  format?: 'markdown' | 'json' | 'text';
  timeout?: number;
}

interface SearchResult {
  query: string;
  engine: string;
  results: SearchResultItem[];
  total: number;
  timestamp: number;
}

const SEARCH_ENGINES: Record<SearchEngineKey, { name: string; url: (q: string) => string }> = {
  bing: {
    name: 'Bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10`,
  },
  google: {
    name: 'Google',
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=10`,
  },
  baidu: {
    name: 'Baidu',
    url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=10`,
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  },
} as const;

const ENGINE_FALLBACK_ORDER: readonly SearchEngineKey[] = ['bing', 'google', 'baidu', 'duckduckgo'] as const;

function parseBingResults($: cheerio.CheerioAPI): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  $('.b_algo').each((idx, el) => {
    const $el = $(el);
    const $titleLink = $el.find('h2 > a').first();
    const title = $titleLink.text().trim();
    const url = $titleLink.attr('href') || '';
    const snippet = $el.find('.b_caption p').first().text().trim();
    if (title && url && !shouldSkipUrl(url)) {
      results.push({ title, url, snippet, position: idx + 1 });
    }
  });
  return results;
}

function parseGoogleResults($: cheerio.CheerioAPI): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  $('div.tF2Cxc').each((idx, el) => {
    const $el = $(el);
    const $h3 = $el.find('h3').first();
    const title = $h3.text().trim();
    const url = $h3.closest('a').attr('href') || '';
    const snippet = $el.find('div.VwiC3b').first().text().trim();
    if (title && url && !shouldSkipUrl(url)) {
      results.push({ title, url, snippet, position: idx + 1 });
    }
  });
  if (results.length === 0) {
    $('div.g, div[data-sokoban-container]').each((idx, el) => {
      const $el = $(el);
      const $titleLink = $el.find('h3 > a').first();
      const title = $titleLink.text().trim();
      const url = $titleLink.attr('href') || '';
      const snippet = $el.find('div.VwiC3b, [data-sncf]').first().text().trim() || $el.find('div[style*="-webkit-line-clamp"]').first().text().trim();
      if (title && url && !shouldSkipUrl(url)) {
        results.push({ title, url, snippet, position: idx + 1 });
      }
    });
  }
  return results;
}

function parseBaiduResults($: cheerio.CheerioAPI): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const selectors = [
    'div.result h3 a',
    'div.c-container h3 a',
    'div.result-op h3 a',
  ].join(', ');
  $(selectors).each((_idx, el) => {
    const $titleLink = $(el);
    const title = $titleLink.text().trim();
    const url = $titleLink.attr('href') || '';
    const $container = $titleLink.closest('div.result, div.c-container, div.result-op');
    const snippet = extractBaiduSnippet($, $container, title);
    if (title && url && !shouldSkipUrl(url)) {
      results.push({ title, url, snippet, position: results.length + 1 });
    }
  });
  return results;
}

function extractBaiduSnippet(
  $: cheerio.CheerioAPI,
  $container: ReturnType<cheerio.CheerioAPI>,
  title: string,
): string {
  const candidates = [
    $container.find('.c-abstract').first().text().trim(),
    $container.find('.c-color-text.c-line-clamp2').first().text().trim(),
    $container.find('p.c-color-text').first().text().trim(),
    $container.find('.c-span9 span').first().text().trim(),
  ];
  for (const text of candidates) {
    if (text && text.length > 10 && text !== title) return text;
  }
  let pSnippet = '';
  $container.find('p').each((_i, el) => {
    if (pSnippet) return;
    const t = $(el).text().trim();
    if (t.length > 20 && t !== title && !t.startsWith(title)) pSnippet = t;
  });
  return pSnippet;
}

function parseDuckDuckGoResults($: cheerio.CheerioAPI): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  $('.result').each((idx, el) => {
    const $el = $(el);
    const $titleLink = $el.find('h2 > a.result__a').first();
    const title = $titleLink.text().trim();
    const url = $titleLink.attr('href') || '';
    const snippet = $el.find('.result__snippet').first().text().trim();
    if (title && url && !shouldSkipUrl(url)) {
      results.push({ title, url, snippet, position: idx + 1 });
    }
  });
  return results;
}

const PARSERS: Record<SearchEngineKey, ($: cheerio.CheerioAPI) => SearchResultItem[]> = {
  bing: parseBingResults,
  google: parseGoogleResults,
  baidu: parseBaiduResults,
  duckduckgo: parseDuckDuckGoResults,
};

  async function trySearchWithEngine(
  page: Page,
  engine: SearchEngineKey,
  query: string,
  timeout: number,
): Promise<{ engine: SearchEngineKey; results: SearchResultItem[] }> {
  const config = SEARCH_ENGINES[engine];
  const searchUrl = config.url(query);
  
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0 Safari/537.36',
    'Referer': `https://www.${engine === 'google' ? 'www.google.com' : engine === 'bing' ? 'www.bing.com' : engine === 'baidu' ? 'www.baidu.com' : 'html.duckduckgo.com'}`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'cors',
  };
  
  await page.setExtraHTTPHeaders(headers);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  
  const html = await page.content();
  const $ = cheerio.load(html);
  
  const parser = PARSERS[engine];
  const results = parser($);
  
  return { engine, results };
}

async function fetchFullContent(urls: string[], timeout: number, cdpEndpoint?: string): Promise<Map<string, string>> {
  const contentMap = new Map<string, string>();
  const launchOpts = cdpEndpoint ? { cdpEndpoint } : { headless: true };
  const b = await getBrowser(launchOpts);

  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += 5) {
    chunks.push(urls.slice(i, i + 5));
  }

  for (const chunk of chunks) {
    const context = await b.newContext();
    try {
      await Promise.allSettled(
        chunk.map(async (url) => {
          try {
            const pg = await context.newPage();
            try {
              await pg.goto(url, { waitUntil: 'domcontentloaded', timeout });
              await pg.waitForLoadState('networkidle', { timeout }).catch(() => {});
              const html = await pg.content();
              contentMap.set(url, htmlToMarkdown(html, { onlyMainContent: true }));
            } finally {
              await pg.close().catch(() => {});
            }
          } catch {
            contentMap.set(url, '');
          }
        }),
      );
    } finally {
      await context.close().catch(() => {});
    }
  }

  return contentMap;
}

export const searchCommand = registerCommand({
  name: 'search',
  description: 'Search the web and extract results with engine fallback',
  scope: 'project' as const,
  parameters: z.object({
    query: z.string(),
    engine: z.string().optional(),
    limit: z.number().default(10),
    full: z.boolean().default(false),
    format: z.enum(['markdown', 'json', 'text']).default('markdown'),
    timeout: z.number().default(15000),
  }),
  handler: async (p: SearchOptions, ctx: BrowserCommandContext): Promise<ReturnType<typeof ok>> => {
    const isCDP = !!ctx.cdpEndpoint;
    const launchOpts = isCDP
      ? { cdpEndpoint: ctx.cdpEndpoint }
      : { headless: true };

    const { context, page } = await createEphemeralContext(launchOpts);

    try {
      let finalResult: { engine: SearchEngineKey; results: SearchResultItem[] } | null = null;
      const errors: Array<{ engine: string; error: string }> = [];

      const enginesToTry: SearchEngineKey[] = p.engine && p.engine in SEARCH_ENGINES
        ? [p.engine as SearchEngineKey]
        : [...ENGINE_FALLBACK_ORDER];

      for (const engine of enginesToTry) {
        try {
          const result = await trySearchWithEngine(page, engine, p.query, p.timeout ?? 15000);
          if (result.results.length > 0 || !finalResult) {
            finalResult = result;
            if (result.results.length > 0) break;
          }
        } catch (err) {
          errors.push({
            engine: SEARCH_ENGINES[engine].name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!finalResult) {
        throw new Error(
          `All search engines failed:\n${errors.map((e) => `  - ${e.engine}: ${e.error}`).join('\n')}`,
        );
      }

      let results = finalResult.results.slice(0, p.limit ?? 10);

      if (p.full && results.length > 0) {
        const urls = results.map((r) => r.url).filter((u) => !shouldSkipUrl(u));
        const safeTimeout = p.timeout ?? 15000;
        const contentMap = await fetchFullContent(urls, safeTimeout, ctx.cdpEndpoint);

        results = results.map((r) => ({
          ...r,
          markdown: contentMap.get(r.url) || undefined,
        }));
      }

      const searchResult: SearchResult = {
        query: p.query,
        engine: SEARCH_ENGINES[finalResult.engine].name,
        results,
        total: results.length,
        timestamp: Date.now(),
      };

      if (errors.length > 0 && finalResult.results.length === 0) {
        console.warn(`Warning: ${SEARCH_ENGINES[finalResult.engine].name} returned no results. Tried ${errors.length} other engine(s).`);
      }

      return ok(searchResult);
    } finally {
      await closeEphemeralContext(context);
      if (isCDP) {
        try {
          const b = await getBrowser();
          if (b.isConnected()) await b.close();
        } catch { /* ignore */ }
        destroyBrowser();
      }
    }
  },
});
