import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createEphemeralContext, closeEphemeralContext, resolveLaunchOpts } from '../browser.js';
import { getBaseDomain, deduplicateUrls, isSpaHashRoute } from '../utils/url.js';
import type { Page } from '../browser-shim.js';

export { deduplicateUrls };

export function getRootDomain(hostname: string): string {
  return getBaseDomain(hostname);
}

interface MapOptions {
  sitemap?: 'include' | 'only';
  includeSubdomains?: boolean;
  allowExternalLinks?: boolean;
  limit?: number;
  search?: string;
  verbose?: boolean;
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

export function isSameDomain(
  url: string,
  baseHostname: string,
  includeSubdomains: boolean,
): boolean {
  const h = getHostname(url);
  if (!h) return false;
  if (h === baseHostname) return true;
  if (includeSubdomains) {
    return getBaseDomain(h) === getBaseDomain(baseHostname);
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

async function navigateForMap(page: Page, url: string, timeout = 15000): Promise<void> {
  const urlObj = new URL(url);
  if (isSpaHashRoute(urlObj.hash)) {
    const baseUrl = urlObj.origin + urlObj.pathname + urlObj.search;
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout });
    await page.evaluate((hash: string) => {
      window.location.hash = hash;
    }, urlObj.hash);
    await page.waitForTimeout(1500);
    return;
  }
  await page.goto(url, { waitUntil: 'networkidle', timeout });
}

async function extractPageLinks(page: Page, baseUrl: string): Promise<string[]> {
  await navigateForMap(page, baseUrl);
  await new Promise(resolve => setTimeout(resolve, 2000));
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const origin = new URL(baseUrl).origin;
  const rawLinks = await page.evaluate<string[]>((evalOrigin: string) => {
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
  const steps = options.sitemap === 'only' ? 1 : 2;
  let step = 0;

  if (options.sitemap !== 'only') {
    step++;
    if (options.verbose) process.stderr.write(`[${step}/${steps}] Extracting page links...\n`);
    const pageLinks = await extractPageLinks(page, baseUrl);
    for (const u of pageLinks) allUrls.add(u);
    if (options.verbose) process.stderr.write(`[${step}/${steps}] Found ${pageLinks.length} links from page\n`);
  }

  step++;
  if (options.verbose) process.stderr.write(`[${step}/${steps}] Fetching sitemap...\n`);
  const sitemapUrls = await fetchSitemapUrls(page, origin);
  for (const u of sitemapUrls) allUrls.add(u);
  if (options.verbose) process.stderr.write(`[${step}/${steps}] Found ${sitemapUrls.length} URLs from sitemap\n`);

  const basePath = new URL(baseUrl).pathname;

  let filtered = Array.from(allUrls).filter((u) =>
    options.allowExternalLinks ||
    (isSameDomain(u, baseHostname, options.includeSubdomains ?? false) &&
    isWithinPathScope(u, basePath)),
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
    allowExternalLinks: z.boolean().optional().describe('Include links to external domains'),
    limit: z.number().optional(),
    verbose: z.boolean().default(false).describe('Show progress feedback'),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { context, page } = await createEphemeralContext(resolveLaunchOpts(ctx));

    try {
      const links = await discoverUrls(page, p.url, {
        sitemap: p.sitemap,
        includeSubdomains: p.includeSubdomains,
        allowExternalLinks: p.allowExternalLinks,
        limit: p.limit,
        search: p.search,
        verbose: p.verbose,
      });

      const linkObjects = links.map((url) => ({ url }));

      return ok({
        links: linkObjects,
        success: true,
      });
    } finally {
      await closeEphemeralContext(context);
    }
  },
  result: z.object({
    links: z.array(z.object({ url: z.string() })),
    success: z.boolean(),
  }),
});
