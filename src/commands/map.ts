import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createSession, destroyBrowser } from '../browser.js';
import type { Page } from 'playwright';

interface MapOptions {
  sitemap?: 'include' | 'only';
  includeSubdomains?: boolean;
  limit?: number;
  search?: string;
}

export function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

export function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function getRootDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

export function isSameDomain(
  url: string,
  baseHostname: string,
  includeSubdomains: boolean,
): boolean {
  const h = getHostname(url);
  if (!h) return false;
  if (h === baseHostname) return true;
  if (includeSubdomains) {
    return getRootDomain(h) === getRootDomain(baseHostname);
  }
  return false;
}

export function isWithinPathScope(targetUrl: string, basePath: string): boolean {
  if (!basePath || basePath === '/') return true;
  const normalized = basePath.replace(/\/$/, '');
  try {
    const parsed = new URL(targetUrl);
    return parsed.pathname === normalized ||
      parsed.pathname.startsWith(normalized + '/');
  } catch {
    return false;
  }
}

function isSpaHashRoute(hash: string): boolean {
  return hash.startsWith('#/') || hash.startsWith('#!/') || hash.startsWith('#!/');
}

export function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const u of urls) {
    let normalized: string;
    try {
      const parsed = new URL(u);
      if (!isSpaHashRoute(parsed.hash)) {
        parsed.hash = '';
      }
      normalized = parsed.href;
    } catch {
      normalized = u;
    }
    const key = normalized
      .replace(/^https?:/, '')
      .replace(/^\/\/www\./, '//');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(u);
    }
  }
  return result;
}

async function fetchSitemapUrls(page: Page, origin: string): Promise<string[]> {
  const urls: string[] = [];
  try {
    const response = await page.goto(`${origin}/sitemap.xml`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    if (response?.ok()) {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('xml') || contentType.includes('text')) {
        const xml = await page.content();
        const locRegex = /<loc>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/loc>/gi;
        let match: RegExpExecArray | null;
        while ((match = locRegex.exec(xml)) !== null) {
          const url = match[1].trim();
          if (url) urls.push(url);
        }
      }
    }
  } catch {
    // sitemap not found or invalid
  }
  return urls;
}

async function extractPageLinks(page: Page, baseUrl: string): Promise<string[]> {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 2000));
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const origin = new URL(baseUrl).origin;
  const rawLinks = await page.evaluate((evalOrigin: string) => {
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
      .filter((h): h is string => !!h);
  }, origin);
  const resolved: string[] = [];
  for (const href of rawLinks) {
    const abs = normalizeUrl(href, baseUrl);
    if (abs && abs.startsWith('http')) {
      resolved.push(abs);
    }
  }
  return resolved;
}

export async function discoverUrls(
  page: Page,
  baseUrl: string,
  options: MapOptions,
): Promise<string[]> {
  const allUrls = new Set<string>();
  const baseHostname = getHostname(baseUrl);
  if (!baseHostname) return [];

  const origin = new URL(baseUrl).origin;

  if (options.sitemap !== 'only') {
    const pageLinks = await extractPageLinks(page, baseUrl);
    for (const u of pageLinks) allUrls.add(u);
  }

  const sitemapUrls = await fetchSitemapUrls(page, origin);
  for (const u of sitemapUrls) allUrls.add(u);

  const basePath = new URL(baseUrl).pathname;

  let filtered = Array.from(allUrls).filter((u) =>
    isSameDomain(u, baseHostname, options.includeSubdomains ?? false) &&
    isWithinPathScope(u, basePath),
  );

  filtered = deduplicateUrls(filtered);

  if (options.search) {
    const q = options.search.toLowerCase();
    filtered = filtered.filter((u) => u.toLowerCase().includes(q));
  }

  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

export const mapCommand = registerCommand({
  name: 'map',
  description: 'Discover all URLs on a website via sitemap and page link extraction',
  scope: 'project',
  parameters: z.object({
    url: z.string(),
    search: z.string().optional(),
    sitemap: z.enum(['include', 'only']).optional(),
    includeSubdomains: z.boolean().optional(),
    limit: z.number().optional(),
  }),
  handler: async (p, _ctx: BrowserCommandContext) => {
    const sessionName = `map-${Date.now()}`;

    try {
      const session = await createSession(sessionName, p.url, { headless: true });
      const page = session.page;

      const links = await discoverUrls(page, p.url, {
        sitemap: p.sitemap,
        includeSubdomains: p.includeSubdomains,
        limit: p.limit,
        search: p.search,
      });

      const linkObjects = links.map((url) => ({ url }));

      return ok({
        links: linkObjects,
        success: true,
      });
    } finally {
      await destroyBrowser().catch(() => {});
    }
  },
});
