import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';
import { getBrowser, destroyBrowser } from '../browser.js';
import { normalizeUrl, shouldSkipUrl, getBaseDomain, isSpaHashRoute } from '../utils/url.js';
import type { Page } from 'playwright';

function stripHashAnchorQuery(url: string): string {
  try {
    const parsed = new URL(url);
    if (isSpaHashRoute(parsed.hash)) {
      const hashPath = parsed.hash.split('?')[0];
      parsed.hash = hashPath;
    }
    return parsed.href;
  } catch {
    return url;
  }
}

async function extractLinks(page: Page, origin: string): Promise<string[]> {
  return page.evaluate((evalOrigin: string) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map((a) => {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('#') || href.startsWith('/#')) {
          try {
            return new URL(href, evalOrigin).href;
          } catch {
            return href;
          }
        }
        return href;
      })
      .filter(Boolean);
  }, origin);
}

interface DisallowRule {
  pathPrefix: string;
}

function parseRobotsTxt(text: string): DisallowRule[] {
  const rules: DisallowRule[] = [];
  let inRelevantBlock = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const agent = lower.split(':')[1]?.trim();
      inRelevantBlock = agent === '*' || agent === '';
      continue;
    }
    if (inRelevantBlock && lower.startsWith('disallow:')) {
      const path = trimmed.split(':')[1]?.trim();
      if (path && path !== '') {
        rules.push({ pathPrefix: path });
      }
    }
  }
  return rules;
}

function isBlockedByRobots(urlPath: string, rules: DisallowRule[]): boolean {
  for (const rule of rules) {
    if (urlPath.startsWith(rule.pathPrefix)) return true;
    try {
      if (new RegExp(rule.pathPrefix).test(urlPath)) return true;
    } catch {
      // not a regex, skip
    }
  }
  return false;
}

async function fetchRobotsRules(origin: string): Promise<DisallowRule[]> {
  try {
    const resp = await fetch(origin + '/robots.txt');
    if (!resp.ok) return [];
    const text = await resp.text();
    return parseRobotsTxt(text);
  } catch {
    return [];
  }
}

async function retryGoto(page: Page, url: string, retries: number, verbose: boolean): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (verbose && attempt < retries) {
        process.stderr.write(`[retry ${attempt + 1}/${retries}] ${url}: ${lastError.message}\n`);
      }
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError!;
}

interface CrawlOptions {
  limit: number;
  maxDepth: number;
  includePaths?: string[];
  excludePaths?: string[];
  allowSubdomains: boolean;
  allowExternalLinks: boolean;
  allowBackwardCrawling: boolean;
  format: 'markdown' | 'html';
  onlyMainContent: boolean;
  concurrency: number;
  retries: number;
  verbose: boolean;
}

interface CrawlPage {
  url: string;
  title: string;
  content: string;
}

interface CrawlPageError {
  url: string;
  error: string;
}

type CrawlResult = CrawlPage | CrawlPageError;

function isPageError(r: CrawlResult): r is CrawlPageError {
  return 'error' in r;
}

function isUrlAllowed(
  url: string,
  startUrl: URL,
  depth: number,
  options: CrawlOptions,
  robotsRules: DisallowRule[],
): boolean {
  try {
    const parsed = new URL(url);

    if (shouldSkipUrl(url)) return false;
    if (depth > options.maxDepth) return false;
    if (isBlockedByRobots(parsed.pathname, robotsRules)) return false;

    if (!options.allowExternalLinks) {
      const startBase = getBaseDomain(startUrl.hostname);
      const urlBase = getBaseDomain(parsed.hostname);
      if (urlBase !== startBase) return false;
    }

    if (!options.allowSubdomains && parsed.hostname !== startUrl.hostname) {
      const startBase = getBaseDomain(startUrl.hostname);
      const urlBase = getBaseDomain(parsed.hostname);
      if (urlBase === startBase) return false;
    }

    if (options.includePaths && options.includePaths.length > 0) {
      const matched = options.includePaths.some((pattern) => {
        try {
          return new RegExp(pattern).test(parsed.pathname);
        } catch {
          return parsed.pathname.includes(pattern);
        }
      });
      if (!matched) return false;
    }

    if (options.excludePaths && options.excludePaths.length > 0) {
      const excluded = options.excludePaths.some((pattern) => {
        try {
          return new RegExp(pattern).test(parsed.pathname);
        } catch {
          return parsed.pathname.includes(pattern);
        }
      });
      if (excluded) return false;
    }

    if (!options.allowBackwardCrawling) {
      const basePath = startUrl.pathname.replace(/\/$/, '');
      if (basePath && basePath !== '/') {
        if (parsed.pathname !== basePath && !parsed.pathname.startsWith(basePath + '/')) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

export const crawlCommand = registerCommand({
  name: 'crawl',
  description: 'Crawl a website and extract content from all pages',
  scope: 'project',
  parameters: z.object({
    url: z.string(),
    limit: z.number().default(10),
    maxDepth: z.number().default(3),
    includePaths: z.array(z.string()).optional(),
    excludePaths: z.array(z.string()).optional(),
    allowSubdomains: z.boolean().default(false),
    allowExternalLinks: z.boolean().default(false),
    allowBackwardCrawling: z.boolean().default(false),
    format: z.enum(['markdown', 'html']).default('markdown'),
    onlyMainContent: z.boolean().default(true),
    concurrency: z.number().default(3),
    retries: z.number().default(2),
    verbose: z.boolean().default(false),
  }),
  handler: async (p, _ctx: BrowserCommandContext) => {
    const startUrl = new URL(p.url);
    const options: CrawlOptions = {
      limit: p.limit,
      maxDepth: p.maxDepth,
      includePaths: p.includePaths,
      excludePaths: p.excludePaths,
      allowSubdomains: p.allowSubdomains,
      allowExternalLinks: p.allowExternalLinks,
      allowBackwardCrawling: p.allowBackwardCrawling,
      format: p.format,
      onlyMainContent: p.onlyMainContent,
      concurrency: Math.min(Math.max(p.concurrency, 1), 10),
      retries: Math.min(Math.max(p.retries, 0), 5),
      verbose: p.verbose,
    };

    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [];
    const results: CrawlResult[] = [];
    let completedCount = 0;

    try {
      const robotsRules = await fetchRobotsRules(startUrl.origin);
      if (options.verbose && robotsRules.length > 0) {
        process.stderr.write(`[robots.txt] Loaded ${robotsRules.length} disallow rules\n`);
      }

      const browser = await getBrowser({ headless: true });
      const contexts: import('playwright').BrowserContext[] = [];

      try {
        const seedContext = await browser.newContext();
        const seedPage = await seedContext.newPage();
        contexts.push(seedContext);

        await seedPage.goto(p.url, { waitUntil: 'networkidle', timeout: 15000 });

        const firstNormalized = normalizeUrl(seedPage.url());
        visited.add(firstNormalized);
        visited.add(normalizeUrl(p.url));
        completedCount++;

        const html = await seedPage.content();
        const title = await seedPage.title();
        const content =
          options.format === 'html'
            ? html
            : htmlToMarkdown(html, { onlyMainContent: options.onlyMainContent });

        results.push({ url: seedPage.url(), title, content });

        const firstLinks = await extractLinks(seedPage, startUrl.origin);
        for (const link of firstLinks) {
          try {
            const absolute = new URL(link, seedPage.url()).href;
            const absNorm = normalizeUrl(stripHashAnchorQuery(absolute));
            if (!visited.has(absNorm) && !shouldSkipUrl(absolute)) {
              queue.push({ url: stripHashAnchorQuery(absolute), depth: 1 });
            }
          } catch {
            // skip invalid
          }
        }

        await seedPage.close();

        const pagePool: Page[] = [];
        const poolSize = Math.min(options.concurrency, options.limit);

        for (let i = 0; i < poolSize; i++) {
          const ctx = await browser.newContext();
          contexts.push(ctx);
          pagePool.push(await ctx.newPage());
        }

        const dequeueNext = (): { url: string; depth: number } | null => {
          while (queue.length > 0) {
            const item = queue.shift()!;
            const normalized = normalizeUrl(item.url);
            if (visited.has(normalized)) continue;
            if (!isUrlAllowed(item.url, startUrl, item.depth, options, robotsRules)) continue;
            visited.add(normalized);
            return item;
          }
          return null;
        };

        const crawlWorker = async (page: Page): Promise<void> => {
          while (results.length < options.limit) {
            const item = dequeueNext();
            if (!item) break;

            completedCount++;
            if (options.verbose) {
              process.stderr.write(`[${completedCount}/${options.limit}] Crawling ${item.url}\n`);
            }

            try {
              await retryGoto(page, item.url, options.retries, options.verbose);

              const pageHtml = await page.content();
              const pageTitle = await page.title();
              const pageContent =
                options.format === 'html'
                  ? pageHtml
                  : htmlToMarkdown(pageHtml, { onlyMainContent: options.onlyMainContent });

              results.push({ url: page.url(), title: pageTitle, content: pageContent });

              if (results.length >= options.limit) break;

              const links = await extractLinks(page, startUrl.origin);
              for (const link of links) {
                try {
                  const absolute = new URL(link, page.url()).href;
                  const deduped = stripHashAnchorQuery(absolute);
                  const absNorm = normalizeUrl(deduped);
                  if (!visited.has(absNorm) && !shouldSkipUrl(absolute)) {
                    queue.push({ url: deduped, depth: item.depth + 1 });
                  }
                } catch {
                  // skip invalid
                }
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              results.push({ url: item.url, error: message });
              if (options.verbose) {
                process.stderr.write(`[error] ${item.url}: ${message}\n`);
              }
            }
          }
        };

        await Promise.all(pagePool.map((p) => crawlWorker(p)));

        const successPages = results.filter((r): r is CrawlPage => !isPageError(r));
        const errorPages = results.filter(isPageError);

        const response: Record<string, unknown> = {
          pages: successPages,
          total: successPages.length,
          success: true,
        };
        if (errorPages.length > 0) {
          response.errors = errorPages;
        }

        return ok(response);
      } finally {
        for (const ctx of contexts) {
          await ctx.close().catch(() => {});
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const successPages = results.filter((r): r is CrawlPage => !isPageError(r));
      return ok({ pages: successPages, total: successPages.length, success: false, error: message });
    } finally {
      await destroyBrowser().catch(() => {});
    }
  },
});
