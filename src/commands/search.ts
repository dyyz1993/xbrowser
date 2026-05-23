import { z } from 'zod';
import * as cheerio from 'cheerio';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';
import { createEphemeralContext, closeEphemeralContext, getBrowser, resolveLaunchOpts } from '../browser.js';
import { shouldSkipUrl } from '../utils/url.js';
import type { Page, BrowserContext } from 'playwright';

type SearchEngineKey = 'bing' | 'google' | 'baidu';

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

type RecencyFilter = 'hour' | 'day' | 'week' | 'month' | 'year';

interface SearchOptions {
  query: string;
  engine?: string;
  limit?: number;
  full?: boolean;
  format?: 'markdown' | 'json' | 'text';
  timeout?: number;
  recency?: RecencyFilter;
  fallback?: boolean;
  site?: string;
}

interface SearchResult {
  query: string;
  engine: string;
  results: SearchResultItem[];
  total: number;
  timestamp: number;
}

/** Build recency URL params — discovered by monitoring real UI interactions */
function getRecencyParams(recency: RecencyFilter): Record<SearchEngineKey, string> {
  const now = Math.floor(Date.now() / 1000);
  switch (recency) {
    case 'hour':
      return {
        bing: '&filters=ex1%3A%22ez1%22', // 24小时内（Bing 没有1小时选项）
        google: '&tbs=qdr:h',
        baidu: `&gpc=stf%3D${now - 3600}%2C${now}%7Cstftype%3D1&tfflag=1`,
      };
    case 'day':
      return {
        bing: '&filters=ex1%3A%22ez1%22', // 24小时内
        google: '&tbs=qdr:d',
        baidu: `&gpc=stf%3D${now - 86400}%2C${now}%7Cstftype%3D1&tfflag=1`,
      };
    case 'week':
      return {
        bing: '&filters=ex1%3A%22ez2%22', // 一周内
        google: '&tbs=qdr:w',
        baidu: `&gpc=stf%3D${now - 604800}%2C${now}%7Cstftype%3D1&tfflag=1`,
      };
    case 'month':
      return {
        bing: '&filters=ex1%3A%22ez3%22', // 一个月内
        google: '&tbs=qdr:m',
        baidu: `&gpc=stf%3D${now - 2592000}%2C${now}%7Cstftype%3D1&tfflag=1`,
      };
    case 'year':
      return {
        bing: '&filters=ex1%3A%22ez5_20223_20588%22', // 去年
        google: '&tbs=qdr:y',
        baidu: `&gpc=stf%3D${now - 31536000}%2C${now}%7Cstftype%3D1&tfflag=1`,
      };
  }
}

const SEARCH_ENGINES: Record<SearchEngineKey, { name: string; url: (q: string, site?: string) => string }> = {
  bing: {
    name: 'Bing',
    url: (q, site) => {
      const query = site ? `${q} site:${site}` : q;
      return `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
    },
  },
  google: {
    name: 'Google',
    url: (q, site) => {
      const query = site ? `${q} site:${site}` : q;
      return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
    },
  },
  baidu: {
    name: 'Baidu',
    url: (q, site) => {
      // 百度不支持 site: 语法在 wd 参数中，但支持在查询中直接加
      const query = site ? `${q} site:${site}` : q;
      return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=10`;
    },
  },
} as const;

const ENGINE_FALLBACK_ORDER: readonly SearchEngineKey[] = ['bing', 'google', 'baidu'] as const;

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

const PARSERS: Record<SearchEngineKey, ($: cheerio.CheerioAPI) => SearchResultItem[]> = {
  bing: parseBingResults,
  google: parseGoogleResults,
  baidu: parseBaiduResults,
};

async function trySearchWithEngine(
  page: Page,
  engine: SearchEngineKey,
  query: string,
  timeout: number,
  recency?: RecencyFilter,
  site?: string,
): Promise<{ engine: SearchEngineKey; results: SearchResultItem[] }> {
  const config = SEARCH_ENGINES[engine];

  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Referer': `https://www.${engine === 'google' ? 'google.com' : engine === 'bing' ? 'bing.com' : 'baidu.com'}`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'cors',
  };

  await page.setExtraHTTPHeaders(headers);

  // 直接在 URL 中拼接时间过滤参数（从 UI 交互中发现的真实参数，比 UI 点击更稳定）
  let searchUrl = config.url(query, site);
  if (recency) {
    const params = getRecencyParams(recency);
    searchUrl += params[engine];
  }

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForTimeout(500);

  let html: string | undefined;
  let retries = 0;
  while (retries < 3) {
    try {
      html = await page.content();
      break;
    } catch (err) {
      if (retries === 2) throw err;
      retries++;
      await page.waitForTimeout(500);
    }
  }
  if (!html) {
    html = await page.content();
  }
  const $ = cheerio.load(html);

  const parser = PARSERS[engine];
  const results = parser($);

  return { engine, results };
}

async function trySearchOnPage(
  context: BrowserContext,
  engine: SearchEngineKey,
  query: string,
  timeout: number,
  recency?: RecencyFilter,
  site?: string,
): Promise<{ engine: SearchEngineKey; results: SearchResultItem[] }> {
  const page = await context.newPage();
  try {
    return await trySearchWithEngine(page, engine, query, timeout, recency, site);
  } finally {
    await page.close().catch(() => { });
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let path = u.pathname;
    if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
    return `${host}${path}`;
  } catch {
    return url;
  }
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveUrl(item: SearchResultItem): SearchResultItem {
  let url = item.url;
  try {
    const baiduMatch = url.match(/[?&]url=([^&]+)/);
    if (baiduMatch && url.includes('baidu.com/link')) {
      const decoded = decodeURIComponent(baiduMatch[1]);
      // Only accept decoded value if it's a valid http/https URL
      // Baidu sometimes puts encrypted tokens in url= param, not real URLs
      if (isValidUrl(decoded)) {
        url = decoded;
      }
    }
  } catch { /* baidu link decode failed */ }
  return { ...item, url };
}

/**
 * Resolve Baidu redirect URLs by following the 302 redirect.
 * Baidu's /link?url=<token> returns the real URL in the Location header.
 */
async function resolveBaiduRedirects(items: SearchResultItem[], timeoutMs = 5000): Promise<SearchResultItem[]> {
  const baiduItems = items.filter(
    item => item.url.includes('baidu.com/link') && !isValidUrl(item.url.replace(/.*[?&]url=/, '').replace(/&.*/, ''))
  );

  if (baiduItems.length === 0) return items;

  const resolved = await Promise.allSettled(
    baiduItems.map(async (item) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(item.url, {
          method: 'HEAD',
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timer);
        const location = resp.headers.get('location');
        if (location && isValidUrl(location)) {
          return { ...item, url: location };
        }
      } catch {
        // fetch failed or timed out — keep original URL
      }
      return item;
    }),
  );

  // Build a map from original URL → resolved item
  const resolutionMap = new Map<string, SearchResultItem>();
  for (let i = 0; i < resolved.length; i++) {
    const result = resolved[i];
    if (result.status === 'fulfilled') {
      resolutionMap.set(baiduItems[i].url, result.value);
    }
  }

  // Replace items in the original array
  return items.map(item => resolutionMap.get(item.url) || item);
}

function isAdResult(item: SearchResultItem): boolean {
  const adKeywords = ['广告', '推广', 'Ad', 'Sponsored', 'Promoted'];
  const text = `${item.title} ${item.snippet}`;
  return adKeywords.some(k => text.toLowerCase().includes(k.toLowerCase()));
}

function mergeResults(
  allEngineResults: Array<{ engine: SearchEngineKey; results: SearchResultItem[] }>,
  limit: number,
): SearchResultItem[] {
  const groups = new Map<string, { item: SearchResultItem; engines: Set<string>; avgPosition: number }>();

  for (const { engine, results } of allEngineResults) {
    for (const item of results) {
      const resolved = resolveUrl(item);
      if (isAdResult(resolved)) continue;
      // Skip results with non-URL values (e.g. Baidu encrypted tokens)
      if (!isValidUrl(resolved.url)) continue;
      const key = normalizeUrl(resolved.url);
      if (groups.has(key)) {
        const group = groups.get(key)!;
        group.engines.add(engine);
        group.avgPosition = (group.avgPosition + item.position) / 2;
      } else {
        groups.set(key, {
          item: resolved,
          engines: new Set([engine]),
          avgPosition: item.position,
        });
      }
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      const engineDiff = b.engines.size - a.engines.size;
      if (engineDiff !== 0) return engineDiff;
      return a.avgPosition - b.avgPosition;
    })
    .map(g => g.item)
    .slice(0, limit);
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
              await pg.waitForLoadState('networkidle', { timeout }).catch(() => { });
              const html = await pg.content();
              contentMap.set(url, htmlToMarkdown(html, { onlyMainContent: true }));
            } finally {
              await pg.close().catch(() => { });
            }
          } catch {
            contentMap.set(url, '');
          }
        }),
      );
    } finally {
      await context.close().catch(() => { });
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
    recency: z.enum(['hour', 'day', 'week', 'month', 'year']).optional().describe('Filter by time: hour/day/week/month/year'),
    fallback: z.boolean().default(false).describe('Sequential engine fallback instead of parallel'),
    site: z.string().optional().describe('Limit results to a specific site (e.g. github.com, v2ex.com)'),
  }),
  handler: async (p: SearchOptions, ctx: BrowserCommandContext): Promise<ReturnType<typeof ok>> => {
    const { context } = await createEphemeralContext(resolveLaunchOpts(ctx));

    try {
      const errors: Array<{ engine: string; error: string }> = [];
      const specifiedEngine = p.engine && p.engine in SEARCH_ENGINES
        ? (p.engine as SearchEngineKey)
        : null;

      const isFallback = p.fallback || specifiedEngine !== null;

      let results: SearchResultItem[] = [];
      let engineLabel = '';

      if (isFallback) {
        const enginesToTry: SearchEngineKey[] = specifiedEngine
          ? [specifiedEngine]
          : [...ENGINE_FALLBACK_ORDER];

        let finalResult: { engine: SearchEngineKey; results: SearchResultItem[] } | null = null;

        for (const engine of enginesToTry) {
          try {
            const result = await trySearchOnPage(context, engine, p.query, p.timeout ?? 15000, p.recency as RecencyFilter | undefined, p.site);
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

        if (!finalResult || finalResult.results.length === 0) {
          throw new Error(
            `All search engines failed:\n${errors.map((e) => `  - ${e.engine}: ${e.error}`).join('\n')}`,
          );
        }

        results = finalResult.results.slice(0, p.limit ?? 10);
        // Resolve Baidu redirect URLs via 302
        if (finalResult.engine === 'baidu') {
          results = await resolveBaiduRedirects(results);
        }
        engineLabel = SEARCH_ENGINES[finalResult.engine].name;
      } else {
        const engines = [...ENGINE_FALLBACK_ORDER];
        // Stagger engine starts by 200ms each to avoid CDP contention
        const settled = await Promise.allSettled(
          engines.map(async (engine, i) => {
            if (i > 0) await new Promise(r => setTimeout(r, 200 * i));
            return trySearchOnPage(context, engine, p.query, p.timeout ?? 15000, p.recency as RecencyFilter | undefined, p.site);
          }),
        );

        const allResults: Array<{ engine: SearchEngineKey; results: SearchResultItem[] }> = [];
        for (let i = 0; i < settled.length; i++) {
          const r = settled[i];
          if (r.status === 'fulfilled') {
            if (r.value.results.length > 0) {
              allResults.push(r.value);
            } else {
              errors.push({
                engine: SEARCH_ENGINES[engines[i]].name,
                error: '0 results returned',
              });
            }
          } else {
            errors.push({
              engine: SEARCH_ENGINES[engines[i]].name,
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
          }
        }

        if (allResults.length === 0) {
          throw new Error(
            `All search engines failed:\n${errors.map((e) => `  - ${e.engine}: ${e.error}`).join('\n')}`,
          );
        }

        // Resolve Baidu redirect URLs via 302 before merging
        for (const er of allResults) {
          if (er.engine === 'baidu') {
            er.results = await resolveBaiduRedirects(er.results);
          }
        }
        results = mergeResults(allResults, p.limit ?? 10);
        engineLabel = allResults.map(r => SEARCH_ENGINES[r.engine].name).join('+');
      }

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
        query: p.site ? `${p.query} (site:${p.site})` : p.query,
        engine: engineLabel,
        results,
        total: results.length,
        timestamp: Date.now(),
      };

      if (errors.length > 0) {
        const errorMsg = `${errors.length} engine(s) had issues: ${errors.map(e => `${e.engine}(${e.error.substring(0, 80)})`).join(', ')}`;
        console.warn(errorMsg);
      }

      // format controls output shape: json → structured data, markdown → readable text, text → plain list
      if (p.format === 'markdown') {
        const lines = [`## Search: ${searchResult.query}`, `_Engine: ${searchResult.engine} | Total: ${searchResult.total}_`, ''];
        for (const r of results) {
          lines.push(`### ${r.position}. [${r.title}](${r.url})`);
          lines.push(`> ${r.snippet}`);
          lines.push('');
        }
        return ok({ ...searchResult, content: lines.join('\n') });
      }

      if (p.format === 'text') {
        const lines = [`Search: ${searchResult.query} (Engine: ${searchResult.engine}, Total: ${searchResult.total})`, ''];
        for (const r of results) {
          lines.push(`${r.position}. ${r.title}`);
          lines.push(`   ${r.url}`);
          lines.push(`   ${r.snippet}`);
          lines.push('');
        }
        return ok({ ...searchResult, content: lines.join('\n') });
      }

      return ok(searchResult);
    } finally {
      await closeEphemeralContext(context);
    }
  },
});

export { getRecencyParams, parseBingResults, parseGoogleResults, parseBaiduResults, normalizeUrl, resolveUrl, resolveBaiduRedirects, isAdResult, mergeResults };
