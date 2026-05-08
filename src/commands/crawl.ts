import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';
import { createSession, destroyBrowser } from '../browser.js';

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.rar',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.xml', '.json', '.rss',
]);

function isSpaHashRoute(hash: string): boolean {
  return hash.startsWith('#/') || hash.startsWith('#!/');
}

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

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!isSpaHashRoute(parsed.hash)) {
      parsed.hash = '';
    }
    let href = parsed.href;
    if (!parsed.hash) {
      if (href.endsWith('/')) href = href.slice(0, -1);
    }
    href = href.replace(/^http:/, 'https:');
    href = href.replace(/^https:\/\/www\./, 'https://');
    return href;
  } catch {
    return url;
  }
}

function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (['mailto:', 'tel:', 'javascript:'].includes(parsed.protocol)) return true;
    const path = parsed.pathname.toLowerCase();
    const dotIndex = path.lastIndexOf('.');
    if (dotIndex !== -1) {
      const ext = path.substring(dotIndex);
      if (SKIP_EXTENSIONS.has(ext)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function getBaseDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
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
}

function isUrlAllowed(
  url: string,
  startUrl: URL,
  depth: number,
  options: CrawlOptions,
): boolean {
  try {
    const parsed = new URL(url);

    if (shouldSkipUrl(url)) return false;
    if (depth > options.maxDepth) return false;

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
  }),
  handler: async (p, _ctx: BrowserCommandContext) => {
    const sessionName = `crawl-${Date.now()}`;
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
    };

    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [{ url: p.url, depth: 0 }];
    const pages: Array<{ url: string; title: string; content: string }> = [];

    try {
      const session = await createSession(sessionName, p.url, { headless: true });
      const page = session.page;

      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2000));

      const firstNormalized = normalizeUrl(page.url());
      visited.add(firstNormalized);
      visited.add(normalizeUrl(p.url));

      const html = await page.content();
      const title = await page.title();
      const content =
        options.format === 'html'
          ? html
          : htmlToMarkdown(html, { onlyMainContent: options.onlyMainContent });

      pages.push({ url: page.url(), title, content });

      const firstLinks = await page.evaluate((evalOrigin: string) => {
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
      }, startUrl.origin);

      for (const link of firstLinks) {
        try {
          const absolute = new URL(link, page.url()).href;
          const absNorm = normalizeUrl(stripHashAnchorQuery(absolute));
          if (!visited.has(absNorm) && !shouldSkipUrl(absolute)) {
            queue.push({ url: stripHashAnchorQuery(absolute), depth: 1 });
          }
        } catch {
          // skip invalid
        }
      }

      while (queue.length > 0 && pages.length < options.limit) {
        const item = queue.shift()!;
        const normalized = normalizeUrl(item.url);

        if (visited.has(normalized)) continue;
        if (!isUrlAllowed(item.url, startUrl, item.depth, options)) continue;

        visited.add(normalized);

        try {
          await page.goto(item.url, {
            waitUntil: 'networkidle',
            timeout: 15000,
          });
          await new Promise(resolve => setTimeout(resolve, 1500));

          const pageHtml = await page.content();
          const pageTitle = await page.title();
          const pageContent =
            options.format === 'html'
              ? pageHtml
              : htmlToMarkdown(pageHtml, { onlyMainContent: options.onlyMainContent });

          pages.push({ url: page.url(), title: pageTitle, content: pageContent });

          const links = await page.evaluate((evalOrigin: string) => {
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
          }, startUrl.origin);

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
        } catch {
          // skip failed pages
        }
      }

      return ok({ pages, total: pages.length, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return ok({ pages, total: pages.length, success: false, error: message });
    } finally {
      await destroyBrowser().catch(() => {});
    }
  },
});
